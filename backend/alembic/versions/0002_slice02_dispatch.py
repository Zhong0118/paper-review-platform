"""Slice 2 expert profiles, rounds and tasks."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_slice02"
down_revision: Union[str, Sequence[str], None] = "0001_slice01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "experts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("service_status", sa.String(32), nullable=False, server_default="AVAILABLE"),
        sa.Column("discipline_codes", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "expert_conflicts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("expert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("experts.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("value", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "review_rounds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("thesis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("theses.id"), nullable=False),
        sa.Column("thesis_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("thesis_versions.id"), nullable=False),
        sa.Column("round_no", sa.Integer, nullable=False, server_default="1"),
        sa.Column("status", sa.String(32), nullable=False, server_default="CREATED"),
        sa.Column("discipline_code", sa.String(32), nullable=False),
        sa.Column("discipline_name", sa.String(128), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("thesis_id", "round_no"),
    )
    op.create_table(
        "expert_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("round_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("review_rounds.id"), nullable=False),
        sa.Column("expert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("experts.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="INVITED"),
        sa.Column("replaces_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("expert_tasks.id"), nullable=True),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reject_reason", sa.Text, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("expert_tasks")
    op.drop_table("review_rounds")
    op.drop_table("expert_conflicts")
    op.drop_table("experts")
