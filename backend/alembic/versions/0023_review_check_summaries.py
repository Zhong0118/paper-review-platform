"""Insert-only check receipts; pre-existing results remain explicitly unchecked."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0023_review_check_summaries'
down_revision = '0022_review_corrections'
branch_labels = depends_on = None
TABLES = ('review_result_versions', 'review_result_revisions')


def upgrade():
    for table in TABLES:
        op.add_column(table, sa.Column('check_summary', JSONB(), nullable=True))
    op.execute('''CREATE FUNCTION guard_check_summary_immutable() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog AS $$ BEGIN
        IF NEW.check_summary IS DISTINCT FROM OLD.check_summary THEN
            RAISE EXCEPTION 'check summary is insert-only' USING ERRCODE='42501';
        END IF;
        RETURN NEW; END $$''')
    for table in TABLES:
        op.execute(f'''CREATE TRIGGER check_summary_immutable BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION guard_check_summary_immutable()''')


def downgrade():
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
        if op.get_bind().scalar(sa.text(f'SELECT EXISTS(SELECT 1 FROM {table} WHERE check_summary IS NOT NULL)')):
            raise ValueError('0023 downgrade would discard check receipts')
        op.execute(f'DROP TRIGGER check_summary_immutable ON {table}')
        op.drop_column(table, 'check_summary')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
    op.execute('DROP FUNCTION guard_check_summary_immutable()')
