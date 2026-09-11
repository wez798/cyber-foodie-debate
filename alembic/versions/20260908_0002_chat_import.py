"""Add immutable, user-scoped import identity.

Revision ID: 20260908_0002
Revises: 20260906_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260908_0002"
down_revision: str | None = "20260906_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("conversations") as batch:
        batch.add_column(sa.Column("import_request_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("import_fingerprint", sa.String(64), nullable=True))
        batch.create_unique_constraint(
            "uq_conversations_owner_import", ["user_id", "import_request_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("conversations") as batch:
        batch.drop_constraint("uq_conversations_owner_import", type_="unique")
        batch.drop_column("import_fingerprint")
        batch.drop_column("import_request_id")
