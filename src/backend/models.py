"""Pydantic data models for the Cyber Foodie Debate system."""

from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum
from datetime import datetime


class AgentPersona(str, Enum):
    """AI大厨人设类型。"""
    SICHUAN_SPICY = "sichuan_spicy"       # 川辣派
    CANTONESE_HEALTHY = "cantonese_healthy"  # 粤式养生派
    CUSTOM = "custom"


class DebateStatus(str, Enum):
    """辩论状态。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    TIMEOUT = "timeout"


class FoodPreference(BaseModel):
    """用户饮食偏好。"""
    口味: str = Field(..., description="口味偏好，如：辣、清淡、酸甜")
    预算: str = Field(..., description="预算范围，如：10-20元")
    天气: Optional[str] = Field(None, description="当前天气，如：晴天、雨天")
    忌口: Optional[str] = Field(None, description="忌口/过敏信息")
    其他要求: Optional[str] = Field(None, description="其他特殊要求")


class DebateRound(BaseModel):
    """单轮辩论内容。"""
    round_number: int = Field(..., ge=1)
    speaker: AgentPersona
    content: str
    reasoning: Optional[str] = Field(None, description="推理过程")


class DebateResult(BaseModel):
    """辩论最终结果。"""
    winner: AgentPersona
    recommendation: str
    dish_name: str
    restaurant_suggestion: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)


class DebateSession(BaseModel):
    """完整辩论会话。"""
    session_id: str
    preference: FoodPreference
    agent_a_persona: AgentPersona = AgentPersona.SICHUAN_SPICY
    agent_b_persona: AgentPersona = AgentPersona.CANTONESE_HEALTHY
    rounds: list[DebateRound] = Field(default_factory=list)
    result: Optional[DebateResult] = None
    status: DebateStatus = DebateStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None


class DebateRequest(BaseModel):
    """发起辩论的请求体。"""
    preference: FoodPreference
    agent_a_persona: AgentPersona = AgentPersona.SICHUAN_SPICY
    agent_b_persona: AgentPersona = AgentPersona.CANTONESE_HEALTHY
    max_rounds: int = Field(default=3, ge=1, le=5)


class DebateResponse(BaseModel):
    """辩论响应。"""
    session_id: str
    status: DebateStatus
    rounds: list[DebateRound]
    result: Optional[DebateResult] = None


class HealthCheck(BaseModel):
    """健康检查响应。"""
    status: str = "ok"
    version: str = "0.1.0"
    llm_available: bool = False
    tts_available: bool = False
