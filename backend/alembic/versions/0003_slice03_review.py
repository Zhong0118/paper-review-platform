"""Slice 3 review drafts and locked results."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_slice03"
down_revision: Union[str, Sequence[str], None] = "0002_slice02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("expert_tasks.id"), nullable=False, unique=True),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "review_result_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("expert_tasks.id"), nullable=False),
        sa.Column("version_no", sa.Integer, nullable=False, server_default="1"),
        sa.Column("scores", postgresql.JSONB, nullable=False),
        sa.Column("total", sa.Integer, nullable=False),
        sa.Column("comments", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("review_result_versions")
    op.drop_table("review_drafts")
