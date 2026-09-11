"""Asynchronous database engine and request-scoped session dependency."""

import asyncio
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings


def create_engine(database_url: str | None = None) -> AsyncEngine:
    """Create a lazy async engine for PostgreSQL or a test database."""
    return create_async_engine(
        database_url or settings.database_url,
        pool_pre_ping=True,
    )


engine = create_engine()
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Yield one SQLAlchemy session per request and always close it."""
    async with session_factory() as session:
        yield session


async def database_is_ready(db_engine: AsyncEngine = engine) -> bool:
    """Perform a bounded lightweight readiness probe without external APIs."""

    async def probe() -> None:
        async with db_engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(probe(), timeout=settings.database_ready_timeout_seconds)
    except Exception:
        return False
    return True


async def dispose_database() -> None:
    """Dispose pooled connections when the application shuts down."""
    await engine.dispose()
