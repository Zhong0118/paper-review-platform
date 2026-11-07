"""Bind new uploads to their original thesis version; legacy uploads are read-only."""
import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_file_upload_version"
down_revision = "0006_open_objection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("file_objects", sa.Column("upload_version_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_file_upload_version", "file_objects", "thesis_versions", ["upload_version_id"], ["id"])
    if not op.get_context().as_sql:
        count = op.get_bind().execute(sa.text("SELECT count(*) FROM file_objects WHERE upload_version_id IS NULL")).scalar_one()
        logging.getLogger("alembic.runtime.migration").warning(
            "%s legacy uploads are write-locked; incomplete uploads must be prepared again", count
        )


def downgrade() -> None:
    op.drop_constraint("fk_file_upload_version", "file_objects", type_="foreignkey")
    op.drop_column("file_objects", "upload_version_id")
