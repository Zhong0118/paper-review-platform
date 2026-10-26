"""Versioned school terms and bound check sources; no full vocabulary grant to students."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0025_sensitive_locations'
down_revision = '0024_expert_task_time_scope'
branch_labels = depends_on = None


def upgrade():
    bind = op.get_bind()
    quote = bind.dialect.identifier_preparer.quote
    schema = quote(bind.scalar(sa.text('SELECT current_schema()')))
    owner = quote(bind.scalar(sa.text('SELECT current_user')))
    op.create_table('tenant_sensitive_terms',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('tenant_id', sa.Uuid(), sa.ForeignKey('tenants.id'), nullable=False, unique=True),
        sa.Column('terms', JSONB, nullable=False), sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.add_column('anonymization_checks', sa.Column('source_metadata', JSONB, nullable=True))
    op.execute('ALTER TABLE tenant_sensitive_terms ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE tenant_sensitive_terms FORCE ROW LEVEL SECURITY')
    school = "app_actor_id() IS NOT NULL AND app_role()='school_reviewer' AND tenant_id=app_tenant_id()"
    op.execute(f'CREATE POLICY terms_school ON tenant_sensitive_terms FOR ALL USING ({school}) WITH CHECK ({school})')
    op.execute(f'''CREATE POLICY terms_detector_read ON tenant_sensitive_terms FOR SELECT TO {owner}
        USING (app_actor_id() IS NOT NULL AND app_role() IN ('student','school_reviewer') AND tenant_id=app_tenant_id())''')
    # Both paths are limited by the existing thesis-version RLS; platform no longer reads identity findings.
    for name in ('checks_read', 'checks_insert'):
        op.execute(f'DROP POLICY {name} ON anonymization_checks')
    check = "app_actor_id() IS NOT NULL AND app_role() IN ('student','school_reviewer') AND EXISTS (SELECT 1 FROM thesis_versions v WHERE v.id=anonymization_checks.thesis_version_id)"
    op.execute(f'CREATE POLICY checks_read ON anonymization_checks FOR SELECT USING ({check})')
    op.execute(f'CREATE POLICY checks_insert ON anonymization_checks FOR INSERT WITH CHECK ({check})')
    op.execute(f'''CREATE FUNCTION match_sensitive_terms(target_thesis uuid, target_file uuid, source_texts jsonb)
        RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE tenant uuid; config_version integer; matched jsonb;
        BEGIN
          IF {schema}.app_actor_id() IS NULL OR {schema}.app_role() NOT IN ('student','school_reviewer') THEN RETURN NULL; END IF;
          SELECT t.tenant_id INTO tenant FROM {schema}.theses t
            JOIN {schema}.thesis_version_files l ON l.thesis_version_id=t.current_version_id AND l.thesis_id=t.id
            JOIN {schema}.file_objects f ON f.id=l.file_id AND f.thesis_id=t.id AND f.tenant_id=t.tenant_id
            WHERE t.id=target_thesis AND t.tenant_id={schema}.app_tenant_id()
              AND f.id=target_file AND l.purpose='anonymous' AND f.purpose='anonymous' AND f.completed_at IS NOT NULL;
          IF tenant IS NULL THEN RETURN NULL; END IF;
          IF jsonb_typeof(source_texts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid check sources'; END IF;
          IF jsonb_array_length(source_texts)>1005 OR octet_length(source_texts::text)>16000000
             OR EXISTS(SELECT 1 FROM jsonb_array_elements(source_texts) d WHERE jsonb_typeof(d)<>'string')
             THEN RAISE EXCEPTION 'invalid check sources'; END IF;
          PERFORM pg_advisory_xact_lock(hashtextextended('sensitive-terms:' || tenant::text, 0));
          SELECT c.version, coalesce((SELECT jsonb_agg(term) FROM jsonb_array_elements(c.terms) term
              WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(source_texts) doc WHERE strpos(doc,term->>'text')>0)), '[]'::jsonb)
            INTO config_version, matched FROM {schema}.tenant_sensitive_terms c WHERE c.tenant_id=tenant;
          RETURN jsonb_build_object('version',coalesce(config_version,0),'terms',coalesce(matched,'[]'::jsonb));
        END $$''')
    op.execute('REVOKE ALL ON FUNCTION match_sensitive_terms(uuid,uuid,jsonb) FROM PUBLIC')
    url = get_settings().business_database_url
    if url:
        business = quote(make_url(url).username)
        op.execute(f'GRANT SELECT, INSERT, UPDATE ON tenant_sensitive_terms TO {business}')
        op.execute(f'GRANT EXECUTE ON FUNCTION match_sensitive_terms(uuid,uuid,jsonb) TO {business}')


def downgrade():
    for table in ('tenant_sensitive_terms', 'anonymization_checks'):
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM tenant_sensitive_terms) OR EXISTS(SELECT 1 FROM anonymization_checks WHERE source_metadata IS NOT NULL)')):
        raise ValueError('0025 downgrade would discard sensitive terms or bound reports')
    op.execute('ALTER TABLE anonymization_checks FORCE ROW LEVEL SECURITY')
    op.execute('DROP FUNCTION match_sensitive_terms(uuid,uuid,jsonb)')
    for name in ('checks_read', 'checks_insert'):
        op.execute(f'DROP POLICY {name} ON anonymization_checks')
    version = 'EXISTS (SELECT 1 FROM thesis_versions v WHERE v.id=anonymization_checks.thesis_version_id)'
    op.execute(f"CREATE POLICY checks_read ON anonymization_checks FOR SELECT USING (app_actor_id() IS NOT NULL AND app_role() IN ('student','school_reviewer','platform_reviewer') AND {version})")
    op.execute(f"CREATE POLICY checks_insert ON anonymization_checks FOR INSERT WITH CHECK (app_actor_id() IS NOT NULL AND app_role()='student' AND {version})")
    op.drop_column('anonymization_checks', 'source_metadata')
    op.drop_table('tenant_sensitive_terms')
