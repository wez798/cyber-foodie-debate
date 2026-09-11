"""Unit coverage for persistent chat failure and cancellation state changes."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest

from src.backend.db_models import ConversationEntity, MessageEntity, utc_now
from src.backend.models import ChatRequest, MessageStatus
from src.backend.repositories.conversation_repository import PreparedGeneration
from src.backend.services.conversation_service import (
    ConversationService,
    ConversationServiceError,
)
from src.backend.services.llm_service import LLMServiceError, LLMStreamChunk


class TerminalRepository:
    def __init__(self) -> None:
        self.failures: list[tuple[UUID, str, bool]] = []

    async def fail_generation(
        self, *, assistant_message_id: UUID, error_code: str, cancelled: bool
    ) -> None:
        self.failures.append((assistant_message_id, error_code, cancelled))


class PartialFailureGateway:
    def ensure_configured(self) -> None:
        return None

    async def stream_reply(
        self, _request: ChatRequest
    ) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(delta="部分内容")
        raise LLMServiceError(
            "timeout", "上游响应超时", status_code=504, retryable=True
        )


class BlockingGateway:
    def __init__(self) -> None:
        self.waiting = asyncio.Event()

    def ensure_configured(self) -> None:
        return None

    async def stream_reply(
        self, _request: ChatRequest
    ) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(delta="已开始")
        self.waiting.set()
        await asyncio.Event().wait()


def prepared_generation() -> PreparedGeneration:
    now = utc_now()
    conversation_id = uuid4()
    user_message = MessageEntity(
        id=uuid4(),
        conversation_id=conversation_id,
        sequence_no=1,
        role="user",
        content="午饭吃什么？",
        status=MessageStatus.COMPLETE.value,
        client_request_id="request-1",
        created_at=now,
        updated_at=now,
    )
    assistant_message = MessageEntity(
        id=uuid4(),
        conversation_id=conversation_id,
        sequence_no=2,
        role="assistant",
        content="",
        status=MessageStatus.GENERATING.value,
        reply_to_message_id=user_message.id,
        active_slot="assistant_generation",
        created_at=now,
        updated_at=now,
    )
    return PreparedGeneration(
        conversation=ConversationEntity(
            id=conversation_id,
            user_id=uuid4(),
            mode="chat",
            topic="午饭",
            created_at=now,
            updated_at=now,
        ),
        user_message=user_message,
        assistant_message=assistant_message,
        context_messages=[user_message],
    )


def service_with(gateway):
    terminal_repository = TerminalRepository()

    @asynccontextmanager
    async def repository_context():
        yield terminal_repository

    return (
        ConversationService(
            terminal_repository,
            gateway,
            repository_context,
        ),
        terminal_repository,
    )


def test_partial_stream_failure_is_persisted_as_failed() -> None:
    prepared = prepared_generation()
    service, repository = service_with(PartialFailureGateway())

    async def consume() -> list[str]:
        deltas: list[str] = []
        with pytest.raises(ConversationServiceError) as captured:
            async for event in service.stream_generation(prepared):
                deltas.append(event.delta)
        assert captured.value.code == "timeout"
        assert captured.value.retryable is True
        return deltas

    assert asyncio.run(consume()) == ["部分内容"]
    assert repository.failures == [(prepared.assistant_message.id, "timeout", False)]


def test_task_cancellation_is_persisted_as_cancelled() -> None:
    prepared = prepared_generation()

    async def exercise() -> list[tuple[UUID, str, bool]]:
        gateway = BlockingGateway()
        service, repository = service_with(gateway)

        async def consume() -> None:
            async for _ in service.stream_generation(prepared):
                pass

        task = asyncio.create_task(consume())
        await gateway.waiting.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return repository.failures

    assert asyncio.run(exercise()) == [
        (prepared.assistant_message.id, "cancelled", True)
    ]
