"""Password authentication and revocable opaque server-side sessions."""

import asyncio
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends

from ..config import settings
from ..db_models import UserEntity, utc_now
from ..models import UserLoginRequest, UserRegisterRequest, UserResponse
from ..repositories.auth_repository import (
    AuthRepository,
    DuplicateEmailError,
    get_auth_repository,
)


class AuthServiceError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class IssuedSession:
    user: UserResponse
    session_token: str
    csrf_token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class CurrentSession:
    user: UserResponse
    session_id: UUID
    csrf_token_hash: str


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def secrets_match(value: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_secret(value), expected_hash)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class PasswordManager:
    """Central Argon2id configuration and dummy verification hash."""

    def __init__(self) -> None:
        self.hasher = PasswordHasher()
        self._dummy_hash = self.hasher.hash("not-a-real-user-password")

    def hash(self, password: str) -> str:
        return self.hasher.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        try:
            return self.hasher.verify(password_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    def burn_dummy_check(self, password: str) -> None:
        self.verify(self._dummy_hash, password)


password_manager = PasswordManager()


def user_response(user: UserEntity) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at,
    )


class AuthService:
    def __init__(
        self,
        repository: AuthRepository,
        password_service: PasswordManager = password_manager,
    ) -> None:
        self.repository = repository
        self.password_service = password_service

    async def register(self, request: UserRegisterRequest) -> IssuedSession:
        if len(request.password) < settings.password_min_length:
            raise AuthServiceError(
                "weak_password",
                f"密码至少需要 {settings.password_min_length} 个字符",
                status_code=422,
            )
        password_hash = await asyncio.to_thread(
            self.password_service.hash, request.password
        )
        try:
            user = await self.repository.create_user(
                email=str(request.email).lower(),
                password_hash=password_hash,
                display_name=request.display_name,
            )
        except DuplicateEmailError as error:
            raise AuthServiceError(
                "email_exists", "该邮箱已注册", status_code=409
            ) from error
        return await self._issue_session(user)

    async def login(self, request: UserLoginRequest) -> IssuedSession:
        user = await self.repository.get_user_by_email(str(request.email).lower())
        if user is None:
            await asyncio.to_thread(
                self.password_service.burn_dummy_check, request.password
            )
            raise self._invalid_credentials()
        password_matches = await asyncio.to_thread(
            self.password_service.verify, user.password_hash, request.password
        )
        if not password_matches:
            raise self._invalid_credentials()
        if not user.is_active:
            raise self._invalid_credentials()
        return await self._issue_session(user)

    async def authenticate(self, session_token: str | None) -> CurrentSession | None:
        if not session_token:
            return None
        found = await self.repository.get_session_with_user(hash_secret(session_token))
        if not found:
            return None
        auth_session, user = found
        now = utc_now()
        if (
            auth_session.revoked_at is not None
            or _aware_utc(auth_session.expires_at) <= now
            or not user.is_active
        ):
            return None
        if _aware_utc(auth_session.last_seen_at) <= now - timedelta(minutes=5):
            await self.repository.touch_session(auth_session.id, now)
        return CurrentSession(
            user=user_response(user),
            session_id=auth_session.id,
            csrf_token_hash=auth_session.csrf_token_hash,
        )

    async def logout(self, current: CurrentSession) -> None:
        await self.repository.revoke_session(current.session_id)

    async def _issue_session(self, user: UserEntity) -> IssuedSession:
        session_token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        expires_at = utc_now() + timedelta(seconds=settings.session_ttl_seconds)
        await self.repository.create_session(
            user_id=user.id,
            token_hash=hash_secret(session_token),
            csrf_token_hash=hash_secret(csrf_token),
            expires_at=expires_at,
        )
        return IssuedSession(
            user=user_response(user),
            session_token=session_token,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    @staticmethod
    def _invalid_credentials() -> AuthServiceError:
        return AuthServiceError(
            "invalid_credentials", "邮箱或密码错误", status_code=401
        )


def get_auth_service(
    repository: AuthRepository = Depends(get_auth_repository),
) -> AuthService:
    return AuthService(repository)
