"""Add user token revocation generation."""

from alembic import op
import sqlalchemy as sa

revision = "0010_auth_version"
down_revision = "0009_pilot_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("users", sa.Column("provisioned_by", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("provisioned_tenant_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "provisioned_tenant_id")
    op.drop_column("users", "provisioned_by")
    op.drop_column("users", "auth_version")
