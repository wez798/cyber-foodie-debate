"""User-owned conversation lifecycle and durable cloud chat streaming."""

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from datetime import datetime, timedelta, timezone
from typing import Literal, Protocol, cast
from uuid import UUID

from fastapi import Depends

from ..config import settings
from ..db_models import ConversationEntity, MessageEntity, utc_now
from ..models import (
    ChatErrorDetail,
    ChatMessage,
    ChatMode,
    ChatRequest,
    CloudChatMessageRequest,
    CloudChatStreamDelta,
    CloudChatStreamDone,
    CloudChatStreamError,
    ConversationCreateRequest,
    ConversationPage,
    ConversationResponse,
    ConversationUpdateRequest,
    MessagePage,
    MessageStatus,
    PersistentMessageResponse,
)
from ..repositories.conversation_repository import (
    ConversationBusyError,
    ConversationNotFoundError,
    ConversationRepository,
    DuplicateMessageRequestError,
    PreparedGeneration,
    conversation_repository_context,
    get_conversation_repository,
)
from .chat_service import ChatService, get_chat_service
from .llm_service import LLMServiceError, LLMStreamChunk

logger = logging.getLogger(__name__)

CONTEXT_MESSAGE_LIMIT = 50
SOFT_CONTEXT_CHARACTER_LIMIT = 60_000
MAX_CONTEXT_CHARACTER_LIMIT = 64_000

RepositoryContextFactory = Callable[
    [], AbstractAsyncContextManager[ConversationRepository]
]


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class ChatGateway(Protocol):
    def ensure_configured(self) -> None: ...

    def stream_reply(self, request: ChatRequest) -> AsyncIterator[LLMStreamChunk]: ...


class ConversationServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable


def conversation_response(entity: ConversationEntity) -> ConversationResponse:
    return ConversationResponse(
        id=entity.id,
        mode=ChatMode(entity.mode),
        topic=entity.topic,
        title=entity.title,
        created_at=_aware_utc(entity.created_at),
        updated_at=_aware_utc(entity.updated_at),
        archived_at=(
            _aware_utc(entity.archived_at) if entity.archived_at is not None else None
        ),
    )


def message_response(entity: MessageEntity) -> PersistentMessageResponse:
    return PersistentMessageResponse(
        id=entity.id,
        conversation_id=entity.conversation_id,
        sequence_no=entity.sequence_no,
        role=cast(Literal["user", "assistant"], entity.role),
        content=entity.content,
        status=MessageStatus(entity.status),
        client_request_id=entity.client_request_id,
        reply_to_message_id=entity.reply_to_message_id,
        finish_reason=entity.finish_reason,
        error_code=entity.error_code,
        source=cast(Literal["server", "client_import"], entity.source),
        created_at=_aware_utc(entity.created_at),
        updated_at=_aware_utc(entity.updated_at),
    )


def _encode_cursor(payload: dict[str, str | int]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, object]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        value: object = json.loads(decoded)
    except (ValueError, UnicodeError, json.JSONDecodeError) as error:
        raise ConversationServiceError(
            "invalid_cursor", "分页游标无效", status_code=422
        ) from error
    if not isinstance(value, dict):
        raise ConversationServiceError(
            "invalid_cursor", "分页游标无效", status_code=422
        )
    return value


