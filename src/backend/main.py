"""Backend server entry point."""

import logging
import uvicorn
from .config import settings

# 配置结构化日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cyber_foodie_debate")


def main():
    """启动后端服务。"""
    logger.info(f"Starting Cyber Foodie Debate API on {settings.app_host}:{settings.app_port}")
    uvicorn.run(
        "src.backend.app:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
        log_level="info",
    )


if __name__ == "__main__":
    main()
