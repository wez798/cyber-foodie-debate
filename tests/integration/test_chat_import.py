"""Atomic import, access control and immutable replay on isolated databases."""

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.backend.db_models import ConversationEntity, MessageEntity
from src.backend.models import ConversationImportRequest
from src.backend.repositories.conversation_repository import (
    SQLAlchemyConversationRepository,
)
from src.backend.services.conversation_service import ConversationService
from test_auth_chat_persistence import mutation_headers, register

PAYLOAD = {
    "import_request_id": "local-1",
    "topic": " 食堂 ",
    "messages": [
        {"role": "assistant", "content": "先问我吧"},
        {"role": "user", "content": "午饭" * 80},
        {"role": "assistant", "content": "<script>untrusted</script>"},
    ],
}


class NoExternalCalls:
    def ensure_configured(self):
        raise AssertionError("Import must not configure external services")

    async def stream_reply(self, request):
        raise AssertionError("Import must not call external services")
        yield  # pragma: no cover


def test_import_replay_and_ownership(client_factory):
    with client_factory(NoExternalCalls()) as owner, client_factory(
        NoExternalCalls()
    ) as other:
        register(owner, "import-owner@example.com")
        register(other, "import-other@example.com")
        headers = mutation_headers(owner)
        first = owner.post(
            "/api/v1/conversations/import", json=PAYLOAD, headers=headers
        )
        assert first.status_code == 200, first.text
        conversation = first.json()
        cid = conversation["id"]
        assert conversation["title"] == ("午饭" * 80)[:117] + "..."
        assert conversation["mode"] == "chat"
        assert conversation["topic"] == "食堂"
        assert conversation["created_at"].endswith("Z")
        messages = owner.get(f"/api/v1/conversations/{cid}/messages").json()["items"]
        assert [m["sequence_no"] for m in messages] == [1, 2, 3]
        assert [m["content"] for m in messages] == [
            m["content"] for m in PAYLOAD["messages"]
        ]
        assert all(
            m["source"] == "client_import" and m["status"] == "complete"
            for m in messages
        )
        replay = owner.post(
            "/api/v1/conversations/import",
            json={**PAYLOAD, "topic": "食堂"},
            headers=headers,
        )
        assert replay.json() == conversation
        assert other.get(f"/api/v1/conversations/{cid}").status_code == 404
        assert other.get(f"/api/v1/conversations/{cid}/messages").status_code == 404
        independent = other.post(
            "/api/v1/conversations/import",
            json=PAYLOAD,
            headers=mutation_headers(other),
        )
        assert independent.status_code == 200
        assert independent.json()["id"] != cid
        conflict = owner.post(
            "/api/v1/conversations/import",
            json={**PAYLOAD, "topic": "不同"},
            headers=headers,
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "import_conflict"
        owner.patch(
            f"/api/v1/conversations/{cid}", json={"title": "改名"}, headers=headers
        )
        assert (
            owner.post(
                "/api/v1/conversations/import", json=PAYLOAD, headers=headers
            ).json()["title"]
            == "改名"
        )
        owner.delete(f"/api/v1/conversations/{cid}", headers=headers)
        deleted = owner.post(
            "/api/v1/conversations/import", json=PAYLOAD, headers=headers
        )
        assert deleted.status_code == 409
        assert deleted.json()["detail"]["code"] == "import_deleted"
        assert owner.get("/api/v1/conversations").json()["items"] == []


def test_import_auth_csrf_and_validation(client_factory):
    with client_factory(NoExternalCalls()) as client:
        assert (
            client.post(
                "/api/v1/conversations/import",
                json=PAYLOAD,
                headers={"Origin": "http://localhost:5173"},
            ).status_code
            == 401
        )
        register(client, "import-validation@example.com")
        assert (
            client.post("/api/v1/conversations/import", json=PAYLOAD).status_code == 403
        )
        assert (
            client.post(
                "/api/v1/conversations/import",
                json=PAYLOAD,
                headers={**mutation_headers(client), "X-CSRF-Token": "wrong"},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/v1/conversations/import",
                json=PAYLOAD,
                headers={**mutation_headers(client), "Origin": "https://evil.example"},
            ).status_code
            == 403
        )
        for patch in [
            {"owner": "forged"},
            {"messages": []},
            {"messages": [{"role": "system", "content": "attack"}]},
        ]:
            assert (
                client.post(
                    "/api/v1/conversations/import",
                    json={**PAYLOAD, **patch},
                    headers=mutation_headers(client),
                ).status_code
                == 422
            )


def test_replay_after_appending_messages(client_factory):
    with client_factory() as client:
        register(client, "import-append@example.com")
        headers = mutation_headers(client)
        cid = client.post(
            "/api/v1/conversations/import", json=PAYLOAD, headers=headers
        ).json()["id"]
        response = client.post(
            f"/api/v1/conversations/{cid}/messages/stream",
            json={"content": "再问", "client_request_id": "append"},
            headers=headers,
        )
        assert "event: done" in response.text
        assert (
            client.post(
                "/api/v1/conversations/import", json=PAYLOAD, headers=headers
            ).json()["id"]
            == cid
        )
        assert (
            len(client.get(f"/api/v1/conversations/{cid}/messages").json()["items"])
            == 5
        )


def test_concurrent_imports(integration_engine, client_factory, monkeypatch):
    with client_factory() as client:
        register(client, "import-concurrent@example.com")
        uid = UUID(client.get("/api/v1/auth/me").json()["id"])
    factory = async_sessionmaker(integration_engine, expire_on_commit=False)
    original = SQLAlchemyConversationRepository._find_import

    async def exercise():
        arrived = 0
        ready = asyncio.Event()

        async def synchronized_find(self, *args):
            nonlocal arrived
            result = await original(self, *args)
            if result is None:
                arrived += 1
                if arrived == 4:
                    ready.set()
                await asyncio.wait_for(ready.wait(), 5)
            return result

        monkeypatch.setattr(
            SQLAlchemyConversationRepository, "_find_import", synchronized_find
        )

        async def run():
            async with factory() as session:
                service = ConversationService(
                    SQLAlchemyConversationRepository(session), NoExternalCalls()
                )
                return await service.import_history(
                    uid, ConversationImportRequest.model_validate(PAYLOAD)
                )

        imported = await asyncio.gather(*(run() for _ in range(4)))
        assert len({item.id for item in imported}) == 1
        async with factory() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(ConversationEntity)
                    .where(ConversationEntity.user_id == uid)
                )
                == 1
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(MessageEntity)
                    .where(MessageEntity.conversation_id == imported[0].id)
                )
                == 3
            )

    asyncio.run(exercise())


