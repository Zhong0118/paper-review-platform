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


@pytest.mark.asyncio
async def test_metadata_rows_default_deny_without_actor():
    async with acceptance_environment("operations") as runtime:
        async with runtime.session_factory() as session:
            for table in ("tenants", "organizations", "review_batches", "discipline_catalog",
                          "experts", "expert_conflicts", "idempotency_keys"):
                assert await session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            assert await session.scalar(text("""
                SELECT count(*) FROM pg_class WHERE relnamespace = to_regnamespace(current_schema())
                  AND relname = ANY(:tables) AND relrowsecurity AND relforcerowsecurity
            """), {"tables": ["tenants", "organizations", "review_batches",
                             "discipline_catalog", "experts", "expert_conflicts",
                             "idempotency_keys", "audit_events"]}) == 8


@pytest.mark.asyncio
async def test_auth_role_reads_only_tenant_login_columns():
    async with acceptance_environment("empty") as runtime:
        engine = create_async_engine(get_settings().auth_database_url,
                                     connect_args={"server_settings": {"search_path": runtime.schema}})
        admin_engine = create_async_engine(get_settings().database_url,
                                           connect_args={"server_settings": {"search_path": runtime.schema}})
        try:
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM tenants")) >= 2
                tenant_id = await conn.scalar(text("""
                    SELECT id FROM tenants WHERE code = 'demo-univ'
                """))
                assert await conn.scalar(text("""
                    SELECT has_column_privilege(current_user, 'tenants', 'status', 'SELECT')
                """)) is True
                assert await conn.scalar(text("""
                    SELECT has_column_privilege(current_user, 'tenants', 'name', 'SELECT')
                """)) is False
                assert await conn.scalar(text("""
                    SELECT has_table_privilege(current_user, 'organizations', 'SELECT')
                """)) is False
                assert await conn.scalar(text("""
                    SELECT has_table_privilege(current_user, 'theses', 'SELECT')
                """)) is False
            async with admin_engine.begin() as conn:
                await conn.execute(text("""
                    UPDATE tenants SET status = 'SUSPENDED' WHERE id = :id
                """), {"id": tenant_id})
            async with engine.connect() as conn:
                assert await conn.scalar(text("""
                    SELECT status FROM tenants WHERE id = :id
                """), {"id": tenant_id}) == "SUSPENDED"
            async with AsyncClient(transport=ASGITransport(app=runtime.app),
                                   base_url="http://test") as client:
                response = await client.post("/api/v1/auth/login", json={
                    "username": "student.lin", "password": runtime.seed_password,
                })
                assert response.status_code == 401
        finally:
            await admin_engine.dispose()
            await engine.dispose()


@pytest.mark.asyncio
async def test_school_and_system_metadata_visibility_and_parent_tenant_constraint():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            school_login = await client.post("/api/v1/auth/login", json={
                "username": "pilot.school", "password": runtime.seed_password,
            })
            admin_login = await client.post("/api/v1/auth/login", json={
                "username": "admin.system", "password": runtime.seed_password,
            })
        school = verified_access_claims(school_login.json()["data"]["access_token"])
        admin = verified_access_claims(admin_login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, school)
            assert await session.scalar(text("SELECT count(*) FROM tenants")) == 1
            assert await session.scalar(text("SELECT count(*) FROM review_batches")) == 1
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE tenants SET status = 'SUSPENDED' WHERE id = :tenant_id
                """), {"tenant_id": runtime.operations_ids["tenant_id"]})
            await session.rollback()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, admin)
            assert await session.scalar(text("SELECT count(*) FROM tenants")) >= 3
            assert await session.scalar(text("SELECT count(*) FROM review_batches")) == 0
            orgs = (await session.execute(text("""
                SELECT id, tenant_id FROM organizations ORDER BY tenant_id
            """))).all()
            own = next(row for row in orgs if str(row.tenant_id) == runtime.operations_ids["tenant_id"])
            foreign = next(row for row in orgs if row.tenant_id != own.tenant_id)
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE organizations SET parent_id = :foreign_id WHERE id = :own_id
                """), {"foreign_id": foreign.id, "own_id": own.id})
            await session.rollback()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, school)
            changed = await session.execute(text("""
                UPDATE review_batches SET status = 'ARCHIVED'
                WHERE tenant_id <> :tenant_id
            """), {"tenant_id": runtime.operations_ids["tenant_id"]})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_business_cannot_read_audit_and_auth_cannot_write_success_event():
    async with acceptance_environment("empty") as runtime:
        async with runtime.session_factory() as session:
            assert await session.scalar(text("""
                SELECT has_table_privilege(current_user, 'audit_events', 'SELECT')
            """)) is False
        engine = create_async_engine(get_settings().auth_database_url,
                                     connect_args={"server_settings": {"search_path": runtime.schema}})
        try:
            async with engine.connect() as conn:
                with pytest.raises(DBAPIError):
                    await conn.execute(text("""
                        INSERT INTO audit_events (id, action, object_type, result, detail)
                        VALUES (:id, 'file_read', 'file', 'SUCCESS', '{}'::jsonb)
                    """), {"id": uuid4()})
                await conn.rollback()
                actor_id = await conn.scalar(text("""
                    SELECT id FROM users WHERE username = 'admin.system'
                """))
                await conn.execute(text("SELECT set_config('app.user_id', :id, true)"),
                                   {"id": str(actor_id)})
                await conn.execute(text("SELECT set_config('app.role', 'system_admin', true)"))
                with pytest.raises(DBAPIError):
                    await conn.execute(text("""
                        INSERT INTO audit_events
                            (id, actor_id, action, object_type, result, detail)
                        VALUES (:id, :actor_id, 'file_read', 'file', 'SUCCESS', '{}'::jsonb)
                    """), {"id": uuid4(), "actor_id": actor_id})
                await conn.rollback()
                await conn.execute(text("""
                    INSERT INTO audit_events (id, action, object_type, result, detail)
                    VALUES (:id, 'file_read', 'file', 'DENIED', '{}'::jsonb)
                """), {"id": uuid4()})
                await conn.commit()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_business_audit_cannot_attribute_another_actor():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_login = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
            admin_login = await client.post("/api/v1/auth/login", json={
                "username": "admin.system", "password": runtime.seed_password,
            })
        student = verified_access_claims(student_login.json()["data"]["access_token"])
        admin = verified_access_claims(admin_login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, student)
            with pytest.raises(DBAPIError) as exc:
                await session.execute(text("""
                    INSERT INTO audit_events
                        (id, tenant_id, actor_id, action, object_type, result, detail)
                    VALUES (:id, :tenant_id, :actor_id, 'file_read', 'file', 'SUCCESS', '{}'::jsonb)
                """), {"id": uuid4(), "tenant_id": student.tenant_id,
                       "actor_id": admin.user_id})
            assert getattr(exc.value.orig, "sqlstate", None) == "42501"
            await session.rollback()


