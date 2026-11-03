import os
from pathlib import Path
import subprocess
import sys
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.legacy_rls_fixture import legacy_accepted_0015
from tests.conftest import _test_url
from tests.helpers import auth, create_draft, login


@pytest.mark.asyncio
async def test_all_mapped_tables_have_force_rls_and_non_owner_business_login():
    mapped = set(Base.metadata.tables)
    assert len(mapped) == 39
    async with acceptance_environment("operations") as runtime:
        async with runtime.session_factory() as session:
            catalog = (await session.execute(text("""
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                       c.relowner = r.oid AS owned_by_business
                FROM pg_class c JOIN pg_roles r ON r.rolname = current_user
                WHERE c.relnamespace = to_regnamespace(current_schema()) AND c.relkind = 'r'
                  AND c.relname <> 'alembic_version'
            """))).all()
            assert {row.relname for row in catalog} == mapped
            assert all(row.relrowsecurity and row.relforcerowsecurity
                       and not row.owned_by_business for row in catalog)
            assert await session.scalar(text("""
                SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles
                WHERE rolname = current_user
            """)) is True
            policies = (await session.execute(text("""
                SELECT DISTINCT tablename FROM pg_policies
                WHERE schemaname = current_schema()
            """))).scalars().all()
            assert set(policies) == mapped
            for table in sorted(mapped):
                # An intentionally ungranted table fails closed at GRANT; every
                # granted table must plan and execute without a policy recursion.
                permitted = await session.scalar(text("""
                    SELECT has_table_privilege(current_user, :table, 'SELECT')
                """), {"table": table})
                if permitted:
                    assert await session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            assert await session.scalar(text("SELECT id FROM users LIMIT 1")) is None
            assert await session.scalar(text("""
                SELECT has_column_privilege(current_user, 'users', 'password_hash', 'SELECT')
            """)) is False
            assert await session.scalar(text("""
                SELECT has_table_privilege(current_user, 'audit_events', 'SELECT')
            """)) is False


@pytest.mark.asyncio
async def test_operations_role_scope_and_rejected_direct_sql_writes():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            a_student = await login(client, "student.lin", runtime.seed_password)
            a_school = await login(client, "school.wang", runtime.seed_password)
            b_student = await login(client, "pilot.student", runtime.seed_password)
            b_school = await login(client, "pilot.school", runtime.seed_password)
            platform = await login(client, "platform.chen", runtime.seed_password)
            expert = await login(client, "expert.zhou", runtime.seed_password)
            system = await login(client, "admin.system", runtime.seed_password)
            a = await create_draft(client, a_student, title="A 校隔离论文")
            b = await create_draft(client, b_student, title="B 校隔离论文")
            assert (await client.get(f"/api/v1/theses/{a['id']}", headers=auth(b_student))).status_code == 404
            async with runtime.session_factory() as session:
                await bind_candidate_identity(
                    session, verified_access_claims(b_student["access_token"]))
                b_version = await session.scalar(text("""
                    SELECT current_version_id FROM theses WHERE id = :thesis
                """), {"thesis": UUID(b["id"])})
            async with runtime.session_factory() as session:
                await bind_candidate_identity(
                    session, verified_access_claims(a_student["access_token"]))
                with pytest.raises(DBAPIError) as denied_parent:
                    await session.execute(text("""
                        UPDATE theses SET current_version_id = :foreign_version WHERE id = :thesis
                    """), {"foreign_version": b_version, "thesis": UUID(a["id"])})
                assert denied_parent.value.orig.sqlstate in {"23503", "42501"}
                await session.rollback()
            for token, expected in ((a_school, {a["id"]}), (b_school, {b["id"]}),
                                    (platform, {a["id"], b["id"]}),
                                    (expert, set()), (system, set())):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(token["access_token"]))
                    visible = set((await session.execute(text("SELECT id FROM theses"))).scalars())
                    assert visible == {UUID(value) for value in expected}
            async with runtime.session_factory() as session:
                await bind_candidate_identity(
                    session, verified_access_claims(a_school["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM idempotency_keys")) >= 0
                changed = await session.execute(text("""
                    UPDATE theses SET review_batch_id = review_batch_id WHERE id = :other
                """), {"other": UUID(b["id"])})
                assert changed.rowcount == 0
                with pytest.raises(DBAPIError) as denied:
                    await session.execute(text("SELECT password_hash FROM users LIMIT 1"))
                assert denied.value.orig.sqlstate == "42501"
                await session.rollback()
            async with runtime.session_factory() as session:
                assert await session.scalar(text("SELECT count(*) FROM theses")) == 0


@pytest.mark.asyncio
async def test_full_0010_to_0015_downgrade_upgrade_preserves_task_mapping():
    async with legacy_accepted_0015() as runtime:
        task_id, thesis_id = UUID(runtime.task_id), UUID(runtime.thesis_id)
        owner = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={runtime.schema}"})
        migration_env = {**os.environ, "DATABASE_URL": _test_url(),
                         "PGOPTIONS": f"-c search_path={runtime.schema}",
                         "MIGRATION_DATABASE_URL": runtime.roles.migration_url,
                         "BUSINESS_DATABASE_URL": runtime.roles.business_url,
                         "AUTH_DATABASE_URL": runtime.roles.auth_url}

        def migrate(direction: str, revision: str) -> None:
            result = subprocess.run([sys.executable, "-m", "alembic", direction, revision],
                                    cwd=Path(__file__).resolve().parents[1], env=migration_env,
                                    capture_output=True, text=True)
            assert result.returncode == 0, "\n".join(result.stderr.splitlines()[-10:])

        try:
            with owner.connect() as conn:
                original = conn.execute(text("""
                    SELECT task.round_id, round.thesis_id, task.expert_id
                    FROM expert_tasks task JOIN review_rounds round ON round.id = task.round_id
                    WHERE task.id = :task
                """), {"task": task_id}).one()
                assert original.thesis_id == thesis_id
            migrate("downgrade", "0010_auth_version")
            with owner.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0010_auth_version"
                old = conn.execute(text("""
                    SELECT task.round_id, round.thesis_id, task.expert_id
                    FROM expert_tasks task JOIN review_rounds round ON round.id = task.round_id
                    WHERE task.id = :task
                """), {"task": task_id}).one()
                assert tuple(old) == tuple(original)
            migrate("upgrade", "0014_rls_workflow")
            with owner.connect() as conn:
                mismatch = conn.execute(text("""
                    SELECT l.id, l.purpose AS link_purpose, f.purpose AS file_purpose,
                           f.thesis_id AS file_thesis, v.thesis_id AS version_thesis,
                           f.tenant_id AS file_tenant, v.tenant_id AS version_tenant
                    FROM thesis_version_files l
                    JOIN file_objects f ON f.id = l.file_id
                    JOIN thesis_versions v ON v.id = l.thesis_version_id
                    WHERE f.purpose IS DISTINCT FROM l.purpose
                       OR f.thesis_id IS DISTINCT FROM v.thesis_id
                       OR f.tenant_id IS DISTINCT FROM v.tenant_id
                """)).all()
                assert not mismatch, mismatch
            migrate("upgrade", "0015_rls_children")
            with owner.connect() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0015_rls_children"
                restored = conn.execute(text("""
                    SELECT task.round_id, round.thesis_id, task.expert_id, task.thesis_id
                    FROM expert_tasks task JOIN review_rounds round ON round.id = task.round_id
                    WHERE task.id = :task
                """), {"task": task_id}).one()
                assert tuple(restored[:3]) == tuple(original)
                assert restored.thesis_id == thesis_id
        finally:
            owner.dispose()
