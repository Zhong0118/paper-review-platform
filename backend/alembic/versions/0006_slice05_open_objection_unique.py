"""One open objection per thesis."""

from typing import Sequence, Union

from alembic import op

revision: str = "0006_open_objection"
down_revision: Union[str, Sequence[str], None] = "0005_slice05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX uq_objections_open_per_thesis
        ON objections (thesis_id)
        WHERE status IN ('SUBMITTED', 'PROCESSING')
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_objections_open_per_thesis")
