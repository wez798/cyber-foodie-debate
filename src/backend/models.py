"""Pydantic data models for the Cyber Foodie Debate system."""

import json
from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    field_validator,
    model_validator,
)


class AgentPersona(str, Enum):
    """AI大厨人设类型。"""

    SICHUAN_SPICY = "sichuan_spicy"  # 川辣派
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


class ChatMode(str, Enum):
    """通用对话支持的业务模式。"""

    CHAT = "chat"
    DEBATE_PRO = "debate_pro"
    DEBATE_CON = "debate_con"
    JUDGE = "judge"
    RECOMMEND = "recommend"


class ChatMessage(BaseModel):
    """一条经过校验的对话消息；客户端不能提交 system 角色。"""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("消息内容不能为空")
        return value


class ChatTTSInfo(BaseModel):
    """TTS 扩展点；当前版本不执行语音合成。"""

    status: Literal["not_requested"] = "not_requested"
    audio_url: None = None


class ChatRequest(BaseModel):
    """通用对话请求，为后端会话持久化预留扩展字段。"""

    model_config = ConfigDict(extra="forbid")

    conversation_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    mode: ChatMode = ChatMode.CHAT
    topic: Optional[str] = Field(default=None, max_length=200)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("metadata")
    @classmethod
    def limit_metadata_size(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        if len(json.dumps(value, ensure_ascii=False)) > 16_384:
            raise ValueError("metadata 不能超过 16KB")
        return value

    @model_validator(mode="after")
    def latest_message_must_be_from_user(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("最后一条消息必须来自用户")
        return self


class ChatResponse(BaseModel):
    """非流式聊天响应。"""

    conversation_id: str
    message: ChatMessage
    mode: ChatMode
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    finish_reason: str = "stop"
    tts: ChatTTSInfo = Field(default_factory=ChatTTSInfo)


class ChatStreamStart(BaseModel):
    """流式响应的会话开始事件。"""

    conversation_id: str
    mode: ChatMode
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class ChatStreamDelta(BaseModel):
    """流式响应的文本增量事件。"""

    conversation_id: str
    delta: str


class ChatStreamDone(BaseModel):
    """流式响应的完成事件。"""

    conversation_id: str
    message: ChatMessage
    finish_reason: str = "stop"
    tts: ChatTTSInfo = Field(default_factory=ChatTTSInfo)


class ChatErrorDetail(BaseModel):
    """统一的聊天错误详情。"""

    code: str
    message: str
    retryable: bool = False


class ChatErrorResponse(BaseModel):
    """HTTP 错误响应。"""

    error: ChatErrorDetail


class ChatStreamError(BaseModel):
    """响应头发出后通过 SSE 传递的错误事件。"""

    conversation_id: str
    error: ChatErrorDetail
