"""Authenticated cloud conversation and durable POST-SSE endpoints."""

from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..models import (
    CloudChatMessageRequest,
    CloudChatStreamDelta,
    CloudChatStreamStart,
    ConversationCreateRequest,
    ConversationPage,
    ConversationResponse,
    ConversationUpdateRequest,
    MessagePage,
)
from ..services.auth_service import CurrentSession
from ..services.conversation_service import (
    ConversationService,
    ConversationServiceError,
    get_conversation_service,
    stream_error_payload,
)
from .auth_dependencies import require_csrf, require_current_user

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _http_error(error: ConversationServiceError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )


def _sse(event: str, payload: BaseModel) -> dict[str, str]:
    return {"event": event, "data": payload.model_dump_json()}


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    request: ConversationCreateRequest,
    current: CurrentSession = Depends(require_csrf),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationResponse:
    return await service.create(current.user.id, request)


@router.get("", response_model=ConversationPage)
async def list_conversations(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    include_archived: bool = False,
    current: CurrentSession = Depends(require_current_user),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationPage:
    try:
        return await service.list_conversations(
            current.user.id,
            limit=limit,
            cursor=cursor,
            include_archived=include_archived,
        )
    except ConversationServiceError as error:
        raise _http_error(error) from error


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    current: CurrentSession = Depends(require_current_user),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationResponse:
    try:
        return await service.get(current.user.id, conversation_id)
    except ConversationServiceError as error:
        raise _http_error(error) from error


@router.get("/{conversation_id}/messages", response_model=MessagePage)
async def list_messages(
    conversation_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    current: CurrentSession = Depends(require_current_user),
    service: ConversationService = Depends(get_conversation_service),
) -> MessagePage:
    try:
        return await service.messages(
            current.user.id,
            conversation_id,
            limit=limit,
            cursor=cursor,
        )
    except ConversationServiceError as error:
        raise _http_error(error) from error


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: UUID,
    request: ConversationUpdateRequest,
    current: CurrentSession = Depends(require_csrf),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationResponse:
    try:
        return await service.update(current.user.id, conversation_id, request)
    except ConversationServiceError as error:
        raise _http_error(error) from error


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: UUID,
    current: CurrentSession = Depends(require_csrf),
    service: ConversationService = Depends(get_conversation_service),
) -> None:
    try:
        await service.delete(current.user.id, conversation_id)
    except ConversationServiceError as error:
        raise _http_error(error) from error


@router.post("/{conversation_id}/messages/stream", response_model=None)
async def stream_message(
    conversation_id: UUID,
    request: CloudChatMessageRequest,
    current: CurrentSession = Depends(require_csrf),
    service: ConversationService = Depends(get_conversation_service),
) -> EventSourceResponse:
    try:
        prepared = await service.prepare_generation(
            current.user.id, conversation_id, request
        )
    except ConversationServiceError as error:
        raise _http_error(error) from error

    async def event_generator() -> AsyncIterator[dict[str, str]]:
        yield _sse(
            "start",
            CloudChatStreamStart(
                conversation_id=prepared.conversation.id,
                user_message_id=prepared.user_message.id,
                assistant_message_id=prepared.assistant_message.id,
            ),
        )
        try:
            async for update in service.stream_generation(prepared):
                event = "delta" if isinstance(update, CloudChatStreamDelta) else "done"
                yield _sse(event, update)
        except ConversationServiceError as error:
            yield _sse("error", stream_error_payload(prepared, error))

    return EventSourceResponse(
        event_generator(),
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
