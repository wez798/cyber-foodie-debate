"""FastAPI contract tests for terminal debate failures."""

import pytest
from sse_starlette.sse import AppStatus

from fastapi.testclient import TestClient

from collections.abc import AsyncGenerator

from src.backend.app import create_app
from src.backend.services.debate_service import DebateService, get_debate_service
from src.backend.services.llm_service import (
    LLMStreamChunk,
    LLMCompletion,
    LLMServiceError,
)


@pytest.fixture(autouse=True)
def isolated_sse_exit_event(monkeypatch):
    monkeypatch.setattr(AppStatus, "should_exit_event", None)


class FailingLLM:
    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        enable_thinking: bool | None = None,
    ) -> AsyncGenerator[LLMStreamChunk, None]:
        completion = await self.complete(
            messages, temperature=temperature, max_tokens=max_tokens
        )
        yield LLMStreamChunk(delta=completion.content)
        yield LLMStreamChunk(finish_reason="stop")

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        enable_thinking: bool | None = None,
    ) -> LLMCompletion:
        del messages, temperature, max_tokens
        raise LLMServiceError(
            "service_unavailable",
            "硅基流动服务暂不可用，请稍后重试",
            status_code=503,
            retryable=True,
        )


def request_body() -> dict[str, object]:
    return {
        "preference": {
            "口味": "清淡",
            "预算": "10-20元",
            "忌口": "海鲜过敏",
        },
        "max_rounds": 1,
    }


def client_with_failure() -> TestClient:
    app = create_app()
    service = DebateService(llm=FailingLLM(), timeout_seconds=1)
    app.dependency_overrides[get_debate_service] = lambda: service
    return TestClient(app)


def test_non_stream_failure_returns_a_non_success_status() -> None:
    response = client_with_failure().post("/api/v1/debate/start", json=request_body())

    assert response.status_code == 503
    assert response.json() == {"detail": "硅基流动服务暂不可用，请稍后重试"}


def test_stream_failure_emits_error_without_result() -> None:
    response = client_with_failure().post(
        "/api/v1/debate/start-stream",
        json=request_body(),
    )

    assert response.status_code == 200
    assert "event: session_start" in response.text
    assert "event: error" in response.text
    assert "service_unavailable" in response.text
    assert "event: result" not in response.text


def test_stream_serializes_deltas_before_round_and_result() -> None:
    from tests.unit.test_debate_service import IncrementalLLM

    app = create_app()
    service = DebateService(llm=IncrementalLLM())
    app.dependency_overrides[get_debate_service] = lambda: service
    response = TestClient(app).post("/api/v1/debate/start-stream", json=request_body())
    assert response.headers["x-accel-buffering"] == "no"
    assert response.text.index("event: round_delta") < response.text.index(
        "event: round\r"
    )
    assert response.text.index("event: round\r") < response.text.index("event: result")
    assert '"delta":"推荐"' in response.text
