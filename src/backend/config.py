"""Application configuration using Pydantic Settings."""

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

    # 模型配置
    vision_model: str = "Qwen3.6-35B-A3B"

    # 微软 TTS
    tts_voice: str = "zh-CN-XiaoxiaoNeural"
    tts_rate: str = "+0%"
    tts_pitch: str = "+0Hz"

    # 应用配置
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = False

    # 辩论配置
    max_debate_rounds: int = 3
    debate_timeout_seconds: int = 60


settings = Settings()
