"""FastAPI application routes."""

import json
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from ..models import (
    DebateRequest,
    DebateResponse,
    HealthCheck,
    DebateRound,
    DebateResult,
    DebateStatus,
)
from ..services.debate_service import debate_service
from ..services.llm_service import llm_service
from ..services.tts_service import tts_service

router = APIRouter()


@router.get("/health", response_model=HealthCheck)
async def health_check():
    """健康检查接口。"""
    llm_ok = await llm_service.health_check()
    tts_ok = await tts_service.health_check()
    return HealthCheck(
        status="ok",
        version="0.1.0",
        llm_available=llm_ok,
        tts_available=tts_ok,
    )


@router.post("/debate/start", response_model=DebateResponse)
async def start_debate(request: DebateRequest):
    """启动一场美食辩论赛。"""
    if not request.preference.口味:
        raise HTTPException(status_code=400, detail="口味偏好不能为空")
    if not request.preference.预算:
        raise HTTPException(status_code=400, detail="预算范围不能为空")

    try:
        response = await debate_service.start_debate(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"辩论服务异常: {str(e)}")


@router.post("/debate/start-stream")
async def start_debate_stream(request: DebateRequest):
    """启动辩论并以 SSE 流式返回每轮结果。"""
    if not request.preference.口味:
        raise HTTPException(status_code=400, detail="口味偏好不能为空")
    if not request.preference.预算:
        raise HTTPException(status_code=400, detail="预算范围不能为空")

    async def event_generator():
        import uuid
        from datetime import datetime
        from ..models import DebateSession, AgentPersona

        session_id = str(uuid.uuid4())[:8]
        session = DebateSession(
            session_id=session_id,
            preference=request.preference,
            agent_a_persona=request.agent_a_persona,
            agent_b_persona=request.agent_b_persona,
            status=DebateStatus.RUNNING,
        )
        debate_service.sessions[session_id] = session

        yield {
            "event": "session_start",
            "data": json.dumps({"session_id": session_id, "status": "running"}, ensure_ascii=False),
        }

        rounds = []
        for i in range(1, request.max_rounds + 1):
            round_a = await debate_service._generate_argument(
                session, request.agent_a_persona, request.preference, i, rounds
            )
            rounds.append(round_a)
            yield {
                "event": "round",
                "data": json.dumps(
                    {"round": round_a.model_dump(mode="json"), "side": "agent_a"},
                    ensure_ascii=False,
                    default=str,
                ),
            }

            round_b = await debate_service._generate_argument(
                session, request.agent_b_persona, request.preference, i, rounds
            )
            rounds.append(round_b)
            yield {
                "event": "round",
                "data": json.dumps(
                    {"round": round_b.model_dump(mode="json"), "side": "agent_b"},
                    ensure_ascii=False,
                    default=str,
                ),
            }

        result = await debate_service._judge_debate(session, rounds)
        session.rounds = rounds
        session.result = result
        session.status = DebateStatus.COMPLETED

        yield {
            "event": "result",
            "data": json.dumps(
                {
                    "session_id": session_id,
                    "status": "completed",
                    "rounds": [r.model_dump(mode="json") for r in rounds],
                    "result": result.model_dump(mode="json"),
                },
                ensure_ascii=False,
                default=str,
            ),
        }

    return EventSourceResponse(event_generator())


@router.get("/debate/{session_id}", response_model=DebateResponse)
async def get_debate_session(session_id: str):
    """查询辩论会话状态。"""
    session = debate_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    return DebateResponse(
        session_id=session.session_id,
        status=session.status,
        rounds=session.rounds,
        result=session.result,
    )
