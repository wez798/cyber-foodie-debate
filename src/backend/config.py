"""Application configuration using Pydantic Settings."""

from pydantic import Field, HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从 .env 文件加载。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 硅基流动 API
    siliconflow_api_key: str = ""
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"
    siliconflow_model: str = "deepseek-ai/DeepSeek-V4-Flash"
    siliconflow_max_requests_per_minute: int = Field(default=60, ge=1, le=10_000)
    siliconflow_max_concurrency: int = Field(default=4, ge=1, le=100)

    # 模型配置
    vision_model: str = "Qwen3.6-35B-A3B"

    # 微软 TTS
    tts_voice: str = "zh-CN-XiaoxiaoNeural"
    tts_rate: str = "+0%"
    tts_pitch: str = "+0Hz"
    tts_proxy: HttpUrl | None = None
    tts_timeout_seconds: float = Field(default=30, gt=0, le=120)

    @field_validator("tts_proxy", mode="before")
    @classmethod
    def empty_tts_proxy(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    # 应用配置
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = False

    # 数据库与认证
    database_url: str = (
        "postgresql+asyncpg://cyber_foodie:cyber_foodie@localhost:5432/cyber_foodie"
    )
    database_ready_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    frontend_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5185",
            "http://127.0.0.1:5185",
        ]
    )
    session_cookie_name: str = "cfd_session"
    csrf_cookie_name: str = "cfd_csrf"
    session_ttl_seconds: int = Field(default=604_800, ge=300, le=2_592_000)
    session_cookie_secure: bool = False
    password_min_length: int = Field(default=10, ge=8, le=128)
    cloud_generation_stale_seconds: int = Field(default=180, ge=30, le=3600)

    # 辩论配置
    max_debate_rounds: int = 3
    debate_timeout_seconds: int = 60

    @field_validator("frontend_origins")
    @classmethod
    def validate_frontend_origins(cls, value: list[str]) -> list[str]:
        origins = [origin.strip().rstrip("/") for origin in value if origin.strip()]
        if not origins or "*" in origins:
            raise ValueError("FRONTEND_ORIGINS 必须包含明确来源，不能使用通配符")
        return origins


settings = Settings()
