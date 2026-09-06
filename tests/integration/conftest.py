"""Disposable database and FastAPI client for persistence integration tests."""

import os
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sse_starlette.sse import AppStatus

from src.backend.app import create_app
from src.backend.database import get_db_session
from src.backend.db_models import Base
from src.backend.repositories.conversation_repository import (
    ConversationRepository,
    SQLAlchemyConversationRepository,
)
from src.backend.services.chat_service import get_chat_service
from src.backend.models import ChatRequest
from src.backend.services.conversation_service import (
    ChatGateway,
    ConversationService,
    get_conversation_service,
)
from src.backend.services.llm_service import LLMStreamChunk

LOCAL_DB_PATH = Path("tmp/auth_chat_integration.db")
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", f"sqlite+aiosqlite:///{LOCAL_DB_PATH.as_posix()}"
)


class FakePersistentChatService:
    def ensure_configured(self) -> None:
        return None

    async def stream_reply(
        self, _request: ChatRequest
    ) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(delta="云端")
        yield LLMStreamChunk(delta="回复", finish_reason="stop")


@pytest.fixture(scope="session")
def integration_engine():
    if TEST_DATABASE_URL.startswith("sqlite"):
        # ``tmp`` is intentionally ignored and is absent in a clean checkout.
        LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)

    async def setup() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    import asyncio

    asyncio.run(setup())
    yield engine

    async def teardown() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(teardown())
    if TEST_DATABASE_URL.startswith("sqlite"):
        LOCAL_DB_PATH.unlink(missing_ok=True)


@pytest.fixture()
def client_factory(integration_engine) -> Iterator[Callable[[], TestClient]]:
    factory = async_sessionmaker(integration_engine, expire_on_commit=False)

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    @asynccontextmanager
    async def repository_context() -> AsyncIterator[ConversationRepository]:
        async with factory() as session:
            yield SQLAlchemyConversationRepository(session)

    def build_client(chat_gateway: ChatGateway | None = None) -> TestClient:
        gateway = chat_gateway or FakePersistentChatService()
        # sse-starlette 2.1 keeps this AnyIO event globally; each TestClient owns
        # a separate loop, so tests must let it bind inside the new portal.
        AppStatus.should_exit_event = None
        app = create_app()
        app.dependency_overrides[get_db_session] = override_db_session
        app.dependency_overrides[get_chat_service] = lambda: gateway

        async def configured_conversation_service() -> (
            AsyncIterator[ConversationService]
        ):
            async with factory() as session:
                yield ConversationService(
                    SQLAlchemyConversationRepository(session),
                    gateway,
                    repository_context,
                )

        app.dependency_overrides[get_conversation_service] = (
            configured_conversation_service
        )
        return TestClient(app)

    yield build_client
