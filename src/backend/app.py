"""FastAPI application factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.debate_router import router as debate_router
from .api.tts_router import router as tts_router
from .config import settings


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用实例。"""
    app = FastAPI(
        title="Cyber Foodie Debate API",
        description="AI校园干饭辩论赛与美食擂台 - 后端API服务",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(debate_router, prefix="/api/v1")
    app.include_router(tts_router, prefix="/api/v1")

    @app.get("/")
    async def root():
        return {
            "message": "Cyber Foodie Debate API",
            "version": "0.1.0",
            "docs": "/docs",
        }

    return app


app = create_app()
