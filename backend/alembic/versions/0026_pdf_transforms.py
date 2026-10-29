"""Student-owned PDF transformations with immutable provenance."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0026_pdf_transforms'
down_revision = '0025_sensitive_locations'
branch_labels = depends_on = None


def upgrade():
    op.create_table('pdf_transform_operations',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('thesis_id', sa.Uuid(), nullable=False), sa.Column('tenant_id', sa.Uuid(), nullable=False),
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('source_version', sa.Uuid(), nullable=False), sa.Column('expected_version', sa.Integer(), nullable=False),
        sa.Column('purpose', sa.String(32), nullable=False), sa.Column('operation', sa.String(32), nullable=False),
        sa.Column('sources', JSONB, nullable=False), sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('bound_file_id', sa.Uuid(), sa.ForeignKey('file_objects.id')),
        sa.Column('new_file_id', sa.Uuid(), nullable=False), sa.Column('page_count', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('created_by', 'request_hash', name='uq_pdf_transform_request'),
        sa.ForeignKeyConstraint(['source_version','thesis_id','tenant_id'], ['thesis_versions.id','thesis_versions.thesis_id','thesis_versions.tenant_id']),
        sa.ForeignKeyConstraint(['new_file_id','thesis_id','tenant_id','purpose'], ['file_objects.id','file_objects.thesis_id','file_objects.tenant_id','file_objects.purpose']),
        sa.CheckConstraint("status IN ('READY','APPLIED','CANCELLED')", name='ck_pdf_transform_status'),
        sa.CheckConstraint("purpose IN ('original','anonymous')", name='ck_pdf_transform_purpose'),
        sa.CheckConstraint('page_count BETWEEN 1 AND 1000', name='ck_pdf_transform_pages'))
    op.execute('ALTER TABLE pdf_transform_operations ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE pdf_transform_operations FORCE ROW LEVEL SECURITY')
    own = "app_actor_id() IS NOT NULL AND app_role()='student' AND created_by=app_actor_id() AND tenant_id=app_tenant_id()"
    editable = "EXISTS(SELECT 1 FROM theses t JOIN thesis_versions v ON v.id=t.current_version_id WHERE t.id=pdf_transform_operations.thesis_id AND v.id=source_version AND t.stage='DRAFT' AND v.is_editable)"
    op.execute(f'CREATE POLICY transforms_read ON pdf_transform_operations FOR SELECT USING ({own})')
    op.execute(f"CREATE POLICY transforms_insert ON pdf_transform_operations FOR INSERT WITH CHECK ({own} AND {editable} AND status='READY')")
    op.execute(f'CREATE POLICY transforms_update ON pdf_transform_operations FOR UPDATE USING ({own}) WITH CHECK ({own})')
    op.execute('''CREATE FUNCTION guard_pdf_transform_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
             OR OLD.status<>'READY' OR NEW.status NOT IN ('APPLIED','CANCELLED') THEN
            RAISE EXCEPTION 'immutable PDF transform or invalid transition';
          END IF;
          RETURN NEW;
        END $$''')
    op.execute('CREATE TRIGGER pdf_transform_update_guard BEFORE UPDATE ON pdf_transform_operations FOR EACH ROW EXECUTE FUNCTION guard_pdf_transform_update()')
    # Students need metadata for their own unbound source uploads. Other roles see bound material only.
    # PL/pgSQL prevents expanding the already-deep link RLS tree into every file query.
    # SECURITY INVOKER preserves the caller's existing link visibility.
    schema = op.get_bind().dialect.identifier_preparer.quote(op.get_bind().scalar(sa.text('SELECT current_schema()')))
    op.execute(f'''CREATE FUNCTION pdf_file_is_bound(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE
        SECURITY INVOKER SET search_path=pg_catalog,{schema},pg_temp AS $$
        BEGIN RETURN EXISTS(SELECT 1 FROM {schema}.thesis_version_files WHERE file_id=target); END $$''')
    op.execute('REVOKE ALL ON FUNCTION pdf_file_is_bound(uuid) FROM PUBLIC')
    op.execute("CREATE POLICY files_bound_only ON file_objects AS RESTRICTIVE FOR SELECT USING (app_role()='student' OR pdf_file_is_bound(id))")
    url = get_settings().business_database_url
    if url:
        role = op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'GRANT SELECT, INSERT ON pdf_transform_operations TO {role}')
        op.execute(f'GRANT EXECUTE ON FUNCTION pdf_file_is_bound(uuid) TO {role}')
        op.execute(f'GRANT UPDATE(status,updated_at) ON pdf_transform_operations TO {role}')


def downgrade():
    op.execute('ALTER TABLE pdf_transform_operations NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM pdf_transform_operations)')):
        raise ValueError('0026 downgrade would discard PDF provenance')
    op.execute('DROP POLICY files_bound_only ON file_objects')
    op.execute('DROP FUNCTION pdf_file_is_bound(uuid)')
    op.drop_table('pdf_transform_operations')
    op.execute('DROP FUNCTION guard_pdf_transform_update()')
