"""Unit tests for the async SiliconFlow service using an HTTP mock transport."""

import asyncio
import json

import httpx
import pytest
from tenacity import wait_none

from src.backend.services.llm_service import LLMService, LLMServiceError


class ChunkedSSEStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def test_non_stream_completion_uses_expected_model_and_auth():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        captured["authorization"] = request.headers["Authorization"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "今天吃麻辣香锅！"},
                        "finish_reason": "stop",
                    }
                ]
            },
        )

    service = LLMService(
        api_key="test-key",
        base_url="https://mock.siliconflow.local/v1",
        model="deepseek-ai/DeepSeek-V4-Flash",
        transport=httpx.MockTransport(handler),
        retry_wait=wait_none(),
    )
    result = asyncio.run(
        service.complete([{"role": "user", "content": "今天吃什么？"}])
    )

    assert result.content == "今天吃麻辣香锅！"
    assert captured["authorization"] == "Bearer test-key"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["model"] == "deepseek-ai/DeepSeek-V4-Flash"
    assert payload["stream"] is False


def test_stream_completion_yields_incremental_text():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["stream"] is True
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            stream=ChunkedSSEStream(
                [
                    b'data: {"choices":[{"delta":{"content":"\xe9\xba\xbb\xe8\xbe\xa3"}}]}\n\n',
                    b'data: {"choices":[{"delta":{"content":"\xe9\xa6\x99\xe9\x94\x85"},"finish_reason":"stop"}]}\n\n',
                    b"data: [DONE]\n\n",
                ]
            ),
        )

    service = LLMService(
        api_key="test-key",
        base_url="https://mock.siliconflow.local/v1",
        transport=httpx.MockTransport(handler),
        retry_wait=wait_none(),
    )

    async def collect():
        return [
            chunk
            async for chunk in service.stream(
                [{"role": "user", "content": "推荐一道菜"}]
            )
        ]

    chunks = asyncio.run(collect())
    assert [chunk.delta for chunk in chunks] == ["麻辣", "香锅"]
    assert chunks[-1].finish_reason == "stop"


def test_missing_api_key_fails_before_http_request():
    service = LLMService(api_key="")

    with pytest.raises(LLMServiceError) as captured:
        asyncio.run(service.complete([{"role": "user", "content": "你好"}]))

    assert captured.value.code == "missing_api_key"
    assert captured.value.status_code == 503


def test_rate_limit_is_retried_then_normalized():
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(429, json={"message": "raw upstream detail"})

    service = LLMService(
        api_key="test-key",
        base_url="https://mock.siliconflow.local/v1",
        transport=httpx.MockTransport(handler),
        retry_wait=wait_none(),
    )

    with pytest.raises(LLMServiceError) as captured:
        asyncio.run(service.complete([{"role": "user", "content": "你好"}]))

    assert attempts == 3
    assert captured.value.code == "rate_limited"
    assert captured.value.status_code == 429
    assert "raw upstream detail" not in captured.value.message


@pytest.mark.parametrize(
    ("status", "code", "public_status"),
    [
        (401, "unauthorized", 503),
        (503, "service_unavailable", 503),
        (504, "gateway_timeout", 504),
    ],
)
def test_known_upstream_errors_are_normalized(status, code, public_status):
    error = LLMService._status_error(status)

    assert error.code == code
    assert error.status_code == public_status


@pytest.mark.parametrize(
    ("exception_type", "code", "public_status"),
    [
        (httpx.ReadTimeout, "timeout", 504),
        (httpx.ConnectError, "network_error", 503),
    ],
)
def test_transport_errors_are_retried_and_normalized(
    exception_type, code, public_status
):
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise exception_type("mock transport failure", request=request)

    service = LLMService(
        api_key="test-key",
        base_url="https://mock.siliconflow.local/v1",
        transport=httpx.MockTransport(handler),
        retry_wait=wait_none(),
    )

    with pytest.raises(LLMServiceError) as captured:
        asyncio.run(service.complete([{"role": "user", "content": "你好"}]))

    assert attempts == 3
    assert captured.value.code == code
    assert captured.value.status_code == public_status