@pytest.mark.asyncio
async def test_expert_directory_and_idempotency_are_actor_scoped():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            responses = [await client.post("/api/v1/auth/login", json={
                "username": username, "password": runtime.seed_password,
            }) for username in ("student.lin", "expert.zhou", "platform.chen")]
        student, expert, platform = (
            verified_access_claims(response.json()["data"]["access_token"])
            for response in responses
        )
        for claims, expected in ((student, 0), (expert, 1)):
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, claims)
                assert await session.scalar(text("SELECT count(*) FROM experts")) == expected
                assert await session.scalar(text("SELECT count(*) FROM expert_conflicts")) == 0
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, platform)
            assert await session.scalar(text("SELECT count(*) FROM experts")) >= 2

        key_id = uuid4()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, student)
            await session.execute(text("""
                INSERT INTO idempotency_keys
                    (id, user_id, key, route, request_hash, response_code, response_body)
                VALUES (:id, :user_id, 'scope-check', 'test', 'digest', 200, '{}'::jsonb)
            """), {"id": key_id, "user_id": student.user_id})
            await session.commit()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, expert)
            assert await session.scalar(text("""
                SELECT count(*) FROM idempotency_keys WHERE id = :id
            """), {"id": key_id}) == 0
            with pytest.raises(DBAPIError) as exc:
                await session.execute(text("""
                    INSERT INTO idempotency_keys
                        (id, user_id, key, route, request_hash, response_code, response_body)
                    VALUES (:id, :user_id, 'foreign-scope', 'test', 'digest', 200, '{}'::jsonb)
                """), {"id": uuid4(), "user_id": student.user_id})
            assert getattr(exc.value.orig, "sqlstate", None) == "42501"
            await session.rollback()


@pytest.mark.asyncio
async def test_student_can_lock_batch_for_draft_but_cannot_change_it():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
        claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            batch_id = await session.scalar(text("""
                SELECT id FROM review_batches WHERE tenant_id = :tenant_id AND status = 'OPEN'
                FOR UPDATE
            """), {"tenant_id": claims.tenant_id})
            assert batch_id is not None
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE review_batches SET status = 'ARCHIVED' WHERE id = :id
                """), {"id": batch_id})
            await session.rollback()


def test_metadata_migration_downgrade_and_upgrade_in_isolated_schema():
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
            [sys.executable, "-m", "alembic", "downgrade", "0011_rls_identity"],
            cwd=Path(__file__).resolve().parents[1], env=environment,
            capture_output=True, text=True, check=True,
        )
        owner = create_engine(
            roles.migration_url.replace("+asyncpg", "+psycopg"),
            connect_args={"options": f"-c search_path={roles.schema}"},
        )
        auth = create_engine(
            roles.auth_url.replace("+asyncpg", "+psycopg"),
            connect_args={"options": f"-c search_path={roles.schema}"},
        )
        try:
            with owner.connect() as conn:
                assert conn.scalar(text("""
                    SELECT relrowsecurity FROM pg_class WHERE oid='organizations'::regclass
                """)) is False
                assert conn.scalar(text("""
                    SELECT count(*) FROM pg_constraint
                    WHERE conname = 'fk_organizations_parent_same_tenant'
                      AND conrelid = 'organizations'::regclass
                """)) == 0
            with auth.connect() as conn:
                assert conn.scalar(text("""
                    SELECT has_column_privilege(current_user, 'tenants', 'status', 'SELECT')
                """)) is False
                assert conn.scalar(text("""
                    SELECT has_table_privilege(current_user, 'audit_events', 'INSERT')
                """)) is False
            upgrade_test_schema("head", roles.schema, roles.migration_url,
                                roles.business_url, roles.auth_url)
            with owner.connect() as conn:
                assert conn.scalar(text("""
                    SELECT relforcerowsecurity FROM pg_class WHERE oid='organizations'::regclass
                """)) is True
                assert conn.scalar(text("""
                    SELECT count(*) FROM pg_constraint
                    WHERE conname = 'fk_organizations_parent_same_tenant'
                      AND conrelid = 'organizations'::regclass
                """)) == 1
        finally:
            auth.dispose()
            owner.dispose()
