"""Give existing drafts revision one; a missing draft has revision zero."""

from alembic import op
import sqlalchemy as sa

revision = '0032_review_draft_revision'
down_revision = '0031_task_extensions'
branch_labels = depends_on = None


def upgrade():
    op.add_column('review_drafts', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))


def downgrade():
    op.drop_column('review_drafts', 'revision')
