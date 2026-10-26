"""Add pilot batch version and operations list indexes."""

from alembic import op
import sqlalchemy as sa

revision = "0009_pilot_operations"
down_revision = "0008_identity_invariants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("review_batches", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_index("ix_membership_tenant_type_active", "tenant_user_memberships", ["tenant_id", "membership_type", "is_active"])
    op.create_index("ix_batch_tenant_status_created", "review_batches", ["tenant_id", "status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_batch_tenant_status_created", table_name="review_batches")
    op.drop_index("ix_membership_tenant_type_active", table_name="tenant_user_memberships")
    op.drop_column("review_batches", "version")
