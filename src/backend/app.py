"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.auth_router import router as auth_router
from .api.chat_router import router as chat_router
from .api.conversation_router import router as conversation_router
from .api.debate_router import router as debate_router
from .api.tts_router import router as tts_router
from .config import settings
from .database import database_is_ready, dispose_database


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用实例。"""

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await dispose_database()

    app = FastAPI(
        title="Cyber Foodie Debate API",
        description="AI校园干饭辩论赛与美食擂台 - 后端API服务",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type", "X-CSRF-Token"],
    )

    app.include_router(debate_router, prefix="/api/v1")
    app.include_router(tts_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(conversation_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api")

    @app.get("/health/live")
    async def liveness() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", response_model=None)
    async def readiness() -> dict[str, str] | JSONResponse:
        if await database_is_ready():
            return {"status": "ready"}
        return JSONResponse(status_code=503, content={"status": "not_ready"})

    @app.get("/")
    async def root():
        return {
            "message": "Cyber Foodie Debate API",
            "version": "0.1.0",
            "docs": "/docs",
        }

    return app


app = create_app()
