"""Unit tests for debate failure, timeout, and cancellation semantics."""

import asyncio
import json

import pytest

from src.backend.models import (
    DebateRequest,
    DebateResultData,
    DebateStatus,
    FoodPreference,
)
from src.backend.services.debate_service import DebateService, DebateServiceError
from src.backend.services.llm_service import LLMCompletion, LLMServiceError


def debate_request() -> DebateRequest:
    return DebateRequest(
        preference=FoodPreference(
            口味="清淡",
            预算="10-20元",
            忌口="海鲜过敏",
        ),
        max_rounds=1,
    )


class SuccessfulLLM:
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        del temperature, max_tokens
        if "公正主持人" not in messages[0]["content"]:
            return LLMCompletion(content="推荐番茄鸡蛋面，符合预算且不含海鲜。")
        return LLMCompletion(
            content=json.dumps(
                {
                    "winner": "cantonese_healthy",
                    "recommendation": "清淡且符合预算，并避开海鲜。",
                    "dish_name": "番茄鸡蛋面",
                    "restaurant": "校园二食堂",
                    "confidence": 0.9,
                },
                ensure_ascii=False,
            )
        )


class FailingLLM:
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        del messages, temperature, max_tokens
        raise LLMServiceError(
            "service_unavailable",
            "硅基流动服务暂不可用，请稍后重试",
            status_code=503,
            retryable=True,
        )


class InvalidJudgeLLM(SuccessfulLLM):
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        if "公正主持人" in messages[0]["content"]:
            return LLMCompletion(content="这不是 JSON")
        return await super().complete(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )


class SlowLLM:
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMCompletion:
        del messages, temperature, max_tokens
        await asyncio.sleep(1)
        return LLMCompletion(content="不会在超时前返回")


def test_successful_debate_emits_a_valid_terminal_result() -> None:
    service = DebateService(llm=SuccessfulLLM(), timeout_seconds=1)

    response = asyncio.run(service.start_debate(debate_request()))

    assert response.status == DebateStatus.COMPLETED
    assert response.result is not None
    assert response.result.dish_name == "番茄鸡蛋面"
    assert service.sessions[response.session_id].completed_at is not None


def test_upstream_failure_never_returns_a_completed_result() -> None:
    service = DebateService(llm=FailingLLM(), timeout_seconds=1)

    with pytest.raises(DebateServiceError, match="暂不可用") as captured:
        asyncio.run(service.start_debate(debate_request()))

    session = service.sessions[captured.value.session_id]
    assert captured.value.code == "service_unavailable"
    assert session.status == DebateStatus.FAILED
    assert session.result is None


def test_invalid_judge_output_is_a_terminal_failure() -> None:
    service = DebateService(llm=InvalidJudgeLLM(), timeout_seconds=1)

    with pytest.raises(DebateServiceError) as captured:
        asyncio.run(service.start_debate(debate_request()))

    assert captured.value.code == "invalid_result"
    assert service.sessions[captured.value.session_id].status == DebateStatus.FAILED


def test_debate_enforces_an_overall_timeout() -> None:
    service = DebateService(llm=SlowLLM(), timeout_seconds=0.01)

    with pytest.raises(DebateServiceError) as captured:
        asyncio.run(service.start_debate(debate_request()))

    assert captured.value.code == "debate_timeout"
    assert captured.value.status == DebateStatus.TIMEOUT
    assert service.sessions[captured.value.session_id].status == DebateStatus.TIMEOUT


def test_closing_a_stream_removes_the_cancelled_session() -> None:
    service = DebateService(llm=SuccessfulLLM(), timeout_seconds=1)

    async def open_then_close() -> str:
        stream = service.stream_debate(debate_request())
        start = await anext(stream)
        await stream.aclose()
        return start.session_id

    session_id = asyncio.run(open_then_close())

    assert session_id not in service.sessions


def test_stream_result_type_cannot_represent_timeout_as_success() -> None:
    service = DebateService(llm=SuccessfulLLM(), timeout_seconds=1)

    async def collect_result() -> DebateResultData:
        async for update in service.stream_debate(debate_request()):
            if isinstance(update, DebateResultData):
                return update
        raise AssertionError("missing result")

    result = asyncio.run(collect_result())
    assert result.status == "completed"
