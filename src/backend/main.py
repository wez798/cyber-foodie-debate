"""Backend server entry point."""

import uvicorn
from .config import settings


def main():
    """启动后端服务。"""
    uvicorn.run(
        "src.backend.app:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
