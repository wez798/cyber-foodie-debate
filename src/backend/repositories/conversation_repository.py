"""Async repository for user-owned conversations and atomic generations."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID, uuid4

from fastapi import Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db_session, session_factory
from ..db_models import ConversationEntity, MessageEntity, utc_now
from ..models import ChatMode, MessageStatus

CONVERSATION_TITLE_MAX_LENGTH = 120
ELLIPSIS = "..."


class ConversationNotFoundError(Exception):
    """A requested conversation is absent or belongs to another user."""


class ConversationBusyError(Exception):
    """Only one generation may run in one conversation at a time."""


class DuplicateMessageRequestError(Exception):
    def __init__(self, user_message: MessageEntity, assistant_message: MessageEntity):
        super().__init__("duplicate message request")
        self.user_message = user_message
        self.assistant_message = assistant_message


@dataclass(slots=True)
class PreparedGeneration:
    conversation: ConversationEntity
    user_message: MessageEntity
    assistant_message: MessageEntity
    context_messages: list[MessageEntity]


class ConversationRepository(Protocol):
    async def create_conversation(
        self, *, user_id: UUID, mode: ChatMode, topic: str | None
    ) -> ConversationEntity: ...

    async def get_owned(
        self, *, user_id: UUID, conversation_id: UUID
    ) -> ConversationEntity | None: ...

    async def list_owned(
        self,
        *,
        user_id: UUID,
        limit: int,
        before: tuple[datetime, UUID] | None,
        include_archived: bool,
    ) -> list[ConversationEntity]: ...

    async def update_owned(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        title: str | None,
        archived: bool | None,
    ) -> ConversationEntity: ...

    async def soft_delete_owned(
        self, *, user_id: UUID, conversation_id: UUID
    ) -> None: ...

    async def list_messages(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        limit: int,
        before_sequence: int | None,
    ) -> list[MessageEntity]: ...

    async def prepare_generation(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        content: str,
        client_request_id: str,
        context_limit: int,
        stale_before: datetime,
    ) -> PreparedGeneration: ...

    async def complete_generation(
        self, *, assistant_message_id: UUID, content: str, finish_reason: str
    ) -> MessageEntity: ...

    async def fail_generation(
        self, *, assistant_message_id: UUID, error_code: str, cancelled: bool
    ) -> None: ...


class SQLAlchemyConversationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_conversation(
        self, *, user_id: UUID, mode: ChatMode, topic: str | None
    ) -> ConversationEntity:
        conversation = ConversationEntity(
            user_id=user_id,
            mode=mode.value,
            topic=topic,
        )
        self.session.add(conversation)
        await self.session.commit()
        await self.session.refresh(conversation)
        return conversation

    async def get_owned(
        self, *, user_id: UUID, conversation_id: UUID
    ) -> ConversationEntity | None:
        result = await self.session.execute(
            select(ConversationEntity).where(
                ConversationEntity.id == conversation_id,
                ConversationEntity.user_id == user_id,
                ConversationEntity.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def list_owned(
        self,
        *,
        user_id: UUID,
        limit: int,
        before: tuple[datetime, UUID] | None,
        include_archived: bool,
    ) -> list[ConversationEntity]:
        filters = [
            ConversationEntity.user_id == user_id,
            ConversationEntity.deleted_at.is_(None),
        ]
        if not include_archived:
            filters.append(ConversationEntity.archived_at.is_(None))
        if before:
            updated_at, conversation_id = before
            filters.append(
                or_(
                    ConversationEntity.updated_at < updated_at,
                    and_(
                        ConversationEntity.updated_at == updated_at,
                        ConversationEntity.id < conversation_id,
                    ),
                )
            )
        result = await self.session.execute(
            select(ConversationEntity)
            .where(*filters)
            .order_by(
                ConversationEntity.updated_at.desc(), ConversationEntity.id.desc()
            )
            .limit(limit)
        )
        return list(result.scalars())

    async def update_owned(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        title: str | None,
        archived: bool | None,
    ) -> ConversationEntity:
        conversation = await self.get_owned(
            user_id=user_id, conversation_id=conversation_id
        )
        if not conversation:
            raise ConversationNotFoundError
        archive_changed = archived is not None and archived != (
            conversation.archived_at is not None
        )
        if (
            archive_changed
            and archived
            and await self._has_active_generation(conversation_id)
        ):
            raise ConversationBusyError
        changed = False
        if title is not None and title != conversation.title:
            conversation.title = title
            changed = True
        if archive_changed:
            conversation.archived_at = utc_now() if archived else None
            changed = True
        if changed:
            conversation.updated_at = utc_now()
            await self.session.commit()
            await self.session.refresh(conversation)
        return conversation

    async def soft_delete_owned(self, *, user_id: UUID, conversation_id: UUID) -> None:
        conversation = await self.get_owned(
            user_id=user_id, conversation_id=conversation_id
        )
        if not conversation:
            raise ConversationNotFoundError
        if await self._has_active_generation(conversation_id):
            raise ConversationBusyError
        conversation.deleted_at = utc_now()
        conversation.updated_at = utc_now()
        await self.session.commit()

    async def _has_active_generation(self, conversation_id: UUID) -> bool:
        result = await self.session.execute(
            select(MessageEntity.id).where(
                MessageEntity.conversation_id == conversation_id,
                MessageEntity.active_slot == "assistant_generation",
                MessageEntity.status == MessageStatus.GENERATING.value,
            )
        )
        return result.scalar_one_or_none() is not None

    async def list_messages(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        limit: int,
        before_sequence: int | None,
    ) -> list[MessageEntity]:
        conversation = await self.get_owned(
            user_id=user_id, conversation_id=conversation_id
        )
        if not conversation:
            raise ConversationNotFoundError
        filters = [MessageEntity.conversation_id == conversation_id]
        if before_sequence is not None:
            filters.append(MessageEntity.sequence_no < before_sequence)
        result = await self.session.execute(
            select(MessageEntity)
            .where(*filters)
            .order_by(MessageEntity.sequence_no.desc())
            .limit(limit)
        )
        return list(result.scalars())

    async def prepare_generation(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        content: str,
        client_request_id: str,
        context_limit: int,
        stale_before: datetime,
    ) -> PreparedGeneration:
        conversation = await self.get_owned(
            user_id=user_id, conversation_id=conversation_id
        )
        if not conversation:
            raise ConversationNotFoundError

        duplicate = await self._find_duplicate_message(
            conversation_id=conversation_id,
            client_request_id=client_request_id,
        )
        if duplicate:
            user_message, assistant_message = duplicate
            raise DuplicateMessageRequestError(user_message, assistant_message)

        active_result = await self.session.execute(
            select(MessageEntity).where(
                MessageEntity.conversation_id == conversation_id,
                MessageEntity.active_slot == "assistant_generation",
                MessageEntity.status == MessageStatus.GENERATING.value,
            )
        )
        active = active_result.scalar_one_or_none()
        if active:
            active_updated = active.updated_at
            if active_updated.tzinfo is None:
                active_updated = active_updated.replace(tzinfo=timezone.utc)
            if active_updated >= stale_before:
                raise ConversationBusyError
            active.status = MessageStatus.CANCELLED.value
            active.error_code = "stale_generation"
            active.active_slot = None
            active.updated_at = utc_now()
            await self.session.commit()

        max_result = await self.session.execute(
            select(func.max(MessageEntity.sequence_no)).where(
                MessageEntity.conversation_id == conversation_id
            )
        )
        next_sequence = (max_result.scalar_one_or_none() or 0) + 1
        now = utc_now()
        user_message = MessageEntity(
            id=uuid4(),
            conversation_id=conversation_id,
            sequence_no=next_sequence,
            role="user",
            content=content,
            status=MessageStatus.COMPLETE.value,
            client_request_id=client_request_id,
            created_at=now,
            updated_at=now,
        )
        assistant_message = MessageEntity(
            id=uuid4(),
            conversation_id=conversation_id,
            sequence_no=next_sequence + 1,
            role="assistant",
            content="",
            status=MessageStatus.GENERATING.value,
            reply_to_message_id=user_message.id,
            active_slot="assistant_generation",
            created_at=now,
            updated_at=now,
        )
        self.session.add_all([user_message, assistant_message])
        if next_sequence == 1:
            content_limit = CONVERSATION_TITLE_MAX_LENGTH - len(ELLIPSIS)
            conversation.title = content[:content_limit] + (
                ELLIPSIS if len(content) > content_limit else ""
            )
        conversation.updated_at = now
        try:
            await self.session.commit()
        except IntegrityError as error:
            await self.session.rollback()
            duplicate = await self._find_duplicate_message(
                conversation_id=conversation_id,
                client_request_id=client_request_id,
            )
            if duplicate:
                user_message, assistant_message = duplicate
                raise DuplicateMessageRequestError(
                    user_message, assistant_message
                ) from error
            raise ConversationBusyError from error

        context_result = await self.session.execute(
            select(MessageEntity)
            .where(
                MessageEntity.conversation_id == conversation_id,
                MessageEntity.status == MessageStatus.COMPLETE.value,
            )
            .order_by(MessageEntity.sequence_no.desc())
            .limit(context_limit)
        )
        context_messages = list(reversed(list(context_result.scalars())))
        return PreparedGeneration(
            conversation=conversation,
            user_message=user_message,
            assistant_message=assistant_message,
            context_messages=context_messages,
        )

    async def _find_duplicate_message(
        self, *, conversation_id: UUID, client_request_id: str
    ) -> tuple[MessageEntity, MessageEntity] | None:
        duplicate_result = await self.session.execute(
            select(MessageEntity).where(
                MessageEntity.conversation_id == conversation_id,
                MessageEntity.client_request_id == client_request_id,
                MessageEntity.role == "user",
            )
        )
        user_message = duplicate_result.scalar_one_or_none()
        if not user_message:
            return None
        assistant_result = await self.session.execute(
            select(MessageEntity).where(
                MessageEntity.reply_to_message_id == user_message.id,
                MessageEntity.role == "assistant",
            )
        )
        return user_message, assistant_result.scalar_one()

    async def complete_generation(
        self, *, assistant_message_id: UUID, content: str, finish_reason: str
    ) -> MessageEntity:
        assistant = await self.session.get(MessageEntity, assistant_message_id)
        if not assistant or assistant.status != MessageStatus.GENERATING.value:
            raise ConversationBusyError
        assistant.content = content
        assistant.status = MessageStatus.COMPLETE.value
        assistant.finish_reason = finish_reason
        assistant.active_slot = None
        assistant.updated_at = utc_now()
        conversation = await self.session.get(
            ConversationEntity, assistant.conversation_id
        )
        if conversation:
            conversation.updated_at = assistant.updated_at
        await self.session.commit()
        return assistant

    async def fail_generation(
        self, *, assistant_message_id: UUID, error_code: str, cancelled: bool
    ) -> None:
        assistant = await self.session.get(MessageEntity, assistant_message_id)
        if not assistant or assistant.status != MessageStatus.GENERATING.value:
            return
        assistant.status = (
            MessageStatus.CANCELLED.value if cancelled else MessageStatus.FAILED.value
        )
        assistant.error_code = error_code
        assistant.active_slot = None
        assistant.updated_at = utc_now()
        await self.session.commit()


def get_conversation_repository(
    session: AsyncSession = Depends(get_db_session),
) -> ConversationRepository:
    return SQLAlchemyConversationRepository(session)


@asynccontextmanager
async def conversation_repository_context() -> AsyncIterator[ConversationRepository]:
    """Provide a fresh repository for work that outlives request dependencies."""
    async with session_factory() as session:
        yield SQLAlchemyConversationRepository(session)
