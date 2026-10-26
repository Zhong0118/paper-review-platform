"""Official reference data and tenant-scoped discipline choices."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0020_official_catalogs'
down_revision = '0019_school_task_cancellation'
branch_labels = depends_on = None


def base():
    return [sa.Column('id',sa.Uuid(),primary_key=True),
            sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
            sa.Column('updated_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False)]


def upgrade():
    for name, size in [('source_version',32),('category_code',2),('category_name',32),('kind',32)]:
        op.add_column('discipline_catalog',sa.Column(name,sa.String(size),nullable=True))
    op.create_table('institution_catalog', *base(),
        *[sa.Column(name,sa.String(size),nullable=False) for name,size in
          [('code',10),('name',128),('province',64),('city',64),('authority',128),('level',32),('kind',32),('source_version',32)]],
        sa.Column('is_active',sa.Boolean(),nullable=False,server_default=sa.true()),
        sa.UniqueConstraint('code'),sa.CheckConstraint("kind IN ('REGULAR','ADULT')"),
        sa.CheckConstraint("code ~ '^[0-9]{10}$'"))
    op.add_column('tenants',sa.Column('institution_code',sa.String(10),nullable=True))
    op.create_foreign_key('fk_tenant_institution','tenants','institution_catalog',['institution_code'],['code'])
    op.create_table('school_discipline_settings', *base(),
        sa.Column('tenant_id',sa.Uuid(),sa.ForeignKey('tenants.id'),nullable=False,unique=True),
        sa.Column('codes',JSONB(),nullable=False),
        sa.Column('version',sa.Integer(),nullable=False,server_default='1'),
        sa.CheckConstraint("jsonb_typeof(codes)='array'"),sa.CheckConstraint('version >= 1'))
    actor = 'app_actor_id() IS NOT NULL'
    system = f"{actor} AND app_role()='system_admin'"
    school = f"{actor} AND tenant_id=app_tenant_id() AND app_role()='school_reviewer'"
    for table,read,write in [('institution_catalog',actor,system),
                            ('school_discipline_settings',f'{actor} AND tenant_id=app_tenant_id()',school)]:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {table}_read ON {table} FOR SELECT USING ({read})')
        op.execute(f'CREATE POLICY {table}_insert ON {table} FOR INSERT WITH CHECK ({write})')
        op.execute(f'CREATE POLICY {table}_update ON {table} FOR UPDATE USING ({write}) WITH CHECK ({write})')
    op.execute(f'CREATE POLICY discipline_system_insert ON discipline_catalog FOR INSERT WITH CHECK ({system} AND tenant_id IS NULL)')
    op.execute(f'CREATE POLICY discipline_system_update ON discipline_catalog FOR UPDATE USING ({system} AND tenant_id IS NULL) WITH CHECK ({system} AND tenant_id IS NULL)')
    url=get_settings().business_database_url
    if url:
        role=op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'GRANT SELECT,INSERT ON institution_catalog,school_discipline_settings,discipline_catalog TO {role}')
        op.execute(f'GRANT UPDATE (name,province,city,authority,level,kind,source_version,is_active,updated_at) ON institution_catalog TO {role}')
        op.execute(f'GRANT UPDATE (name,category_code,category_name,kind,source_version,is_active,updated_at) ON discipline_catalog TO {role}')
        op.execute(f'GRANT UPDATE (codes,version,updated_at) ON school_discipline_settings TO {role}')


def downgrade():
    for table in ('institution_catalog','school_discipline_settings'):
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
        if op.get_bind().scalar(sa.text(f'SELECT EXISTS (SELECT 1 FROM {table})')):
            raise ValueError('0020 downgrade requires empty catalog/settings tables')
    op.drop_constraint('fk_tenant_institution','tenants',type_='foreignkey')
    op.drop_column('tenants','institution_code')
    op.drop_table('school_discipline_settings')
    op.drop_table('institution_catalog')
    for name in ('discipline_system_insert','discipline_system_update'):
        op.execute(f'DROP POLICY {name} ON discipline_catalog')
    url=get_settings().business_database_url
    if url:
        role=op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'REVOKE INSERT ON discipline_catalog FROM {role}')
        op.execute(f'REVOKE UPDATE (name,is_active,updated_at) ON discipline_catalog FROM {role}')
    for name in ('source_version','category_code','category_name','kind'):
        op.drop_column('discipline_catalog',name)
