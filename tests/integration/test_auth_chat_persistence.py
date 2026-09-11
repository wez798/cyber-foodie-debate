"""Authentication, ownership and durable SSE integration coverage."""

from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from src.backend.models import ChatRequest
from src.backend.services.llm_service import LLMServiceError, LLMStreamChunk

ORIGIN = "http://localhost:5173"


def mutation_headers(client: TestClient) -> dict[str, str]:
    csrf = client.cookies.get("cfd_csrf")
    assert csrf
    return {"Origin": ORIGIN, "X-CSRF-Token": csrf}


def register(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/v1/auth/register",
        headers={"Origin": ORIGIN},
        json={
            "email": email,
            "password": "correct horse battery staple",
            "display_name": "测试用户",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["email"] == email
    assert "cfd_session" in response.cookies
    assert response.cookies.get("cfd_session")
    set_cookie = response.headers.get_list("set-cookie")
    session_cookie = next(value for value in set_cookie if "cfd_session=" in value)
    assert "HttpOnly" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "Path=/" in session_cookie


class PartialTimeoutChatService:
    def ensure_configured(self) -> None:
        return None

    async def stream_reply(
        self, _request: ChatRequest
    ) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(delta="未完成内容")
        raise LLMServiceError(
            "timeout", "模型响应超时", status_code=504, retryable=True
        )


def test_registration_session_csrf_and_logout(client_factory) -> None:
    with client_factory() as client:
        register(client, "auth@example.com")

        me = client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == "auth@example.com"

        rejected = client.post("/api/v1/conversations", json={"mode": "chat"})
        assert rejected.status_code == 403

        wrong_csrf = client.post(
            "/api/v1/conversations",
            headers={"Origin": ORIGIN, "X-CSRF-Token": "wrong"},
            json={"mode": "chat"},
        )
        assert wrong_csrf.status_code == 403

        created = client.post(
            "/api/v1/conversations",
            headers=mutation_headers(client),
            json={"mode": "chat", "topic": "校园午饭"},
        )
        assert created.status_code == 201

        logged_out = client.post(
            "/api/v1/auth/logout", headers=mutation_headers(client)
        )
        assert logged_out.status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401


def test_duplicate_registration_and_unauthenticated_history(client_factory) -> None:
    with client_factory() as client:
        register(client, "duplicate@example.com")
        duplicate = client.post(
            "/api/v1/auth/register",
            headers={"Origin": ORIGIN},
            json={
                "email": "duplicate@example.com",
                "password": "correct horse battery staple",
            },
        )
        assert duplicate.status_code == 409

    with client_factory() as anonymous:
        assert anonymous.get("/api/v1/conversations").status_code == 401


def test_auth_mutations_reject_missing_and_forged_origins(client_factory) -> None:
    payload = {
        "email": "origin@example.com",
        "password": "correct horse battery staple",
    }
    with client_factory() as client:
        missing = client.post("/api/v1/auth/register", json=payload)
        forged = client.post(
            "/api/v1/auth/register",
            headers={"Origin": "https://attacker.example"},
            json=payload,
        )

        assert missing.status_code == 403
        assert forged.status_code == 403


def test_login_errors_do_not_disclose_account_existence(client_factory) -> None:
    with client_factory() as client:
        register(client, "login@example.com")
        client.post("/api/v1/auth/logout", headers=mutation_headers(client))

        wrong_password = client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"email": "login@example.com", "password": "wrong"},
        )
        missing_account = client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"email": "missing@example.com", "password": "wrong"},
        )

        assert wrong_password.status_code == missing_account.status_code == 401
        assert wrong_password.json() == missing_account.json()


def test_chat_stream_is_persisted_and_idempotent(client_factory) -> None:
    with client_factory() as client:
        register(client, "chat@example.com")
        headers = mutation_headers(client)
        created = client.post(
            "/api/v1/conversations",
            headers=headers,
            json={"mode": "chat", "topic": "食堂"},
        )
        conversation_id = created.json()["id"]
        payload = {
            "content": "预算二十元吃什么？",
            "client_request_id": "request-1",
        }

        streamed = client.post(
            f"/api/v1/conversations/{conversation_id}/messages/stream",
            headers=headers,
            json=payload,
        )
        assert streamed.status_code == 200
        assert "event: start" in streamed.text
        assert streamed.text.count("event: delta") == 2
        assert "event: done" in streamed.text
        assert "云端回复" in streamed.text

        replayed = client.post(
            f"/api/v1/conversations/{conversation_id}/messages/stream",
            headers=headers,
            json=payload,
        )
        assert replayed.status_code == 200
        assert "event: done" in replayed.text
        assert "event: delta" not in replayed.text

        messages = client.get(f"/api/v1/conversations/{conversation_id}/messages")
        assert messages.status_code == 200
        body = messages.json()
        assert len(body["items"]) == 2
        assert body["items"][0]["content"] == "预算二十元吃什么？"
        assert body["items"][1]["content"] == "云端回复"
        assert body["items"][1]["status"] == "complete"


def test_conversations_are_private_between_users(client_factory) -> None:
    with client_factory() as owner, client_factory() as stranger:
        register(owner, "owner@example.com")
        register(stranger, "stranger@example.com")
        created = owner.post(
            "/api/v1/conversations",
            headers=mutation_headers(owner),
            json={"mode": "chat"},
        )
        conversation_id = created.json()["id"]

        assert (
            stranger.get(f"/api/v1/conversations/{conversation_id}").status_code == 404
        )
        assert (
            stranger.get(
                f"/api/v1/conversations/{conversation_id}/messages"
            ).status_code
            == 404
        )


