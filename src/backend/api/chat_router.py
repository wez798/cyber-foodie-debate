"""Validated non-streaming and SSE chat endpoints."""

import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..models import (
    ChatErrorDetail,
    ChatErrorResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatStreamDelta,
    ChatStreamDone,
    ChatStreamError,
    ChatStreamStart,
)
from ..services.chat_service import ChatService, get_chat_service
from ..services.llm_service import LLMServiceError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    429: {"model": ChatErrorResponse, "description": "上游服务限流"},
    502: {"model": ChatErrorResponse, "description": "上游响应异常"},
    503: {"model": ChatErrorResponse, "description": "服务未配置或暂不可用"},
    504: {"model": ChatErrorResponse, "description": "上游服务超时"},
}


def _error_detail(error: LLMServiceError) -> ChatErrorDetail:
    return ChatErrorDetail(
        code=error.code,
        message=error.message,
        retryable=error.retryable,
    )


def _error_response(error: LLMServiceError) -> JSONResponse:
    payload = ChatErrorResponse(error=_error_detail(error))
    return JSONResponse(
        status_code=error.status_code,
        content=payload.model_dump(mode="json"),
    )


def _sse(event: str, payload: BaseModel) -> str:
    return f"event: {event}\ndata: {payload.model_dump_json()}\n\n"


@router.post(
    "/chat",
    response_model=ChatResponse,
    responses=ERROR_RESPONSES,
)
async def chat(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> ChatResponse | JSONResponse:
    """Non-streaming fallback for clients without ReadableStream support."""
    try:
        return await service.complete(request)
    except LLMServiceError as error:
        return _error_response(error)


@router.post("/chat/stream", response_model=None, responses=ERROR_RESPONSES)
async def chat_stream(
    request: ChatRequest,
    service: ChatService = Depends(get_chat_service),
) -> StreamingResponse | JSONResponse:
    """Stream validated chat events over a POST text/event-stream response."""
    try:
        service.ensure_configured()
    except LLMServiceError as error:
        return _error_response(error)

    conversation_id = service.resolve_conversation_id(request)

    async def event_generator() -> AsyncIterator[str]:
        start = ChatStreamStart(
            conversation_id=conversation_id,
            mode=request.mode,
            metadata=request.metadata,
        )
        yield _sse("start", start)

        content_parts: list[str] = []
        finish_reason = "stop"
        try:
            async for chunk in service.stream_reply(request):
                if chunk.finish_reason:
                    finish_reason = chunk.finish_reason
                if not chunk.delta:
                    continue
                content_parts.append(chunk.delta)
                delta = ChatStreamDelta(
                    conversation_id=conversation_id,
                    delta=chunk.delta,
                )
                yield _sse("delta", delta)

            content = "".join(content_parts)
            if not content.strip():
                raise LLMServiceError(
                    "invalid_response",
                    "硅基流动服务未返回有效文本",
                    status_code=502,
                )
            done = ChatStreamDone(
                conversation_id=conversation_id,
                message=ChatMessage(role="assistant", content=content),
                finish_reason=finish_reason,
            )
            yield _sse("done", done)
        except LLMServiceError as error:
            stream_error = ChatStreamError(
                conversation_id=conversation_id,
                error=_error_detail(error),
            )
            yield _sse("error", stream_error)
        except Exception:
            logger.exception("Unexpected chat streaming error")
            stream_error = ChatStreamError(
                conversation_id=conversation_id,
                error=ChatErrorDetail(
                    code="internal_error",
                    message="对话流意外中断，请稍后重试",
                    retryable=True,
                ),
            )
            yield _sse("error", stream_error)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
