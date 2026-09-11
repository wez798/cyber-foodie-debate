"""Offline TTS regression tests; never connect to Microsoft's service."""

import asyncio
from unittest.mock import AsyncMock, Mock

import aiohttp
import pytest
from pydantic import ValidationError
from tenacity import wait_none

from src.backend.config import Settings
from src.backend.services import tts_service as module
from src.backend.services.tts_service import TTSService, TTSServiceError


def install_stream(monkeypatch, items):
    closed = []

    class FakeCommunicate:
        async def stream(self):
            try:
                for item in items:
                    if isinstance(item, BaseException):
                        raise item
                    yield item
            finally:
                closed.append(True)

    factory = Mock(side_effect=lambda **kwargs: FakeCommunicate())
    monkeypatch.setattr(module.edge_tts, "Communicate", factory)
    return factory, closed


def response_error(status):
    return aiohttp.WSServerHandshakeError(
        request_info=Mock(real_url="wss://example.invalid/?token=do-not-expose"),
        history=(),
        status=status,
        message="upstream private details",
    )


def test_audio_is_assembled_with_configured_proxy(monkeypatch):
    factory, closed = install_stream(
        monkeypatch,
        [
            {"type": "WordBoundary"},
            {"type": "audio", "data": b"part1"},
            {"type": "audio", "data": b"part2"},
        ],
    )
    service = TTSService(retry_wait=wait_none())
    service.proxy = "http://127.0.0.1:7890"
    assert asyncio.run(service.synthesize("测试", rate="+10%")) == b"part1part2"
    assert factory.call_args.kwargs["proxy"] == service.proxy
    assert factory.call_args.kwargs["rate"] == "+10%"
    assert closed == [True]


def test_403_is_actionable_and_is_not_retried(monkeypatch):
    factory, _ = install_stream(monkeypatch, [response_error(403)])
    with pytest.raises(TTSServiceError) as captured:
        asyncio.run(TTSService(retry_wait=wait_none()).synthesize("测试"))
    assert captured.value.status_code == 503
    assert "TTS_PROXY" in str(captured.value)
    assert "token" not in str(captured.value)
    assert factory.call_count == 1


@pytest.mark.parametrize(
    "error",
    [response_error(429), response_error(503), aiohttp.ClientConnectionError("断网")],
)
def test_transient_failure_has_at_most_two_attempts(monkeypatch, error):
    factory, _ = install_stream(monkeypatch, [error])
    with pytest.raises(TTSServiceError):
        asyncio.run(TTSService(retry_wait=wait_none()).synthesize("测试"))
    assert factory.call_count == 2


def test_partial_audio_is_not_replayed_or_returned(monkeypatch):
    factory, closed = install_stream(
        monkeypatch,
        [
            {"type": "audio", "data": b"partial"},
            aiohttp.ClientConnectionError("断网"),
        ],
    )
    with pytest.raises(TTSServiceError):
        asyncio.run(TTSService(retry_wait=wait_none()).synthesize("测试"))
    assert factory.call_count == 1
    assert closed == [True]


def test_empty_audio_is_not_success_or_healthy(monkeypatch):
    install_stream(monkeypatch, [{"type": "WordBoundary"}])
    service = TTSService(retry_wait=wait_none())
    with pytest.raises(TTSServiceError, match="未返回音频"):
        asyncio.run(service.synthesize("测试"))
    assert asyncio.run(service.health_check()) is False


def test_timeout_and_cancellation_close_upstream(monkeypatch):
    closed = []

    class BlockingCommunicate:
        async def stream(self):
            try:
                await asyncio.Event().wait()
                yield {"type": "audio", "data": b"unreachable"}
            finally:
                closed.append(True)

    monkeypatch.setattr(
        module.edge_tts, "Communicate", lambda **kwargs: BlockingCommunicate()
    )
    service = TTSService(retry_wait=wait_none())
    service.timeout_seconds = 0.01
    with pytest.raises(TTSServiceError) as captured:
        asyncio.run(service.synthesize("测试"))
    assert captured.value.status_code == 504
    assert closed == [True]

    async def cancel():
        task = asyncio.create_task(service.synthesize("测试"))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel())
    assert closed == [True, True]


def test_file_synthesis_uses_shared_service(monkeypatch, tmp_path):
    service = TTSService()
    synthesize = AsyncMock(return_value=b"audio")
    monkeypatch.setattr(service, "synthesize", synthesize)
    output = tmp_path / "speech.mp3"
    asyncio.run(service.synthesize_to_file("测试", str(output)))
    assert output.read_bytes() == b"audio"
    synthesize.assert_awaited_once()


def test_proxy_configuration_accepts_blank_and_rejects_non_http():
    assert Settings(_env_file=None, tts_proxy="").tts_proxy is None
    assert (
        str(Settings(_env_file=None, tts_proxy="http://localhost:7890").tts_proxy)
        == "http://localhost:7890/"
    )
    with pytest.raises(ValidationError):
        Settings(_env_file=None, tts_proxy="socks5://localhost:7890")


def test_tts_diagnostic_does_not_call_llm(monkeypatch):
    from scripts import test_api_connectivity as diagnostic

    llm = AsyncMock(side_effect=AssertionError("must not call LLM"))
    monkeypatch.setattr(diagnostic, "check_llm_api", llm)
    monkeypatch.setattr(diagnostic, "check_tts_api", AsyncMock(return_value=True))
    assert asyncio.run(diagnostic.main("tts")) is True
    llm.assert_not_awaited()
