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


def confirmed(client):
    return {**PAYLOAD, "expected_user_id": client.get("/api/v1/auth/me").json()["id"]}


def test_import_replay_and_ownership(client_factory):
    with client_factory(NoExternalCalls()) as owner, client_factory(
        NoExternalCalls()
    ) as other:
        register(owner, "import-owner@example.com")
        register(other, "import-other@example.com")
        headers = mutation_headers(owner)
        first = owner.post(
            "/api/v1/conversations/import", json=confirmed(owner), headers=headers
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
            json={**confirmed(owner), "topic": "食堂"},
            headers=headers,
        )
        assert replay.json() == conversation
        assert other.get(f"/api/v1/conversations/{cid}").status_code == 404
        assert other.get(f"/api/v1/conversations/{cid}/messages").status_code == 404
        independent = other.post(
            "/api/v1/conversations/import",
            json=confirmed(other),
            headers=mutation_headers(other),
        )
        assert independent.status_code == 200
        assert independent.json()["id"] != cid
        conflict = owner.post(
            "/api/v1/conversations/import",
            json={**confirmed(owner), "topic": "不同"},
            headers=headers,
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "import_conflict"
        owner.patch(
            f"/api/v1/conversations/{cid}", json={"title": "改名"}, headers=headers
        )
        assert (
            owner.post(
                "/api/v1/conversations/import", json=confirmed(owner), headers=headers
            ).json()["title"]
            == "改名"
        )
        owner.delete(f"/api/v1/conversations/{cid}", headers=headers)
        deleted = owner.post(
            "/api/v1/conversations/import", json=confirmed(owner), headers=headers
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
            client.post(
                "/api/v1/conversations/import", json=confirmed(client)
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/v1/conversations/import",
                json=confirmed(client),
                headers={**mutation_headers(client), "X-CSRF-Token": "wrong"},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/v1/conversations/import",
                json=confirmed(client),
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
                    json={**confirmed(client), **patch},
                    headers=mutation_headers(client),
                ).status_code
                == 422
            )


def test_replay_after_appending_messages(client_factory):
    with client_factory() as client:
        register(client, "import-append@example.com")
        headers = mutation_headers(client)
        cid = client.post(
            "/api/v1/conversations/import", json=confirmed(client), headers=headers
        ).json()["id"]
        response = client.post(
            f"/api/v1/conversations/{cid}/messages/stream",
            json={"content": "再问", "client_request_id": "append"},
            headers=headers,
        )
        assert "event: done" in response.text
        assert (
            client.post(
                "/api/v1/conversations/import", json=confirmed(client), headers=headers
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


def test_confirmation_cannot_follow_a_shared_cookie_switch(client_factory):
    with client_factory(NoExternalCalls()) as tab_a, client_factory(
        NoExternalCalls()
    ) as tab_b:
        register(tab_a, "confirmation-a@example.com")
        preflight = confirmed(tab_a)
        cookies_a = dict(tab_a.cookies)
        register(tab_b, "confirmation-b@example.com")
        # /me already returned A. Both tabs now use B's shared browser cookies.
        tab_a.cookies.clear()
        tab_a.cookies.update(dict(tab_b.cookies))
        response = tab_a.post(
            "/api/v1/conversations/import",
            json=preflight,
            headers=mutation_headers(tab_a),
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "auth_identity_changed"
        assert tab_b.get("/api/v1/conversations").json()["items"] == []
        tab_a.cookies.clear()
        tab_a.cookies.update(cookies_a)
        assert tab_a.get("/api/v1/conversations").json()["items"] == []
        # Mandatory confirmation cannot be omitted even with valid Origin and CSRF.
        assert (
            tab_a.post(
                "/api/v1/conversations/import",
                json=PAYLOAD,
                headers=mutation_headers(tab_a),
            ).status_code
            == 422
        )


@pytest.mark.parametrize("appends", [2, 206])
def test_original_snapshot_verification_is_bounded(
    client_factory, integration_engine, monkeypatch, appends
):
    with client_factory() as client, client_factory(NoExternalCalls()) as other:
        register(client, f"verify-{appends}@example.com")
        register(other, f"verify-other-{appends}@example.com")
        payload = {
            **confirmed(client),
            "messages": [
                {
                    "role": "user" if index % 2 == 0 else "assistant",
                    "content": f"原始 {index}",
                }
                for index in range(50)
            ],
        }
        headers = mutation_headers(client)
        first = client.post(
            "/api/v1/conversations/import", json=payload, headers=headers
        )
        assert first.status_code == 200
        cid = first.json()[
            "id"
        ]  # Simulate a lost response by retrying the same body below.
        factory = async_sessionmaker(integration_engine, expire_on_commit=False)

        async def append():
            async with factory() as session:
                session.add_all(
                    [
                        MessageEntity(
                            conversation_id=UUID(cid),
                            sequence_no=51 + index,
                            role="user" if index % 2 == 0 else "assistant",
                            content=f"追加 {index}",
                            status="complete",
                            source="server",
                        )
                        for index in range(appends)
                    ]
                )
                await session.commit()

        asyncio.run(append())
        client.patch(
            f"/api/v1/conversations/{cid}", json={"title": "改名后"}, headers=headers
        )
        replay = client.post(
            "/api/v1/conversations/import", json=payload, headers=headers
        )
        assert replay.status_code == 200
        assert replay.json()["id"] == cid
        assert replay.json()["title"] == "改名后"
        latest = client.get(f"/api/v1/conversations/{cid}/messages?limit=50").json()
        assert latest["items"][0]["sequence_no"] == appends + 1
        assert latest["next_cursor"]
        reads = []
        original = SQLAlchemyConversationRepository.list_messages

        async def bounded_read(self, **kwargs):
            reads.append((kwargs["limit"], kwargs["before_sequence"]))
            return await original(self, **kwargs)

        monkeypatch.setattr(
            SQLAlchemyConversationRepository, "list_messages", bounded_read
        )
        url = f"/api/v1/conversations/{cid}/import/verify"
        verified = client.post(url, json=payload, headers=headers)
        assert verified.status_code == 200, verified.text
        assert reads == [(50, 51)]
        assert verified.json()["import_request_id"] == payload["import_request_id"]
        assert [m["content"] for m in verified.json()["items"]] == [
            m["content"] for m in payload["messages"]
        ]
        assert client.post(url, json=payload).status_code == 403
        assert (
            client.post(
                url, json=payload, headers={**headers, "Origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert (
            other.post(url, json=payload, headers=mutation_headers(other)).json()[
                "detail"
            ]["code"]
            == "auth_identity_changed"
        )
        assert (
            other.post(
                url,
                json={
                    **payload,
                    "expected_user_id": confirmed(other)["expected_user_id"],
                },
                headers=mutation_headers(other),
            ).status_code
            == 404
        )
        assert (
            client.post(
                url, json={**payload, "topic": "changed"}, headers=headers
            ).json()["detail"]["code"]
            == "import_conflict"
        )

        async def corrupt():
            async with factory() as session:
                rows = list(
                    await session.scalars(
                        select(MessageEntity)
                        .where(MessageEntity.conversation_id == UUID(cid))
                        .order_by(MessageEntity.sequence_no)
                    )
                )
                assert len(rows) == 50 + appends
                rows[0].content = "损坏"
                await session.commit()

        asyncio.run(corrupt())
        assert (
            client.post(url, json=payload, headers=headers).json()["detail"]["code"]
            == "import_verification_failed"
        )
        client.delete(f"/api/v1/conversations/{cid}", headers=headers)
        assert client.post(url, json=payload, headers=headers).status_code == 404
        deleted = client.post(
            "/api/v1/conversations/import", json=payload, headers=headers
        )
        assert deleted.status_code == 409
        assert deleted.json()["detail"]["code"] == "import_deleted"
