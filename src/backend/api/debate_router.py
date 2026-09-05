"""FastAPI routes for debate orchestration and health checks."""

from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..models import (
    DebateErrorDetail,
    DebateRequest,
    DebateResponse,
    DebateResultData,
    DebateRoundData,
    DebateSessionStartData,
    DebateStatus,
    DebateStreamErrorData,
    HealthCheck,
)
from ..services.debate_service import (
    DebateService,
    DebateServiceError,
    get_debate_service,
)
from ..services.llm_service import llm_service
from ..services.tts_service import tts_service

router = APIRouter()


@router.get("/health", response_model=HealthCheck)
async def health_check() -> HealthCheck:
    """Check optional external dependencies; not used for container liveness."""
    llm_ok = await llm_service.health_check()
    tts_ok = await tts_service.health_check()
    return HealthCheck(
        status="ok",
        version="0.1.0",
        llm_available=llm_ok,
        tts_available=tts_ok,
    )


@router.post("/debate/start", response_model=DebateResponse)
async def start_debate(
    request: DebateRequest,
    service: DebateService = Depends(get_debate_service),
) -> DebateResponse:
    """启动一场美食辩论赛。"""
    try:
        return await service.start_debate(request)
    except DebateServiceError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.message
        ) from error


@router.post("/debate/start-stream", response_model=None)
async def start_debate_stream(
    request: DebateRequest,
    service: DebateService = Depends(get_debate_service),
) -> EventSourceResponse:
    """启动辩论并以 SSE 流式返回经过校验的状态。"""

    async def event_generator() -> AsyncIterator[dict[str, str]]:
        try:
            async for update in service.stream_debate(request):
                if isinstance(update, DebateSessionStartData):
                    event_name = "session_start"
                elif isinstance(update, DebateRoundData):
                    event_name = "round"
                elif isinstance(update, DebateResultData):
                    event_name = "result"
                else:
                    raise AssertionError("unknown debate update type")
                yield {"event": event_name, "data": update.model_dump_json()}
        except DebateServiceError as error:
            status: Literal["failed", "timeout"] = (
                "timeout" if error.status == DebateStatus.TIMEOUT else "failed"
            )
            payload = DebateStreamErrorData(
                session_id=error.session_id,
                status=status,
                error=DebateErrorDetail(
                    code=error.code,
                    message=error.message,
                    retryable=error.retryable,
                ),
            )
            yield {"event": "error", "data": payload.model_dump_json()}

    return EventSourceResponse(event_generator())


@router.get("/debate/{session_id}", response_model=DebateResponse)
async def get_debate_session(
    session_id: str,
    service: DebateService = Depends(get_debate_service),
) -> DebateResponse:
    """查询辩论会话状态。"""
    session = service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    return DebateResponse(
        session_id=session.session_id,
        status=session.status,
        rounds=session.rounds,
        result=session.result,
    )
