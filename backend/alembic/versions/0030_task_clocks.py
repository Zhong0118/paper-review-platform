"""Optional school timing rules, frozen when a new expert is invited."""

from alembic import op
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0030_task_clocks'
down_revision = '0029_school_return_clone'
branch_labels = depends_on = None


def upgrade():
    op.execute(
        """CREATE TABLE batch_deadline_rules (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
        accept_days smallint CHECK (accept_days>0), review_days smallint CHECK (review_days>0),
        FOREIGN KEY (id,tenant_id) REFERENCES review_batches(id,tenant_id))"""
    )
    op.execute('ALTER TABLE batch_deadline_rules ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE batch_deadline_rules FORCE ROW LEVEL SECURITY')
    school = "app_actor_id() IS NOT NULL AND app_role()='school_reviewer' AND tenant_id=app_tenant_id()"
    check = (
        school
        + " AND EXISTS(SELECT 1 FROM review_batches b WHERE b.id=batch_deadline_rules.id AND b.status IN ('DRAFT','OPEN'))"
    )
    op.execute(
        f"CREATE POLICY clocks_read ON batch_deadline_rules FOR SELECT USING (({school}) OR (app_actor_id() IS NOT NULL AND app_role()='platform_reviewer'))"
    )
    op.execute(f"CREATE POLICY clocks_create ON batch_deadline_rules FOR INSERT WITH CHECK ({check})")
    op.execute(
        f"CREATE POLICY clocks_edit ON batch_deadline_rules FOR UPDATE USING ({school}) WITH CHECK ({check})"
    )
    url = get_settings().business_database_url
    if url:
        role = op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'GRANT SELECT, INSERT, UPDATE(accept_days,review_days) ON batch_deadline_rules TO {role}')
    op.execute(
        'ALTER TABLE expert_tasks ADD COLUMN accept_due_at timestamptz, ADD COLUMN review_days smallint, ADD COLUMN original_review_due_at timestamptz'
    )
    schema = op.get_bind().dialect.identifier_preparer.quote(
        op.get_bind().scalar(text('SELECT current_schema()'))
    )
    op.execute(
        f"""CREATE FUNCTION freeze_task_clocks() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE a int; r int;
        BEGIN
            IF TG_OP='INSERT' THEN
                SELECT d.accept_days,d.review_days INTO a,r FROM batch_deadline_rules d
                    JOIN theses t ON t.review_batch_id=d.id AND t.tenant_id=d.tenant_id WHERE t.id=NEW.thesis_id;
                IF a IS NOT NULL OR r IS NOT NULL THEN NEW.invited_at := statement_timestamp(); END IF;
                NEW.accept_due_at := NEW.invited_at + a * interval '24 hours';
                NEW.review_days := r;
                NEW.original_review_due_at := NULL;
            ELSE
                IF (NEW.accept_due_at,NEW.review_days,NEW.original_review_due_at)
                    IS DISTINCT FROM (OLD.accept_due_at,OLD.review_days,OLD.original_review_due_at)
                    OR ((OLD.accept_due_at IS NOT NULL OR OLD.review_days IS NOT NULL) AND
                       (NEW.invited_at IS DISTINCT FROM OLD.invited_at OR
                        (OLD.decided_at IS NOT NULL AND NEW.decided_at IS DISTINCT FROM OLD.decided_at)))
                THEN RAISE EXCEPTION 'task clocks are immutable' USING ERRCODE='42501'; END IF;
                IF OLD.status='INVITED' AND NEW.status='IN_REVIEW' AND OLD.review_days IS NOT NULL THEN
                    NEW.decided_at := statement_timestamp();
                    NEW.original_review_due_at := NEW.decided_at + OLD.review_days * interval '24 hours';
                END IF;
            END IF;
            RETURN NEW;
        END $$"""
    )
    op.execute(
        'CREATE TRIGGER freeze_task_clocks BEFORE INSERT OR UPDATE ON expert_tasks FOR EACH ROW EXECUTE FUNCTION freeze_task_clocks()'
    )


def downgrade():
    op.execute('ALTER TABLE batch_deadline_rules NO FORCE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE expert_tasks NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(
        text(
            '''SELECT EXISTS(SELECT 1 FROM batch_deadline_rules) OR EXISTS(
        SELECT 1 FROM expert_tasks WHERE accept_due_at IS NOT NULL OR review_days IS NOT NULL OR original_review_due_at IS NOT NULL)'''
        )
    ):
        raise ValueError('would discard deadline history')
    op.execute('ALTER TABLE expert_tasks FORCE ROW LEVEL SECURITY')
    op.execute('DROP TRIGGER freeze_task_clocks ON expert_tasks')
    op.execute('DROP FUNCTION freeze_task_clocks()')
    op.execute(
        'ALTER TABLE expert_tasks DROP COLUMN accept_due_at, DROP COLUMN review_days, DROP COLUMN original_review_due_at'
    )
    op.drop_table('batch_deadline_rules')