def test_conversation_pagination_archive_and_soft_delete(client_factory) -> None:
    with client_factory() as client:
        register(client, "history@example.com")
        headers = mutation_headers(client)
        created_ids = [
            client.post(
                "/api/v1/conversations",
                headers=headers,
                json={"mode": "chat", "topic": f"话题 {index}"},
            ).json()["id"]
            for index in range(3)
        ]

        first_page = client.get("/api/v1/conversations?limit=2")
        assert first_page.status_code == 200
        assert len(first_page.json()["items"]) == 2
        cursor = first_page.json()["next_cursor"]
        assert cursor
        second_page = client.get(
            "/api/v1/conversations", params={"limit": 2, "cursor": cursor}
        )
        assert second_page.status_code == 200, second_page.text
        assert len(second_page.json()["items"]) == 1

        archived = client.patch(
            f"/api/v1/conversations/{created_ids[0]}",
            headers=headers,
            json={"archived": True},
        )
        assert archived.status_code == 200
        visible_ids = {
            item["id"] for item in client.get("/api/v1/conversations").json()["items"]
        }
        assert created_ids[0] not in visible_ids
        archived_ids = {
            item["id"]
            for item in client.get(
                "/api/v1/conversations?include_archived=true"
            ).json()["items"]
        }
        assert created_ids[0] in archived_ids

        deleted = client.delete(
            f"/api/v1/conversations/{created_ids[1]}", headers=headers
        )
        assert deleted.status_code == 204
        assert client.get(f"/api/v1/conversations/{created_ids[1]}").status_code == 404


def test_noop_conversation_update_preserves_cursor_timestamp(client_factory) -> None:
    with client_factory() as client:
        register(client, "noop-update@example.com")
        headers = mutation_headers(client)
        created = client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "chat"}
        ).json()

        unchanged = client.patch(
            f"/api/v1/conversations/{created['id']}",
            headers=headers,
            json={"title": created["title"], "archived": False},
        )

        assert unchanged.status_code == 200
        assert unchanged.json()["updated_at"] == created["updated_at"]


def test_invalid_pagination_cursors_return_stable_422(client_factory) -> None:
    with client_factory() as client:
        register(client, "cursor@example.com")
        headers = mutation_headers(client)
        conversation_id = client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "chat"}
        ).json()["id"]

        conversations = client.get(
            "/api/v1/conversations", params={"cursor": "not-base64"}
        )
        messages = client.get(
            f"/api/v1/conversations/{conversation_id}/messages",
            params={"cursor": "not-base64"},
        )

        assert conversations.status_code == 422
        assert conversations.json()["detail"]["code"] == "invalid_cursor"
        assert messages.status_code == 422
        assert messages.json()["detail"]["code"] == "invalid_cursor"


def test_latest_messages_are_cursor_paginated(client_factory) -> None:
    with client_factory() as client:
        register(client, "messages@example.com")
        headers = mutation_headers(client)
        conversation_id = client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "chat"}
        ).json()["id"]
        for index in range(2):
            response = client.post(
                f"/api/v1/conversations/{conversation_id}/messages/stream",
                headers=headers,
                json={
                    "content": f"问题 {index}",
                    "client_request_id": f"page-{index}",
                },
            )
            assert response.status_code == 200

        first = client.get(
            f"/api/v1/conversations/{conversation_id}/messages?limit=2"
        ).json()
        assert [item["sequence_no"] for item in first["items"]] == [3, 4]
        second = client.get(
            f"/api/v1/conversations/{conversation_id}/messages",
            params={"limit": 2, "cursor": first["next_cursor"]},
        ).json()
        assert [item["sequence_no"] for item in second["items"]] == [1, 2]
        assert second["next_cursor"] is None


def test_partial_timeout_emits_error_and_persists_failed_status(
    client_factory,
) -> None:
    with client_factory(PartialTimeoutChatService()) as client:
        register(client, "timeout@example.com")
        headers = mutation_headers(client)
        conversation_id = client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "chat"}
        ).json()["id"]
        streamed = client.post(
            f"/api/v1/conversations/{conversation_id}/messages/stream",
            headers=headers,
            json={"content": "会超时吗？", "client_request_id": "timeout-1"},
        )

        assert streamed.status_code == 200
        assert "event: delta" in streamed.text
        assert "event: error" in streamed.text
        assert "event: done" not in streamed.text
        messages = client.get(
            f"/api/v1/conversations/{conversation_id}/messages"
        ).json()["items"]
        assert messages[-1]["status"] == "failed"
        assert messages[-1]["error_code"] == "timeout"


def test_history_survives_new_app_client_and_relogin(client_factory) -> None:
    email = "restart@example.com"
    password = "correct horse battery staple"
    with client_factory() as first_client:
        register(first_client, email)
        headers = mutation_headers(first_client)
        conversation_id = first_client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "chat"}
        ).json()["id"]
        first_client.post(
            f"/api/v1/conversations/{conversation_id}/messages/stream",
            headers=headers,
            json={"content": "重启后还在吗？", "client_request_id": "restart-1"},
        )

    with client_factory() as restarted_client:
        login = restarted_client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"email": email, "password": password},
        )
        assert login.status_code == 200
        messages = restarted_client.get(
            f"/api/v1/conversations/{conversation_id}/messages"
        )
        assert messages.status_code == 200
        assert [item["content"] for item in messages.json()["items"]] == [
            "重启后还在吗？",
            "云端回复",
        ]
