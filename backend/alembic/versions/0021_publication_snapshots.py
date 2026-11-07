"""Freeze published content before introducing result corrections."""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0021_publication_snapshots'
down_revision = '0020_official_catalogs'
branch_labels = depends_on = None
TABLES = ('result_publications', 'result_summaries', 'review_result_versions',
          'expert_tasks', 'review_rounds', 'theses')


def upgrade():
    conn = op.get_bind()
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
    op.add_column('result_publications', sa.Column('snapshot', JSONB(), nullable=True))
    op.add_column('result_publications', sa.Column('publication_no', sa.Integer(), nullable=True))
    op.add_column('result_publications', sa.Column('replaces_id', sa.Uuid(), nullable=True))
    publications = conn.execute(sa.text('SELECT id,summary_id FROM result_publications')).mappings().all()
    seen = set()
    for pub in publications:
        rows = conn.execute(sa.text('''
            SELECT s.*, t.current_version_id, t.stage, r.thesis_version_id,
                   r.rule_snapshot AS round_rule, v.id AS result_id,
                   v.scores, v.comments, v.total AS result_total, task.status AS task_status
            FROM result_summaries s JOIN theses t ON t.id=s.thesis_id AND t.tenant_id=s.tenant_id
            JOIN review_rounds r ON r.id=s.round_id AND r.thesis_id=t.id AND r.tenant_id=s.tenant_id
            JOIN expert_tasks task ON task.round_id=r.id AND task.thesis_id=t.id AND task.tenant_id=s.tenant_id
            JOIN review_result_versions v ON v.task_id=task.id AND v.round_id=r.id AND v.tenant_id=s.tenant_id
            WHERE s.id=:id AND v.is_current AND s.result_task_ids=jsonb_build_array(task.id::text)
        '''), {'id': pub['summary_id']}).mappings().all()
        if len(rows) != 1 or pub['summary_id'] in seen:
            raise ValueError(f"0021 preflight: ambiguous publication {pub['id']}")
        row = rows[0]
        if (row['stage'] != 'COMPLETED' or row['task_status'] != 'SUBMITTED'
                or row['current_version_id'] != row['thesis_version_id']
                or row['rule_snapshot'] != row['round_rule']
                or row['total'] != row['result_total']):
            raise ValueError(f"0021 preflight: inconsistent publication {pub['id']}")
        seen.add(pub['summary_id'])
        rule, total, comments = row['rule_snapshot'], row['total'], row['comments']
        band = next((b for b in rule['bands'] if b['min'] <= total <= b['max']), None)
        if band is None:
            raise ValueError(f"0021 preflight: invalid total {pub['id']}")
        snapshot = {'thesis_id': str(row['thesis_id']), 'thesis_version_id': str(row['thesis_version_id']),
                    'base_result_id': str(row['result_id']), 'revision_id': None,
                    'round_id': str(row['round_id']), 'result_task_ids': row['result_task_ids'],
                    'total': total, 'rule_snapshot': rule,
                    'outcome': {'code': band['code'], 'label': band['label']},
                    'items': [{'alias': 'E-001', 'total': total, 'scores': row['scores'],
                               'recommendation': comments.get('recommendation', ''),
                               'overall_comment': comments.get('overallComment', ''),
                               'issues': comments.get('issues', '')}]}
        conn.execute(sa.text('UPDATE result_publications SET snapshot=CAST(:snapshot AS jsonb), '
                             'publication_no=1 WHERE id=:id'),
                     {'id': pub['id'], 'snapshot': json.dumps(snapshot, ensure_ascii=False)})
    op.alter_column('result_publications', 'snapshot', nullable=False)
    op.alter_column('result_publications', 'publication_no', nullable=False)
    op.create_check_constraint('ck_publication_number', 'result_publications', 'publication_no >= 1')
    op.create_unique_constraint('uq_publication_number', 'result_publications', ['summary_id', 'publication_no'])
    op.create_unique_constraint('uq_publication_parent', 'result_publications', ['id', 'summary_id'])
    op.create_unique_constraint('uq_publication_successor', 'result_publications', ['replaces_id'])
    op.create_foreign_key('fk_publication_replaces_same_summary', 'result_publications',
                          'result_publications', ['replaces_id', 'summary_id'], ['id', 'summary_id'])
    op.execute('''CREATE FUNCTION guard_publication_immutable() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog AS $$ BEGIN
        RAISE EXCEPTION 'publication is immutable' USING ERRCODE='42501'; END $$''')
    op.execute('''CREATE TRIGGER publication_immutable BEFORE UPDATE OR DELETE ON result_publications
        FOR EACH ROW EXECUTE FUNCTION guard_publication_immutable()''')
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')


def downgrade():
    op.execute('ALTER TABLE result_publications NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM result_publications)')):
        raise ValueError('0021 downgrade requires empty publications')
    op.execute('DROP TRIGGER publication_immutable ON result_publications')
    op.execute('DROP FUNCTION guard_publication_immutable()')
    op.drop_constraint('fk_publication_replaces_same_summary', 'result_publications', type_='foreignkey')
    for name in ('uq_publication_number', 'uq_publication_successor', 'uq_publication_parent'):
        op.drop_constraint(name, 'result_publications', type_='unique')
    op.drop_constraint('ck_publication_number', 'result_publications', type_='check')
    for column in ('snapshot', 'publication_no', 'replaces_id'):
        op.drop_column('result_publications', column)
    op.execute('ALTER TABLE result_publications FORCE ROW LEVEL SECURITY')
