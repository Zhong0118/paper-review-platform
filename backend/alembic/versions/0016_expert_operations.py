"""Expert operational fields, without opening management writes."""
from alembic import op
import sqlalchemy as sa

revision = '0016_expert_operations'
down_revision = '0015_rls_children'
branch_labels = None
depends_on = None


def upgrade():
    for table in ('experts', 'expert_conflicts'):
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
    bad = op.get_bind().scalar(sa.text("""
        SELECT EXISTS (SELECT 1 FROM experts WHERE service_status NOT IN ('AVAILABLE','UNAVAILABLE')
            OR jsonb_typeof(discipline_codes) IS DISTINCT FROM 'array')
          OR EXISTS (SELECT 1 FROM expert_conflicts GROUP BY expert_id,kind,value HAVING count(*)>1)
    """))
    if bad:
        raise ValueError('0016 preflight rejected invalid expert status/disciplines or duplicate conflicts')
    if op.get_bind().scalar(sa.text("""
        SELECT EXISTS (SELECT 1 FROM experts e CROSS JOIN LATERAL jsonb_array_elements(e.discipline_codes) code
            WHERE jsonb_typeof(code) <> 'string' OR length(code #>> '{}') = 0)
    """)):
        raise ValueError('0016 preflight rejected invalid discipline values')
    op.add_column('experts', sa.Column('unit', sa.String(128), nullable=False, server_default=''))
    op.add_column('experts', sa.Column('title', sa.String(128), nullable=False, server_default=''))
    op.add_column('experts', sa.Column('qualification_status', sa.String(32), nullable=False, server_default='APPROVED'))
    op.alter_column('experts', 'qualification_status', server_default='PENDING')
    op.add_column('experts', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.create_check_constraint('ck_expert_service_status', 'experts', "service_status IN ('AVAILABLE','UNAVAILABLE')")
    op.create_check_constraint('ck_expert_qualification', 'experts', "qualification_status IN ('PENDING','APPROVED','REJECTED')")
    op.create_check_constraint('ck_expert_version', 'experts', 'version > 0')
    op.create_check_constraint('ck_expert_disciplines', 'experts', "jsonb_typeof(discipline_codes) = 'array'")
    op.create_unique_constraint('uq_expert_conflict', 'expert_conflicts', ['expert_id','kind','value'])
    for table in ('experts', 'expert_conflicts'):
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')


def downgrade():
    for table in ('experts', 'expert_conflicts'):
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM experts) OR EXISTS (SELECT 1 FROM expert_conflicts)')):
        raise ValueError('0016 downgrade requires empty expert tables; use forward repair or paired backup restore')
    op.drop_constraint('uq_expert_conflict', 'expert_conflicts', type_='unique')
    for name in ('ck_expert_service_status','ck_expert_qualification','ck_expert_version','ck_expert_disciplines'):
        op.drop_constraint(name, 'experts', type_='check')
    for column in ('version','qualification_status','title','unit'):
        op.drop_column('experts', column)
    for table in ('experts', 'expert_conflicts'):
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
