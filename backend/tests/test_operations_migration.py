import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

from tests.conftest import _test_url, migrated_test_schema


def _alembic(schema: str, command: str, revision: str):
    return subprocess.run(
        [sys.executable, "-m", "alembic", command, revision],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": _test_url(), "PGOPTIONS": f"-c search_path={schema}"},
        capture_output=True, text=True,
    )


def test_0009_adds_batch_version_and_list_indexes_then_downgrades():
    with migrated_test_schema("0008_identity_invariants") as schema:
        upgraded = _alembic(schema, "upgrade", "0009_pilot_operations")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
        engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
        try:
            with engine.connect() as conn:
                conn.execute(text(f'SET search_path TO "{schema}"'))
                columns = set(conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema=:s AND table_name='review_batches'"), {"s": schema}).scalars())
                version_default = conn.execute(text("SELECT column_default FROM information_schema.columns WHERE table_schema=:s AND table_name='review_batches' AND column_name='version'"), {"s": schema}).scalar_one()
                indexes = set(conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname=:s"), {"s": schema}).scalars())
            assert "version" in columns
            assert version_default == "1"
            assert {"ix_membership_tenant_type_active", "ix_batch_tenant_status_created"} <= indexes
            downgraded = _alembic(schema, "downgrade", "0008_identity_invariants")
            assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
            with engine.connect() as conn:
                columns = set(conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema=:s AND table_name='review_batches'"), {"s": schema}).scalars())
                indexes = set(conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname=:s"), {"s": schema}).scalars())
            assert "version" not in columns
            assert not ({"ix_membership_tenant_type_active", "ix_batch_tenant_status_created"} & indexes)
        finally:
            engine.dispose()
