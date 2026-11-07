import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.user.models import User, UserRoleAssignment
from app.seed import seed_database
from tests.conftest import _test_url, migrated_test_schema


def _alembic(schema: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=Path(__file__).resolve().parents[1],
        env={
            **os.environ,
            "DATABASE_URL": _test_url(),
            "PGOPTIONS": f"-c search_path={schema}",
        },
        capture_output=True,
        text=True,
    )


async def _seed(schema: str) -> tuple[int, int]:
    engine = create_async_engine(
        _test_url(), connect_args={"server_settings": {"search_path": schema}}
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            await seed_database(session)
            await session.commit()
            users = await session.scalar(select(text("count(*)")).select_from(User))
            assignments = await session.scalar(
                select(text("count(*)")).select_from(UserRoleAssignment)
            )
            return int(users or 0), int(assignments or 0)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_0008_rejects_duplicate_user_role_assignments():
    with migrated_test_schema("0007_file_upload_version") as schema:
        assert _alembic(schema, "upgrade", "0015_rls_children").returncode == 0
        await _seed(schema)
        assert _alembic(schema, "downgrade", "0007_file_upload_version").returncode == 0
        engine = create_async_engine(
            _test_url(), connect_args={"server_settings": {"search_path": schema}}
        )
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as session:
                # The current User ORM includes columns absent from this old revision.
                user_id = await session.scalar(text("SELECT id FROM users WHERE username = 'student.lin'"))
                role_id = await session.scalar(text("SELECT id FROM roles WHERE code = 'supervisor'"))
                tenant_id = await session.scalar(text("SELECT tenant_id FROM user_role_assignments WHERE user_id = :user_id"), {"user_id": user_id})
                await session.execute(text("""INSERT INTO user_role_assignments
                    (id, user_id, tenant_id, role_id, data_scope)
                    VALUES (:id, :user_id, :tenant_id, :role_id, '{}'::jsonb)"""),
                    {"id": uuid4(), "user_id": user_id, "tenant_id": tenant_id, "role_id": role_id})
                await session.commit()
        finally:
            await engine.dispose()

        result = _alembic(schema, "upgrade", "0008_identity_invariants")

        assert result.returncode != 0
        assert "duplicate user role assignments" in (result.stdout + result.stderr)


@pytest.mark.asyncio
async def test_0008_upgrade_and_downgrade_preserve_identity_rows():
    with migrated_test_schema("0007_file_upload_version") as schema:
        assert _alembic(schema, "upgrade", "0015_rls_children").returncode == 0
        before = await _seed(schema)
        assert _alembic(schema, "downgrade", "0007_file_upload_version").returncode == 0

        upgraded = _alembic(schema, "upgrade", "0008_identity_invariants")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr

        engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
        try:
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                constraint_exists = conn.execute(
                    text(
                        """
                        SELECT EXISTS (
                          SELECT 1
                          FROM pg_constraint
                          WHERE conname = 'uq_user_role_assignments_user_id'
                            AND conrelid = 'user_role_assignments'::regclass
                        )
                        """
                    )
                ).scalar_one()
                after_upgrade = (
                    conn.execute(text("SELECT count(*) FROM users")).scalar_one(),
                    conn.execute(text("SELECT count(*) FROM user_role_assignments")).scalar_one(),
                )
        finally:
            engine.dispose()

        assert constraint_exists is True
        assert after_upgrade == before

        downgraded = _alembic(schema, "downgrade", "0007_file_upload_version")
        assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr

        engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
        try:
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                constraint_exists = conn.execute(
                    text(
                        """
                        SELECT EXISTS (
                          SELECT 1
                          FROM pg_constraint
                          WHERE conname = 'uq_user_role_assignments_user_id'
                            AND conrelid = 'user_role_assignments'::regclass
                        )
                        """
                    )
                ).scalar_one()
                after_downgrade = (
                    conn.execute(text("SELECT count(*) FROM users")).scalar_one(),
                    conn.execute(text("SELECT count(*) FROM user_role_assignments")).scalar_one(),
                )
        finally:
            engine.dispose()

        assert constraint_exists is False
        assert after_downgrade == before
