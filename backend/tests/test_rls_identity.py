import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.conftest import isolated_runtime_roles, upgrade_test_schema


IDENTITY_TABLES = (
    "users", "roles", "user_role_assignments", "tenant_user_memberships", "auth_sessions",
)


@pytest.mark.asyncio
async def test_identity_rows_require_context_and_business_cannot_read_password_hash():
    async with acceptance_environment("empty") as runtime:
        async with runtime.session_factory() as session:
            assert (await session.scalar(text("SELECT count(*) FROM users"))) == 0
            assert (await session.scalar(text("SELECT count(*) FROM user_role_assignments"))) == 0
            assert (await session.scalar(text("SELECT count(*) FROM tenant_user_memberships"))) == 0
            assert (await session.scalar(text("""
                SELECT has_column_privilege(current_user, 'users', 'password_hash', 'SELECT')
            """))) is False
            protected = (await session.execute(text("""
                SELECT relname, relrowsecurity, relforcerowsecurity
                FROM pg_class WHERE relnamespace = to_regnamespace(current_schema())
                  AND relname = ANY(:tables)
            """), {"tables": list(IDENTITY_TABLES)})).all()
            assert len(protected) == 5
            assert all(row.relrowsecurity and row.relforcerowsecurity for row in protected)


@pytest.mark.asyncio
async def test_login_and_me_work_without_business_password_hash_select():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
            assert login.status_code == 200
            token = login.json()["data"]["access_token"]
            me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
            assert me.status_code == 200
            assert me.json()["data"]["username"] == "student.lin"


@pytest.mark.asyncio
async def test_student_can_lock_own_membership_but_cannot_change_its_status():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            row = (await session.execute(text("""
                SELECT id, is_active FROM tenant_user_memberships
                WHERE user_id = :user_id FOR UPDATE
            """), {"user_id": claims.user_id})).one()
            assert row.is_active is True
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE tenant_user_memberships SET is_active = false WHERE id = :id
                """), {"id": row.id})
            await session.rollback()


@pytest.mark.asyncio
async def test_school_reviewer_cannot_disable_a_staff_account_directly():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            changed = await session.execute(text("""
                UPDATE users SET status = 'DISABLED' WHERE id = :user_id
            """), {"user_id": claims.user_id})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_school_reviewer_cannot_expire_a_staff_assignment_directly():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            changed = await session.execute(text("""
                UPDATE user_role_assignments SET effective_until = now()
                WHERE user_id = :user_id
            """), {"user_id": claims.user_id})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_school_reviewer_cannot_revoke_a_staff_session_directly():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            changed = await session.execute(text("""
                UPDATE auth_sessions SET revoked_at = now() WHERE user_id = :user_id
            """), {"user_id": claims.user_id})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_school_identity_reads_only_its_users_and_cannot_read_hashes():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            school = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
            other_student = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
        claims = verified_access_claims(school.json()["data"]["access_token"])
        other_claims = verified_access_claims(other_student.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            own = await session.scalar(text("SELECT count(*) FROM users WHERE username = 'pilot.student'"))
            foreign = await session.scalar(text("SELECT count(*) FROM users WHERE username = 'student.lin'"))
            foreign_member = await session.scalar(text("""
                SELECT count(*) FROM tenant_user_memberships WHERE tenant_id = :tenant_id
            """), {"tenant_id": other_claims.tenant_id})
            assert (own, foreign, foreign_member) == (1, 0, 0)
            with pytest.raises(DBAPIError):
                await session.execute(text("SELECT password_hash FROM users LIMIT 1"))
            await session.rollback()


@pytest.mark.asyncio
async def test_school_cannot_attach_a_foreign_user_to_its_membership():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            school = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
            foreign = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
        claims = verified_access_claims(school.json()["data"]["access_token"])
        foreign_id = verified_access_claims(foreign.json()["data"]["access_token"]).user_id
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            organization_id = await session.scalar(text("""
                SELECT organization_id FROM tenant_user_memberships WHERE user_id = :user_id
            """), {"user_id": claims.user_id})
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    INSERT INTO tenant_user_memberships
                        (id, tenant_id, user_id, organization_id, membership_type,
                         external_id, external_source, is_active)
                    VALUES (:id, :tenant_id, :user_id, :organization_id, 'STUDENT',
                            :external_id, 'test', true)
                """), {"id": uuid4(), "tenant_id": claims.tenant_id,
                       "user_id": foreign_id, "organization_id": organization_id,
                       "external_id": uuid4().hex})
            await session.rollback()


@pytest.mark.asyncio
async def test_system_admin_sees_staff_memberships_without_student_records():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            admin = await client.post("/api/v1/auth/login", json={
                "username": "admin.system", "password": runtime.seed_password,
            })
        claims = verified_access_claims(admin.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            staff = await session.scalar(text("""
                SELECT count(*) FROM tenant_user_memberships WHERE membership_type = 'STAFF'
            """))
            students = await session.scalar(text("""
                SELECT count(*) FROM tenant_user_memberships
                WHERE membership_type IN ('STUDENT', 'SUPERVISOR')
            """))
            assert staff >= 1
            assert students == 0


def test_identity_migration_can_downgrade_and_upgrade_in_isolated_schema():
    with isolated_runtime_roles() as roles:
        environment = {
            **os.environ,
            "DATABASE_URL": roles.migration_url,
            "MIGRATION_DATABASE_URL": roles.migration_url,
            "BUSINESS_DATABASE_URL": roles.business_url,
            "AUTH_DATABASE_URL": roles.auth_url,
            "PGOPTIONS": f"-c search_path={roles.schema}",
        }
        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0010_auth_version"],
            cwd=Path(__file__).resolve().parents[1], env=environment,
            capture_output=True, text=True, check=True,
        )
        owner = create_engine(
            roles.migration_url.replace("+asyncpg", "+psycopg"),
            connect_args={"options": f"-c search_path={roles.schema}"},
        )
        try:
            with owner.connect() as conn:
                assert conn.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='users'::regclass")) is False
            upgrade_test_schema("head", roles.schema, roles.migration_url,
                                roles.business_url, roles.auth_url)
            with owner.connect() as conn:
                assert conn.scalar(text("SELECT relforcerowsecurity FROM pg_class WHERE oid='users'::regclass")) is True
        finally:
            owner.dispose()


@pytest.mark.asyncio
async def test_auth_login_role_cannot_read_contact_or_student_number_columns():
    async with acceptance_environment("empty") as runtime:
        engine = create_async_engine(
            get_settings().auth_database_url,
            connect_args={"server_settings": {"search_path": runtime.schema}},
        )
        try:
            async with engine.connect() as conn:
                with pytest.raises(DBAPIError):
                    await conn.execute(text("SELECT contact_email FROM users LIMIT 1"))
                await conn.rollback()
                with pytest.raises(DBAPIError):
                    await conn.execute(text("SELECT external_id FROM tenant_user_memberships LIMIT 1"))
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_school_creator_cannot_see_old_tenant_users_after_tenant_changes():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            student_id = await session.scalar(text("""
                SELECT user_id FROM tenant_user_memberships WHERE id = :member_id
            """), {"member_id": runtime.operations_ids["student_member_id"]})
            assert student_id is not None
            # Simulate this same reviewer later receiving a verified token for another school.
            await session.execute(text("SELECT set_config('app.tenant_id', :tenant, true)"),
                                  {"tenant": str(uuid4())})
            assert await session.scalar(text("SELECT count(*) FROM users WHERE id = :id"),
                                        {"id": student_id}) == 0
