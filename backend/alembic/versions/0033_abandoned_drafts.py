"""Keep the provenance of abandoned, never-submitted drafts."""
from alembic import op
import sqlalchemy as sa

revision = '0033_abandoned_drafts'
down_revision = '0032_review_draft_revision'
branch_labels = depends_on = None


def _active_index(predicate):
    op.create_index('uq_theses_active_student_batch', 'theses',
                    ['tenant_id', 'student_membership_id', 'review_batch_id'],
                    unique=True, postgresql_where=sa.text(predicate))


def upgrade():
    op.add_column('theses', sa.Column('draft_abandoned_at', sa.DateTime(timezone=True)))
    op.create_check_constraint('ck_theses_abandoned_draft', 'theses',
                               "draft_abandoned_at IS NULL OR stage='DRAFT'")
    op.drop_index('uq_theses_active_student_batch', table_name='theses')
    _active_index("stage <> 'TERMINATED' AND draft_abandoned_at IS NULL")
    op.execute('CREATE POLICY active_drafts_read ON theses AS RESTRICTIVE FOR SELECT USING (draft_abandoned_at IS NULL)')
    op.execute('CREATE POLICY active_drafts_insert ON theses AS RESTRICTIVE FOR INSERT WITH CHECK (draft_abandoned_at IS NULL)')
    op.execute('CREATE POLICY active_drafts_delete ON theses AS RESTRICTIVE FOR DELETE USING (draft_abandoned_at IS NULL)')
    op.execute("""CREATE POLICY active_drafts_update ON theses AS RESTRICTIVE FOR UPDATE
        USING (draft_abandoned_at IS NULL) WITH CHECK (true)""")
    # Workflow event visibility itself references theses. Keep the history check
    # out of the policy graph; run it only for an actual abandonment.
    conn = op.get_bind()
    schema = conn.dialect.identifier_preparer.quote(conn.scalar(sa.text('SELECT current_schema()')))
    op.execute(f"""CREATE FUNCTION guard_draft_abandonment() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        BEGIN
          IF OLD.stage <> 'DRAFT' OR OLD.draft_abandoned_at IS NOT NULL OR
              app_role() IS DISTINCT FROM 'student' OR app_tenant_id() IS DISTINCT FROM OLD.tenant_id OR
              NOT EXISTS (SELECT 1 FROM tenant_user_memberships m WHERE m.id=OLD.student_membership_id
                AND m.tenant_id=OLD.tenant_id AND m.user_id=app_actor_id()) OR
              EXISTS (SELECT 1 FROM workflow_events e WHERE e.thesis_id=OLD.id AND e.action='submit') THEN
            RAISE EXCEPTION 'cannot abandon this draft' USING ERRCODE='42501';
          END IF;
          RETURN NEW;
        END $$""")
    op.execute('REVOKE ALL ON FUNCTION guard_draft_abandonment() FROM PUBLIC')
    op.execute('CREATE TRIGGER guard_draft_abandonment BEFORE UPDATE OF draft_abandoned_at ON theses '
               'FOR EACH ROW WHEN (NEW.draft_abandoned_at IS NOT NULL) EXECUTE FUNCTION guard_draft_abandonment()')
    # Versions, links, reports and program choices already derive visibility from theses.
    # File objects and operation provenance also have independent, uploader-based read policies.
    for table in ('file_objects', 'pdf_transform_operations'):
        parent = (f"app_role()<>'student' OR thesis_id IS NULL OR "
                  f"EXISTS (SELECT 1 FROM theses t WHERE t.id={table}.thesis_id)")
        op.execute(f'CREATE POLICY active_draft_parent ON {table} AS RESTRICTIVE FOR SELECT USING ({parent})')
        # UPDATE without WHERE or RETURNING need not consult the SELECT policy.
        op.execute(f'CREATE POLICY active_draft_parent_update ON {table} AS RESTRICTIVE FOR UPDATE '
                   f'USING ({parent}) WITH CHECK (true)')


def downgrade():
    # The migration owner is otherwise subject to FORCE RLS; this DDL and check
    # are transactional. Never resurrect a discarded submission or lose its marker.
    op.execute('ALTER TABLE theses NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM theses WHERE draft_abandoned_at IS NOT NULL)')):
        raise ValueError('0033 downgrade would resurrect abandoned drafts')
    op.execute('ALTER TABLE theses FORCE ROW LEVEL SECURITY')
    for table in ('file_objects', 'pdf_transform_operations'):
        op.execute(f'DROP POLICY active_draft_parent ON {table}')
        op.execute(f'DROP POLICY active_draft_parent_update ON {table}')
    for command in ('read', 'insert', 'update', 'delete'):
        op.execute(f'DROP POLICY active_drafts_{command} ON theses')
    op.execute('DROP TRIGGER guard_draft_abandonment ON theses')
    op.execute('DROP FUNCTION guard_draft_abandonment()')
    op.drop_index('uq_theses_active_student_batch', table_name='theses')
    _active_index("stage <> 'TERMINATED'")
    op.drop_constraint('ck_theses_abandoned_draft', 'theses', type_='check')
    op.drop_column('theses', 'draft_abandoned_at')
