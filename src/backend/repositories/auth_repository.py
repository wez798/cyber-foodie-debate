"""Async repository for users and opaque authentication sessions."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db_session
from ..db_models import AuthSessionEntity, UserEntity, utc_now


class DuplicateEmailError(Exception):
    """Raised when account creation races with an existing email."""


class AuthRepository(Protocol):
    async def get_user_by_email(self, email: str) -> UserEntity | None: ...

    async def create_user(
        self, *, email: str, password_hash: str, display_name: str | None
    ) -> UserEntity: ...

    async def create_session(
        self,
        *,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ) -> AuthSessionEntity: ...

    async def get_session_with_user(
        self, token_hash: str
    ) -> tuple[AuthSessionEntity, UserEntity] | None: ...

    async def revoke_session(self, session_id: UUID) -> None: ...

    async def touch_session(self, session_id: UUID, seen_at: datetime) -> None: ...


class SQLAlchemyAuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_user_by_email(self, email: str) -> UserEntity | None:
        result = await self.session.execute(
            select(UserEntity).where(UserEntity.email == email)
        )
        return result.scalar_one_or_none()

    async def create_user(
        self, *, email: str, password_hash: str, display_name: str | None
    ) -> UserEntity:
        user = UserEntity(
            email=email,
            password_hash=password_hash,
            display_name=display_name,
        )
        self.session.add(user)
        try:
            await self.session.commit()
        except IntegrityError as error:
            await self.session.rollback()
            raise DuplicateEmailError from error
        await self.session.refresh(user)
        return user

    async def create_session(
        self,
        *,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ) -> AuthSessionEntity:
        auth_session = AuthSessionEntity(
            user_id=user_id,
            token_hash=token_hash,
            csrf_token_hash=csrf_token_hash,
            expires_at=expires_at,
        )
        self.session.add(auth_session)
        await self.session.commit()
        await self.session.refresh(auth_session)
        return auth_session

    async def get_session_with_user(
        self, token_hash: str
    ) -> tuple[AuthSessionEntity, UserEntity] | None:
        result = await self.session.execute(
            select(AuthSessionEntity, UserEntity)
            .join(UserEntity, UserEntity.id == AuthSessionEntity.user_id)
            .where(AuthSessionEntity.token_hash == token_hash)
        )
        row = result.one_or_none()
        return (row[0], row[1]) if row else None

    async def revoke_session(self, session_id: UUID) -> None:
        auth_session = await self.session.get(AuthSessionEntity, session_id)
        if auth_session and auth_session.revoked_at is None:
            auth_session.revoked_at = utc_now()
            await self.session.commit()

    async def touch_session(self, session_id: UUID, seen_at: datetime) -> None:
        auth_session = await self.session.get(AuthSessionEntity, session_id)
        if auth_session:
            auth_session.last_seen_at = seen_at
            await self.session.commit()


def get_auth_repository(
    session: AsyncSession = Depends(get_db_session),
) -> AuthRepository:
    return SQLAlchemyAuthRepository(session)
