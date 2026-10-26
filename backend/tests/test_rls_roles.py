import os
from pathlib import Path
import subprocess
import sys

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, text

from tests.conftest import _test_url, isolated_runtime_roles


@pytest.mark.asyncio
async def test_runtime_role_is_not_owner_or_bypass():
    from scripts.acceptance_server import acceptance_environment

    async with acceptance_environment("empty") as runtime:
        async with runtime.session_factory() as session:
            row = (await session.execute(text("""
                SELECT current_user, r.rolsuper, r.rolbypassrls,
                       EXISTS (
                           SELECT 1 FROM pg_class c
                           WHERE c.relnamespace = to_regnamespace(current_schema())
                             AND c.relkind = 'r' AND c.relowner = r.oid
                       ) AS owns_table
                FROM pg_roles r
                WHERE r.rolname = current_user
            """))).one()
        assert row.rolsuper is False
        assert row.rolbypassrls is False
        assert row.owns_table is False


def test_production_config_requires_distinct_database_logins():
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production", migration_database_url=None,
                 business_database_url=None, auth_database_url=None)
    with pytest.raises(ValidationError):
        Settings(app_env="production",
                 migration_database_url="postgresql+asyncpg://owner:test@127.0.0.1:5433/paper_review_test",
                 business_database_url="postgresql+asyncpg://owner:test@127.0.0.1:5433/paper_review_test",
                 auth_database_url="postgresql+asyncpg://auth:test@127.0.0.1:5433/paper_review_test")


def test_default_http_session_uses_business_login_when_configured():
    env = {**os.environ, "APP_ENV": "development",
           "DATABASE_URL": "postgresql+asyncpg://migration:sample@127.0.0.1:5433/paper_review_test",
           "BUSINESS_DATABASE_URL": "postgresql+asyncpg://business:sample@127.0.0.1:5433/paper_review_test"}
    result = subprocess.run(
        [sys.executable, "-c", "from app.db.session import engine; print(engine.url.username)"],
        cwd=Path(__file__).resolve().parents[1], env=env, check=True, capture_output=True, text=True,
    )
    assert result.stdout.strip() == "business"


@pytest.mark.asyncio
async def test_runtime_sessions_have_only_their_own_schema_privileges(
    rls_role_environment, runtime_business_session, runtime_auth_session, migration_connection
):
    roles = rls_role_environment
    assert migration_connection.execute(text("SELECT current_user")).scalar_one() == roles.owner_role
    assert (await runtime_auth_session.execute(text("SELECT current_user"))).scalar_one() == roles.auth_role
    row = (await runtime_business_session.execute(text("""
        SELECT current_database() AS database_name, current_schema() AS schema_name,
               current_user AS login_name,
               has_schema_privilege(current_user, :schema, 'CREATE') AS can_create,
               has_table_privilege(current_user, :users, 'TRUNCATE') AS can_truncate,
               has_table_privilege(current_user, :users, 'REFERENCES') AS can_reference,
               pg_has_role(current_user, :owner, 'MEMBER') AS owner_member,
               pg_has_role(current_user, :auth, 'MEMBER') AS auth_member
    """), {"schema": roles.schema, "users": f"{roles.schema}.users",
           "owner": roles.owner_role, "auth": roles.auth_role})).one()
    assert row.database_name == "paper_review_test"
    assert row.schema_name == roles.schema
    assert row.login_name == roles.business_role
    assert not any((row.can_create, row.can_truncate, row.can_reference,
                    row.owner_member, row.auth_member))
    count, all_owned, no_truncate, no_references = migration_connection.execute(text("""
        SELECT count(*), bool_and(c.relowner = r.oid),
               bool_and(NOT has_table_privilege(:business, c.oid, 'TRUNCATE')),
               bool_and(NOT has_table_privilege(:business, c.oid, 'REFERENCES'))
        FROM pg_class c JOIN pg_roles r ON r.rolname = :owner
        WHERE c.relnamespace = to_regnamespace(:schema) AND c.relkind = 'r'
          AND c.relname <> 'alembic_version'
    """), {"owner": roles.owner_role, "business": roles.business_role,
           "schema": roles.schema}).one()
    assert count == 34
    assert all_owned is True
    assert no_truncate is True
    assert no_references is True
    assert (await runtime_auth_session.execute(text(
        "SELECT has_column_privilege(current_user, :users, 'password_hash', 'SELECT')"
    ), {"users": f"{roles.schema}.users"})).scalar_one()
    assert not (await runtime_auth_session.execute(text(
        "SELECT has_table_privilege(current_user, :theses, 'SELECT')"
    ), {"theses": f"{roles.schema}.theses"})).scalar_one()


def test_isolated_roles_are_removed_after_their_schema():
    admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
    try:
        with isolated_runtime_roles() as roles:
            names = (roles.owner_role, roles.business_role, roles.auth_role)
            schema = roles.schema
        with admin.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM pg_roles WHERE rolname = ANY(:names)"),
                                {"names": list(names)}).scalar_one() == 0
            assert conn.execute(text("SELECT to_regnamespace(:schema)"),
                                {"schema": schema}).scalar_one() is None
    finally:
        admin.dispose()
