import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text

from tests.conftest import _test_url, migrated_test_schema


def _alembic(schema: str, command: str, revision: str):
    return subprocess.run(
        [sys.executable, "-m", "alembic", command, revision],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": _test_url(), "PGOPTIONS": f"-c search_path={schema}"},
        capture_output=True, text=True,
    )


def test_auth_version_upgrade_downgrade_preserves_user_and_password():
    with migrated_test_schema("0009_pilot_operations") as schema:
        engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
        user_id = str(uuid4())
        try:
            with engine.begin() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                conn.execute(text("INSERT INTO users (id, username, password_hash, status) VALUES (:id, :name, :hash, 'ACTIVE')"),
                             {"id": user_id, "name": "migration.user", "hash": "hash-before"})

            upgraded = _alembic(schema, "upgrade", "0010_auth_version")
            assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                row = conn.execute(text("SELECT password_hash, auth_version FROM users WHERE id=:id"), {"id": user_id}).one()
                assert row == ("hash-before", 1)

            downgraded = _alembic(schema, "downgrade", "0009_pilot_operations")
            assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 1
                assert conn.execute(text("SELECT password_hash FROM users WHERE id=:id"), {"id": user_id}).scalar_one() == "hash-before"
                columns = set(conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema=:schema AND table_name='users'"), {"schema": schema}).scalars())
                assert "auth_version" not in columns

            final_upgrade = _alembic(schema, "upgrade", "head")
            assert final_upgrade.returncode == 0, final_upgrade.stdout + final_upgrade.stderr
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                assert conn.execute(text("SELECT auth_version FROM users WHERE id=:id"), {"id": user_id}).scalar_one() == 1
        finally:
            engine.dispose()
