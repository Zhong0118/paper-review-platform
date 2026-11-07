import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import create_engine, text

from tests.conftest import _test_url, migrated_test_schema


def migrate(schema, direction, revision):
    return subprocess.run([sys.executable, '-m', 'alembic', direction, revision],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, 'DATABASE_URL': _test_url(), 'PGOPTIONS': f'-c search_path={schema}'},
        capture_output=True, text=True)


def test_empty_expert_migration_roundtrip():
    with migrated_test_schema('0015_rls_children') as schema:
        for direction, target in [('upgrade', '0016_expert_operations'),
                                  ('downgrade', '0015_rls_children'), ('upgrade', '0016_expert_operations')]:
            assert migrate(schema, direction, target).returncode == 0


def test_existing_expert_backfilled_and_downgrade_refused():
    with migrated_test_schema('0015_rls_children') as schema:
        engine = create_engine(_test_url().replace('+asyncpg','+psycopg'),
                               connect_args={'options': f'-c search_path={schema}'})
        try:
            uid, eid = uuid4(), uuid4()
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO users (id,username,password_hash,display_name,status) VALUES (:id,'migration.expert','unused','Migration','ACTIVE')"), {'id':uid})
                conn.execute(text("INSERT INTO experts (id,user_id,service_status,discipline_codes) VALUES (:id,:uid,'AVAILABLE','[\"0812\"]')"), {'id':eid,'uid':uid})
            assert migrate(schema, 'upgrade', '0016_expert_operations').returncode == 0
            refused = migrate(schema, 'downgrade', '0015_rls_children')
            assert refused.returncode != 0
            assert 'requires empty expert tables' in refused.stderr
            with engine.connect() as conn:
                row = conn.execute(text('SELECT qualification_status,version,unit,title FROM experts WHERE id=:id'), {'id':eid}).one()
                assert tuple(row) == ('APPROVED',1,'','')
                assert conn.scalar(text('SELECT version_num FROM alembic_version')) == '0016_expert_operations'
                assert conn.scalar(text("SELECT relforcerowsecurity FROM pg_class WHERE oid='experts'::regclass"))
        finally:
            engine.dispose()


def test_invalid_legacy_status_rejects_upgrade_atomically():
    with migrated_test_schema('0015_rls_children') as schema:
        engine = create_engine(_test_url().replace('+asyncpg','+psycopg'),
                               connect_args={'options': f'-c search_path={schema}'})
        try:
            uid = uuid4()
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO users (id,username,password_hash,display_name,status) VALUES (:id,'bad.expert','unused','Migration','ACTIVE')"), {'id':uid})
                conn.execute(text("INSERT INTO experts (id,user_id,service_status,discipline_codes) VALUES (:id,:uid,'UNKNOWN','[]')"), {'id':uuid4(),'uid':uid})
            result = migrate(schema, 'upgrade', '0016_expert_operations')
            assert result.returncode != 0 and '0016 preflight' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT version_num FROM alembic_version')) == '0015_rls_children'
                assert conn.scalar(text("SELECT relforcerowsecurity FROM pg_class WHERE oid='experts'::regclass"))
        finally:
            engine.dispose()


def test_0016_business_has_no_expert_write_grants():
    from tests.conftest import isolated_runtime_roles
    with isolated_runtime_roles(revision='0016_expert_operations') as roles:
        engine=create_engine(roles.business_url.replace('+asyncpg','+psycopg'),
                             connect_args={'options': f'-c search_path={roles.schema}'})
        try:
            with engine.connect() as conn:
                assert not conn.scalar(text("SELECT has_any_column_privilege(current_user,'experts','UPDATE')"))
                assert not conn.scalar(text("SELECT has_table_privilege(current_user,'experts','INSERT')"))
        finally:
            engine.dispose()


def test_0017_roundtrip_restores_previous_policy():
    with migrated_test_schema('0016_expert_operations') as schema:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={schema}'})
        try:
            with engine.connect() as conn:
                before=conn.scalar(text("SELECT with_check FROM pg_policies WHERE schemaname=current_schema() AND policyname='assignments_business_insert'"))
            assert migrate(schema,'upgrade','0017_expert_management').returncode==0
            assert migrate(schema,'downgrade','0016_expert_operations').returncode==0
            with engine.connect() as conn:
                after=conn.scalar(text("SELECT with_check FROM pg_policies WHERE schemaname=current_schema() AND policyname='assignments_business_insert'"))
                # PostgreSQL deparses redundant qualifications; compare behavioral SQL below too.
                assert 'app_provisioned_user' not in after
                assert 'provisioned_tenant_id = user_role_assignments.tenant_id' in before
                assert 'provisioned_tenant_id = user_role_assignments.tenant_id' in after
                assert conn.scalar(text("SELECT to_regprocedure('app_provisioned_user(uuid,uuid)')")) is None
            assert migrate(schema,'upgrade','0017_expert_management').returncode==0
        finally:
            engine.dispose()


def test_0017_nonempty_downgrade_is_atomic():
    with migrated_test_schema('0017_expert_management') as schema:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={schema}'})
        try:
            uid,eid=uuid4(),uuid4()
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO users(id,username,password_hash,display_name,status) VALUES(:id,'keep.expert','unused','Keep','ACTIVE')"),{'id':uid})
                conn.execute(text("INSERT INTO experts(id,user_id,service_status,discipline_codes) VALUES(:id,:uid,'AVAILABLE','[]')"),{'id':eid,'uid':uid})
            result=migrate(schema,'downgrade','0016_expert_operations')
            assert result.returncode!=0 and 'requires empty expert tables' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT version_num FROM alembic_version'))=='0017_expert_management'
                assert conn.scalar(text('SELECT count(*) FROM experts WHERE id=:id'),{'id':eid})==1
                assert conn.scalar(text("SELECT relforcerowsecurity FROM pg_class WHERE oid='experts'::regclass")) is True
                assert conn.scalar(text("SELECT to_regprocedure('app_provisioned_user(uuid,uuid)')")) is not None
        finally:
            engine.dispose()