def test_import_write_failure_rolls_back(integration_engine, client_factory):
    with client_factory() as client:
        register(client, "import-rollback@example.com")
        uid = UUID(client.get("/api/v1/auth/me").json()["id"])
    factory = async_sessionmaker(integration_engine, expire_on_commit=False)

    def fail_messages(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO messages"):
            raise RuntimeError("injected message write failure")

    async def exercise():
        event.listen(
            integration_engine.sync_engine, "before_cursor_execute", fail_messages
        )
        try:
            async with factory() as session:
                service = ConversationService(
                    SQLAlchemyConversationRepository(session), NoExternalCalls()
                )
                with pytest.raises(RuntimeError, match="injected"):
                    await service.import_history(
                        uid, ConversationImportRequest.model_validate(PAYLOAD)
                    )
        finally:
            event.remove(
                integration_engine.sync_engine, "before_cursor_execute", fail_messages
            )
        async with factory() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(ConversationEntity)
                    .where(ConversationEntity.user_id == uid)
                )
                == 0
            )
            service = ConversationService(
                SQLAlchemyConversationRepository(session), NoExternalCalls()
            )
            result = await service.import_history(
                uid, ConversationImportRequest.model_validate(PAYLOAD)
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(MessageEntity)
                    .where(MessageEntity.conversation_id == result.id)
                )
                == 3
            )

    asyncio.run(exercise())
