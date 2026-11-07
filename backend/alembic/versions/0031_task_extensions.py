"""Private expert extension history; school progress can read only the approved date."""

from alembic import op
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0031_task_extensions'
down_revision = '0030_task_clocks'
branch_labels = depends_on = None


def upgrade():
    bind = op.get_bind()
    quote = bind.dialect.identifier_preparer.quote
    schema = quote(bind.scalar(text('SELECT current_schema()')))
    owner = quote(bind.scalar(text('SELECT current_user')))
    op.execute(
        """CREATE TABLE task_extensions (
        id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES expert_tasks(id),
        requested_by uuid NOT NULL REFERENCES users(id), requested_at timestamptz NOT NULL DEFAULT now(),
        original_due_at timestamptz NOT NULL, requested_due_at timestamptz NOT NULL,
        reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
        status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
        decided_by uuid REFERENCES users(id), decided_at timestamptz, decision_reason text,
        CHECK (requested_due_at > original_due_at),
        CHECK ((status='PENDING' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
            OR (status<>'PENDING' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
                AND decision_reason IS NOT NULL AND length(trim(decision_reason)) BETWEEN 1 AND 500)))"""
    )
    # Rejection releases the slot; approval occupies it permanently.
    op.execute(
        """CREATE UNIQUE INDEX one_open_extension ON task_extensions(task_id)
                  WHERE status IN ('PENDING','APPROVED')"""
    )
    op.execute('ALTER TABLE task_extensions ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE task_extensions FORCE ROW LEVEL SECURITY')
    platform = "(app_role()='platform_reviewer' AND app_actor_id() IS NOT NULL)"
    expert = "(app_role()='expert' AND requested_by=app_actor_id() AND EXISTS (SELECT 1 FROM expert_tasks t JOIN experts e ON e.id=t.expert_id WHERE t.id=task_extensions.task_id AND e.user_id=app_actor_id()))"
    active = """EXISTS (SELECT 1 FROM expert_tasks t JOIN review_rounds r ON r.id=t.round_id
        JOIN theses p ON p.id=t.thesis_id WHERE t.id=task_extensions.task_id AND t.status='IN_REVIEW'
        AND t.original_review_due_at=task_extensions.original_due_at AND r.status='ACTIVE'
        AND p.current_version_id=r.thesis_version_id AND p.stage='UNDER_REVIEW')"""
    op.execute(f'CREATE POLICY extensions_read ON task_extensions FOR SELECT USING ({platform} OR {expert})')
    op.execute(
        f"""CREATE POLICY extensions_add ON task_extensions FOR INSERT WITH CHECK
        ({expert} AND {active} AND status='PENDING' AND requested_due_at>statement_timestamp())"""
    )
    op.execute(
        f"""CREATE POLICY extensions_decide ON task_extensions FOR UPDATE USING ({platform} AND status='PENDING')
        WITH CHECK ({platform} AND {active} AND decided_by=app_actor_id() AND
        (status='REJECTED' OR (status='APPROVED' AND requested_due_at>statement_timestamp())))"""
    )
    school = """app_role()='school_reviewer' AND app_actor_id() IS NOT NULL AND EXISTS
        (SELECT 1 FROM expert_tasks t WHERE t.id=task_extensions.task_id AND t.tenant_id=app_tenant_id())"""
    op.execute(
        f"""CREATE POLICY extension_school_date_owner ON task_extensions FOR SELECT TO {owner}
        USING (status='APPROVED' AND {school})"""
    )
    op.execute(
        f"""CREATE FUNCTION approved_extension_due(target uuid) RETURNS timestamptz
        LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,{schema},pg_temp AS $$
        SELECT requested_due_at FROM task_extensions WHERE task_id=target AND status='APPROVED'
        AND ({platform} OR {expert} OR ({school})) $$"""
    )
    op.execute('REVOKE ALL ON FUNCTION approved_extension_due(uuid) FROM PUBLIC')
    url = get_settings().business_database_url
    if url:
        business = quote(make_url(url).username)
        op.execute(f'REVOKE ALL ON task_extensions FROM {business}')
        op.execute(
            f'GRANT SELECT, INSERT, UPDATE(status, decided_by, decided_at, decision_reason) ON task_extensions TO {business}'
        )
        op.execute(f'GRANT EXECUTE ON FUNCTION approved_extension_due(uuid) TO {business}')


def downgrade():
    op.execute('ALTER TABLE task_extensions NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(text('SELECT EXISTS(SELECT 1 FROM task_extensions)')):
        raise ValueError('would discard extension history')
    op.execute('DROP FUNCTION approved_extension_due(uuid)')
    op.drop_table('task_extensions')
