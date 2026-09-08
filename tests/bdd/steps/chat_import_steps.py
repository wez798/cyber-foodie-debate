"""Offline acceptance of confirmed import and recoverable retries."""

import asyncio
from tempfile import TemporaryDirectory
from uuid import uuid4

from behave import given, then, when
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.backend.db_models import Base, ConversationEntity, UserEntity
from src.backend.models import ConversationImportRequest
from src.backend.repositories.conversation_repository import (
    SQLAlchemyConversationRepository,
)
from src.backend.services.conversation_service import ConversationService


class NoImportLLM:
    def ensure_configured(self):
        raise AssertionError("Import must stay offline")

    async def stream_reply(self, request):
        raise AssertionError("Import must stay offline")
        yield


@given("用户保留了一份游客完整问答并已登录")
def local_history(context):
    context.import_request = ConversationImportRequest.model_validate(
        {
            "import_request_id": "confirmed-local-snapshot",
            "messages": [
                {"role": "user", "content": "午饭吃什么"},
                {"role": "assistant", "content": "番茄鸡蛋面"},
            ],
        }
    )


@when("用户确认保存本地会话并重试相同请求")
def confirm_import(context):
    async def exercise(database):
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{database}", poolclass=NullPool
        )
        factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            uid = uuid4()
            async with factory() as session:
                session.add(
                    UserEntity(
                        id=uid, email="bdd@example.com", password_hash="test-only"
                    )
                )
                await session.commit()
            ids = []
            for _ in range(2):
                async with factory() as session:
                    service = ConversationService(
                        SQLAlchemyConversationRepository(session), NoImportLLM()
                    )
                    result = await service.import_history(uid, context.import_request)
                    ids.append(result.id)
            async with factory() as session:
                service = ConversationService(
                    SQLAlchemyConversationRepository(session), NoImportLLM()
                )
                page = await service.messages(uid, ids[0], limit=50, cursor=None)
                context.import_ids = ids
                context.import_messages = page.items
                context.import_conversations = list(
                    (await session.scalars(select(ConversationEntity))).all()
                )
        finally:
            await engine.dispose()

    with TemporaryDirectory() as directory:
        asyncio.run(exercise(f"{directory}/import.db"))


@then("云端只有一个导入会话且可读取全部问答")
def check_import(context):
    assert len(set(context.import_ids)) == len(context.import_conversations) == 1
    assert [m.content for m in context.import_messages] == ["午饭吃什么", "番茄鸡蛋面"]
    assert all(m.source == "client_import" for m in context.import_messages)