class ConversationService:
    def __init__(
        self,
        repository: ConversationRepository,
        chat: ChatGateway,
        repository_context: RepositoryContextFactory = conversation_repository_context,
    ) -> None:
        self.repository = repository
        self.chat = chat
        self.repository_context = repository_context

    async def create(
        self, user_id: UUID, request: ConversationCreateRequest
    ) -> ConversationResponse:
        entity = await self.repository.create_conversation(
            user_id=user_id, mode=request.mode, topic=request.topic
        )
        return conversation_response(entity)

    async def get(self, user_id: UUID, conversation_id: UUID) -> ConversationResponse:
        entity = await self.repository.get_owned(
            user_id=user_id, conversation_id=conversation_id
        )
        if not entity:
            raise self._not_found()
        return conversation_response(entity)

    async def list_conversations(
        self,
        user_id: UUID,
        *,
        limit: int,
        cursor: str | None,
        include_archived: bool,
    ) -> ConversationPage:
        before: tuple[datetime, UUID] | None = None
        if cursor:
            payload = _decode_cursor(cursor)
            try:
                updated_at = datetime.fromisoformat(str(payload["updated_at"]))
                if updated_at.tzinfo is None:
                    raise ValueError("cursor timestamp must include a timezone")
                before = (updated_at, UUID(str(payload["id"])))
            except (KeyError, ValueError) as error:
                raise ConversationServiceError(
                    "invalid_cursor", "分页游标无效", status_code=422
                ) from error
        entities = await self.repository.list_owned(
            user_id=user_id,
            limit=limit + 1,
            before=before,
            include_archived=include_archived,
        )
        has_more = len(entities) > limit
        page = entities[:limit]
        next_cursor = None
        if has_more and page:
            last = page[-1]
            next_cursor = _encode_cursor(
                {
                    "updated_at": _aware_utc(last.updated_at).isoformat(),
                    "id": str(last.id),
                }
            )
        return ConversationPage(
            items=[conversation_response(entity) for entity in page],
            next_cursor=next_cursor,
        )

    async def update(
        self,
        user_id: UUID,
        conversation_id: UUID,
        request: ConversationUpdateRequest,
    ) -> ConversationResponse:
        try:
            entity = await self.repository.update_owned(
                user_id=user_id,
                conversation_id=conversation_id,
                title=request.title,
                archived=request.archived,
            )
        except ConversationNotFoundError as error:
            raise self._not_found() from error
        except ConversationBusyError as error:
            raise self._busy() from error
        return conversation_response(entity)

    async def delete(self, user_id: UUID, conversation_id: UUID) -> None:
        try:
            await self.repository.soft_delete_owned(
                user_id=user_id, conversation_id=conversation_id
            )
        except ConversationNotFoundError as error:
            raise self._not_found() from error
        except ConversationBusyError as error:
            raise self._busy() from error

    async def messages(
        self,
        user_id: UUID,
        conversation_id: UUID,
        *,
        limit: int,
        cursor: str | None,
    ) -> MessagePage:
        before_sequence: int | None = None
        if cursor:
            payload = _decode_cursor(cursor)
            try:
                before_sequence = int(str(payload["sequence"]))
                if before_sequence <= 0:
                    raise ValueError("cursor sequence must be positive")
            except (KeyError, TypeError, ValueError) as error:
                raise ConversationServiceError(
                    "invalid_cursor", "分页游标无效", status_code=422
                ) from error
        try:
            entities = await self.repository.list_messages(
                user_id=user_id,
                conversation_id=conversation_id,
                limit=limit + 1,
                before_sequence=before_sequence,
            )
        except ConversationNotFoundError as error:
            raise self._not_found() from error
        has_more = len(entities) > limit
        page_descending = entities[:limit]
        next_cursor = (
            _encode_cursor({"sequence": page_descending[-1].sequence_no})
            if has_more and page_descending
            else None
        )
        page = list(reversed(page_descending))
        return MessagePage(
            items=[message_response(entity) for entity in page],
            next_cursor=next_cursor,
        )

    async def prepare_generation(
        self,
        user_id: UUID,
        conversation_id: UUID,
        request: CloudChatMessageRequest,
    ) -> PreparedGeneration:
        try:
            self.chat.ensure_configured()
        except LLMServiceError as error:
            raise ConversationServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
                retryable=error.retryable,
            ) from error
        try:
            return await self.repository.prepare_generation(
                user_id=user_id,
                conversation_id=conversation_id,
                content=request.content,
                client_request_id=request.client_request_id,
                context_limit=CONTEXT_MESSAGE_LIMIT,
                stale_before=utc_now()
                - timedelta(seconds=settings.cloud_generation_stale_seconds),
            )
        except ConversationNotFoundError as error:
            raise self._not_found() from error
        except ConversationBusyError as error:
            raise self._busy() from error
        except DuplicateMessageRequestError as error:
            if error.assistant_message.status == MessageStatus.COMPLETE.value:
                conversation = await self.repository.get_owned(
                    user_id=user_id, conversation_id=conversation_id
                )
                if not conversation:
                    raise self._not_found() from error
                return PreparedGeneration(
                    conversation=conversation,
                    user_message=error.user_message,
                    assistant_message=error.assistant_message,
                    context_messages=[],
                )
            raise ConversationServiceError(
                "duplicate_request",
                "该请求已经处理；失败或取消后请使用新的请求标识重试",
                status_code=409,
            ) from error

    async def stream_generation(
        self, prepared: PreparedGeneration
    ) -> AsyncIterator[CloudChatStreamDelta | CloudChatStreamDone]:
        assistant = prepared.assistant_message
        if assistant.status == MessageStatus.COMPLETE.value:
            yield CloudChatStreamDone(
                conversation_id=prepared.conversation.id,
                user_message_id=prepared.user_message.id,
                assistant_message=message_response(assistant),
            )
            return

        terminal_written = False
        content_parts: list[str] = []
        finish_reason = "stop"
        chat_request = ChatRequest(
            conversation_id=str(prepared.conversation.id),
            messages=self._trim_context(prepared.context_messages),
            mode=ChatMode(prepared.conversation.mode),
            topic=prepared.conversation.topic,
            metadata={},
        )
        try:
            async for chunk in self.chat.stream_reply(chat_request):
                if chunk.finish_reason:
                    finish_reason = chunk.finish_reason
                if not chunk.delta:
                    continue
                content_parts.append(chunk.delta)
                yield CloudChatStreamDelta(
                    conversation_id=prepared.conversation.id,
                    assistant_message_id=assistant.id,
                    delta=chunk.delta,
                )
            content = "".join(content_parts)
            if not content.strip():
                raise LLMServiceError(
                    "invalid_response",
                    "硅基流动服务未返回有效文本",
                    status_code=502,
                )
            async with self.repository_context() as repository:
                completed = await repository.complete_generation(
                    assistant_message_id=assistant.id,
                    content=content,
                    finish_reason=finish_reason,
                )
            terminal_written = True
            yield CloudChatStreamDone(
                conversation_id=prepared.conversation.id,
                user_message_id=prepared.user_message.id,
                assistant_message=message_response(completed),
            )
        except asyncio.CancelledError:
            terminal_written = await self._record_failure(
                assistant.id, error_code="cancelled", cancelled=True
            )
            raise
        except LLMServiceError as error:
            terminal_written = await self._record_failure(
                assistant.id, error_code=error.code, cancelled=False
            )
            raise ConversationServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
                retryable=error.retryable,
            ) from error
        except Exception as error:
            logger.exception("Unexpected persistent chat stream failure")
            terminal_written = await self._record_failure(
                assistant.id, error_code="internal_error", cancelled=False
            )
            raise ConversationServiceError(
                "internal_error",
                "对话流意外中断，请稍后重试",
                status_code=500,
                retryable=True,
            ) from error
        finally:
            if not terminal_written:
                await self._record_failure(
                    assistant.id, error_code="cancelled", cancelled=True
                )

    async def _record_failure(
        self, assistant_message_id: UUID, *, error_code: str, cancelled: bool
    ) -> bool:
        """Best-effort terminal write without replacing the user-facing failure."""
        try:
            async with self.repository_context() as repository:
                await repository.fail_generation(
                    assistant_message_id=assistant_message_id,
                    error_code=error_code,
                    cancelled=cancelled,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Failed to persist terminal state for assistant message %s",
                assistant_message_id,
            )
            return False
        return True

    @staticmethod
    def _trim_context(entities: list[MessageEntity]) -> list[ChatMessage]:
        selected: list[ChatMessage] = []
        total_chars = 0
        for entity in reversed(entities):
            if entity.role not in {"user", "assistant"} or not entity.content.strip():
                continue
            next_size = total_chars + len(entity.content)
            if selected and next_size > SOFT_CONTEXT_CHARACTER_LIMIT:
                break
            if next_size > MAX_CONTEXT_CHARACTER_LIMIT:
                remaining = SOFT_CONTEXT_CHARACTER_LIMIT - total_chars
                content = entity.content[-max(1, remaining) :]
                selected.append(
                    ChatMessage(
                        role=cast(Literal["user", "assistant"], entity.role),
                        content=content,
                    )
                )
                break
            selected.append(
                ChatMessage(
                    role=cast(Literal["user", "assistant"], entity.role),
                    content=entity.content,
                )
            )
            total_chars = next_size
        selected.reverse()
        while selected and selected[0].role == "assistant":
            selected.pop(0)
        return selected

    @staticmethod
    def _not_found() -> ConversationServiceError:
        return ConversationServiceError(
            "conversation_not_found", "会话不存在", status_code=404
        )

    @staticmethod
    def _busy() -> ConversationServiceError:
        return ConversationServiceError(
            "conversation_busy",
            "该会话正在生成回复，请稍后重试",
            status_code=409,
            retryable=True,
        )


def get_conversation_service(
    repository: ConversationRepository = Depends(get_conversation_repository),
    chat: ChatService = Depends(get_chat_service),
) -> ConversationService:
    return ConversationService(repository, chat)


def stream_error_payload(
    prepared: PreparedGeneration, error: ConversationServiceError
) -> CloudChatStreamError:
    return CloudChatStreamError(
        conversation_id=prepared.conversation.id,
        assistant_message_id=prepared.assistant_message.id,
        error=ChatErrorDetail(
            code=error.code,
            message=error.message,
            retryable=error.retryable,
        ),
    )
