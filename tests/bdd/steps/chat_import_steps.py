"""Offline acceptance of confirmed import and recoverable retries."""

import asyncio
from tempfile import TemporaryDirectory
from uuid import uuid4

from behave import given, then, when
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.backend.db_models import Base, ConversationEntity, MessageEntity, UserEntity
from src.backend.app import create_app
from src.backend.database import get_db_session
from src.backend.services.chat_service import get_chat_service
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


@when("原导入已追加很多消息并改名后用户再次核对")
def verify_appended_import(context):
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
                        id=uid,
                        email="verify-bdd@example.com",
                        password_hash="test-only",
                    )
                )
                await session.commit()
                service = ConversationService(
                    SQLAlchemyConversationRepository(session), NoImportLLM()
                )
                imported = await service.import_history(uid, context.import_request)
                entity = await session.get(ConversationEntity, imported.id)
                entity.title = "改名"
                session.add_all(
                    [
                        MessageEntity(
                            conversation_id=imported.id,
                            sequence_no=i + 3,
                            role="user",
                            content=f"追加 {i}",
                            source="server",
                            status="complete",
                        )
                        for i in range(200)
                    ]
                )
                await session.commit()
            async with factory() as session:
                service = ConversationService(
                    SQLAlchemyConversationRepository(session), NoImportLLM()
                )
                replay = await service.import_history(uid, context.import_request)
                assert replay.id == imported.id
                assert replay.title == "改名"
                context.verified = await service.verify_import(
                    uid, imported.id, context.import_request
                )
                context.latest = await service.messages(
                    uid, imported.id, limit=50, cursor=None
                )
        finally:
            await engine.dispose()

    with TemporaryDirectory() as directory:
        asyncio.run(exercise(f"{directory}/verify.db"))


@then("核对覆盖原始快照且最近页保持独立")
def check_verification(context):
    assert [m.content for m in context.verified.items] == [
        m.content for m in context.import_request.messages
    ]
    assert len(context.latest.items) == 50
    assert context.latest.items[0].sequence_no == 153
    assert context.latest.next_cursor


@when("确认账号 A 后共享 Cookie 已切换为账号 B")
def switch_confirmed_account(context):
    with TemporaryDirectory() as directory:
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{directory}/identity.db", poolclass=NullPool
        )
        factory = async_sessionmaker(engine, expire_on_commit=False)

        async def initialize():
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)

        async def database():
            async with factory() as session:
                yield session

        asyncio.run(initialize())
        app = create_app()
        app.dependency_overrides[get_db_session] = database
        app.dependency_overrides[get_chat_service] = lambda: NoImportLLM()
        try:
            with TestClient(app) as client:

                def register_account(name):
                    result = client.post(
                        "/api/v1/auth/register",
                        headers={"Origin": "http://localhost:5173"},
                        json={
                            "email": f"bdd-{name}@example.com",
                            "password": "disposable-test-password",
                        },
                    )
                    assert result.status_code == 201
                    return result.json()["user"]["id"]

                account_a = register_account("a")
                cookies_a = dict(client.cookies)
                register_account("b")
                response = client.post(
                    "/api/v1/conversations/import",
                    json={
                        **context.import_request.model_dump(),
                        "expected_user_id": account_a,
                    },
                    headers={
                        "Origin": "http://localhost:5173",
                        "X-CSRF-Token": client.cookies["cfd_csrf"],
                    },
                )
                context.identity_status = response.status_code
                context.identity_error = response.json()["detail"]["code"]
                context.account_b_conversations = client.get(
                    "/api/v1/conversations"
                ).json()["items"]
                client.cookies.clear()
                client.cookies.update(cookies_a)
                context.account_a_conversations = client.get(
                    "/api/v1/conversations"
                ).json()["items"]
        finally:
            asyncio.run(engine.dispose())


@then("导入被稳定拒绝且两个账号都没有新增会话")
def check_identity_rejection(context):
    assert context.identity_status == 409
    assert context.identity_error == "auth_identity_changed"
    assert context.account_a_conversations == context.account_b_conversations == []
