"""Unit tests for password handling and opaque session validation."""

import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

import pytest

from src.backend.db_models import AuthSessionEntity, UserEntity, utc_now
from src.backend.config import settings
from src.backend.models import UserLoginRequest, UserRegisterRequest
from src.backend.repositories.auth_repository import DuplicateEmailError
from src.backend.services.auth_service import (
    AuthService,
    AuthServiceError,
    hash_secret,
)


class FakeAuthRepository:
    def __init__(self) -> None:
        self.users: dict[str, UserEntity] = {}
        self.sessions: dict[str, AuthSessionEntity] = {}

    async def get_user_by_email(self, email: str) -> UserEntity | None:
        return self.users.get(email)

    async def create_user(
        self, *, email: str, password_hash: str, display_name: str | None
    ) -> UserEntity:
        if email in self.users:
            raise DuplicateEmailError
        user = UserEntity(
            id=uuid4(),
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.users[email] = user
        return user

    async def create_session(
        self,
        *,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at,
    ) -> AuthSessionEntity:
        auth_session = AuthSessionEntity(
            id=uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            csrf_token_hash=csrf_token_hash,
            expires_at=expires_at,
            created_at=utc_now(),
            last_seen_at=utc_now(),
        )
        self.sessions[token_hash] = auth_session
        return auth_session

    async def get_session_with_user(
        self, token_hash: str
    ) -> tuple[AuthSessionEntity, UserEntity] | None:
        auth_session = self.sessions.get(token_hash)
        if not auth_session:
            return None
        user = next(
            user for user in self.users.values() if user.id == auth_session.user_id
        )
        return auth_session, user

    async def revoke_session(self, session_id: UUID) -> None:
        for auth_session in self.sessions.values():
            if auth_session.id == session_id:
                auth_session.revoked_at = utc_now()

    async def touch_session(self, session_id: UUID, seen_at) -> None:
        for auth_session in self.sessions.values():
            if auth_session.id == session_id:
                auth_session.last_seen_at = seen_at


def test_registration_hashes_password_and_normalizes_email() -> None:
    repository = FakeAuthRepository()
    service = AuthService(repository)
    issued = asyncio.run(
        service.register(
            UserRegisterRequest(
                email="Chef@Example.COM",
                password="correct horse battery staple",
                display_name="厨师",
            )
        )
    )

    stored = repository.users["chef@example.com"]
    assert stored.password_hash != "correct horse battery staple"
    assert issued.user.email == "chef@example.com"
    assert repository.sessions[hash_secret(issued.session_token)]


def test_login_uses_same_safe_error_for_missing_user_and_wrong_password() -> None:
    repository = FakeAuthRepository()
    service = AuthService(repository)
    asyncio.run(
        service.register(
            UserRegisterRequest(
                email="chef@example.com",
                password="correct horse battery staple",
            )
        )
    )

    async def login(email: str) -> AuthServiceError:
        with pytest.raises(AuthServiceError) as captured:
            await service.login(UserLoginRequest(email=email, password="wrong"))
        return captured.value

    wrong = asyncio.run(login("chef@example.com"))
    missing = asyncio.run(login("missing@example.com"))
    assert (wrong.status_code, wrong.code, wrong.message) == (
        missing.status_code,
        missing.code,
        missing.message,
    )


def test_expired_and_revoked_sessions_are_rejected() -> None:
    repository = FakeAuthRepository()
    service = AuthService(repository)
    issued = asyncio.run(
        service.register(
            UserRegisterRequest(
                email="session@example.com",
                password="correct horse battery staple",
            )
        )
    )
    stored = repository.sessions[hash_secret(issued.session_token)]
    stored.expires_at = utc_now() - timedelta(seconds=1)
    assert asyncio.run(service.authenticate(issued.session_token)) is None

    stored.expires_at = utc_now() + timedelta(days=1)
    stored.revoked_at = utc_now()
    assert asyncio.run(service.authenticate(issued.session_token)) is None


def test_duplicate_registration_and_disabled_user_are_rejected() -> None:
    repository = FakeAuthRepository()
    service = AuthService(repository)
    request = UserRegisterRequest(
        email="disabled@example.com",
        password="correct horse battery staple",
    )
    asyncio.run(service.register(request))

    with pytest.raises(AuthServiceError) as duplicate:
        asyncio.run(service.register(request))
    assert duplicate.value.code == "email_exists"

    repository.users["disabled@example.com"].is_active = False
    with pytest.raises(AuthServiceError) as disabled:
        asyncio.run(
            service.login(
                UserLoginRequest(
                    email="disabled@example.com",
                    password="correct horse battery staple",
                )
            )
        )
    assert disabled.value.code == "invalid_credentials"


def test_registration_uses_configured_password_minimum(monkeypatch) -> None:
    monkeypatch.setattr(settings, "password_min_length", 8)
    repository = FakeAuthRepository()
    service = AuthService(repository)

    issued = asyncio.run(
        service.register(
            UserRegisterRequest(
                email="eight@example.com",
                password="12345678",
            )
        )
    )

    assert issued.user.email == "eight@example.com"
