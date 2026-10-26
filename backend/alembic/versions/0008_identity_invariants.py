"""Enforce one role assignment per user."""

from alembic import op
import sqlalchemy as sa

revision = "0008_identity_invariants"
down_revision = "0007_file_upload_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not op.get_context().as_sql:
        duplicates = op.get_bind().execute(
            sa.text(
                """
                SELECT count(*)
                FROM (
                  SELECT user_id
                  FROM user_role_assignments
                  GROUP BY user_id
                  HAVING count(*) > 1
                ) AS duplicate_users
                """
            )
        ).scalar_one()
        if duplicates:
            raise RuntimeError(f"duplicate user role assignments: {duplicates}")
    op.create_unique_constraint(
        "uq_user_role_assignments_user_id",
        "user_role_assignments",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_user_role_assignments_user_id",
        "user_role_assignments",
        type_="unique",
    )
