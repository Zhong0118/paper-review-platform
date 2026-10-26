"""Owner-only metadata predicate for an expert's own task; no paper/file grant."""
from alembic import op
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0024_expert_task_time_scope'
down_revision = '0023_review_check_summaries'
branch_labels = depends_on = None


def upgrade():
    bind = op.get_bind()
    quote = bind.dialect.identifier_preparer.quote
    schema = quote(bind.scalar(text('SELECT current_schema()')))
    owner = quote(bind.scalar(text('SELECT current_user')))
    op.execute(f'''CREATE POLICY task_date_owner_read ON theses FOR SELECT TO {owner}
        USING (app_role()='expert' AND app_actor_id() IS NOT NULL AND EXISTS (
            SELECT 1 FROM expert_tasks task JOIN experts e ON e.id=task.expert_id
            WHERE task.thesis_id=theses.id AND task.tenant_id=theses.tenant_id AND e.user_id=app_actor_id()))''')
    op.execute(f'''CREATE FUNCTION task_thesis_in_period(task_id uuid, lower_bound timestamptz, upper_bound timestamptz)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,{schema} AS $$
        SELECT EXISTS (SELECT 1 FROM {schema}.expert_tasks task
            JOIN {schema}.experts e ON e.id=task.expert_id
            JOIN {schema}.theses t ON t.id=task.thesis_id AND t.tenant_id=task.tenant_id
            WHERE {schema}.app_role()='expert' AND e.user_id={schema}.app_actor_id()
            AND task.id=task_id AND t.created_at>=lower_bound AND t.created_at<=upper_bound)
        $$''')
    op.execute('REVOKE ALL ON FUNCTION task_thesis_in_period(uuid,timestamptz,timestamptz) FROM PUBLIC')
    url = get_settings().business_database_url
    if url:
        business = quote(make_url(url).username)
        op.execute(f'GRANT EXECUTE ON FUNCTION task_thesis_in_period(uuid,timestamptz,timestamptz) TO {business}')


def downgrade():
    op.execute('DROP FUNCTION task_thesis_in_period(uuid,timestamptz,timestamptz)')
    op.execute('DROP POLICY task_date_owner_read ON theses')
