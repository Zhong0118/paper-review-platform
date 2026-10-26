"""Manual review probes; not part of the normal suite. Expected failures document gaps."""
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from scripts.acceptance_server import acceptance_environment
from scripts.recovery_drill import OwnedResources, backup_owned_resources
from tests.conftest import _test_url
from tests.helpers import auth, login


def owner_engine(schema):
    url = make_url(_test_url())
    assert url.host in {'127.0.0.1', 'localhost'} and url.port == 5433
    assert url.database == 'paper_review_test'
    return create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                         connect_args={'options': f'-c search_path={schema}'})


@pytest.mark.asyncio
async def test_backup_rejects_dependency_from_another_schema():
    async with acceptance_environment('empty') as runtime:
        owned = OwnedResources.capture(runtime)
        external = 'review_probe_' + uuid4().hex
        engine = owner_engine(runtime.schema)
        external_oid = None
        try:
            with engine.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA "{external}"'))
                external_oid = conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': external})
                conn.execute(text(f'CREATE VIEW "{external}".dependent_view AS SELECT id FROM "{runtime.schema}".theses'))
            with tempfile.TemporaryDirectory(prefix='paper-review-audit-bundle-') as directory:
                with pytest.raises(ValueError, match='depend|external'):
                    backup_owned_resources(owned, Path(directory))
        finally:
            if external_oid is not None:
                with engine.begin() as conn:
                    assert conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': external}) == external_oid
                    conn.execute(text(f'DROP VIEW "{external}".dependent_view'))
                    conn.execute(text(f'DROP SCHEMA "{external}"'))
            engine.dispose()


@pytest.mark.asyncio
async def test_cleanup_guard_rejects_changed_schema_owner():
    async with acceptance_environment('empty') as runtime:
        owned = OwnedResources.capture(runtime)
        engine = owner_engine(runtime.schema)
        try:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER SCHEMA "{runtime.schema}" OWNER TO CURRENT_USER'))
            with pytest.raises(ValueError, match='ownership|owner'):
                owned.assert_cleanup_stage('schema')
        finally:
            with engine.begin() as conn:
                assert conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': runtime.schema}) == owned.schema_oid
                conn.execute(text(f'ALTER SCHEMA "{runtime.schema}" OWNER TO "{owned.owner_role}"'))
            engine.dispose()


@pytest.mark.asyncio
async def test_expert_conflict_audit_preserves_change_evidence():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://review') as client:
            actor = await login(client, 'platform.chen', runtime.seed_password)
            experts = (await client.get('/api/v1/platform-review/experts', headers=auth(actor))).json()['data']
            expert = experts[0]
            url = f"/api/v1/platform-review/experts/{expert['id']}/conflicts"
            first = await client.put(url, headers=auth(actor), json={
                'version': expert['version'],
                'items': [{'kind': 'SUPERVISOR_NAME', 'value': '虚构审查导师'}],
            })
            assert first.status_code == 200
            second = await client.put(url, headers=auth(actor), json={
                'version': first.json()['data']['version'], 'items': [],
            })
            assert second.status_code == 200
        engine = owner_engine(runtime.schema)
        try:
            with engine.connect() as conn:
                details = conn.execute(text("SELECT detail FROM audit_events WHERE action='expert.conflicts' AND object_id=:id ORDER BY created_at"), {'id': expert['id']}).scalars().all()
                assert len(details) == 2
                assert all(set(detail) - {'version'} for detail in details), details
        finally:
            engine.dispose()
