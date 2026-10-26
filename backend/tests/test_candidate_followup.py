"""Regression coverage for the candidate follow-up review."""
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from scripts.acceptance_server import acceptance_environment
from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources
from tests.conftest import _test_url
from tests.helpers import auth, login


def owner_engine(schema):
    url = make_url(_test_url())
    assert url.host in {'127.0.0.1', 'localhost'} and url.port == 5433
    assert url.database == 'paper_review_test'
    return create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                         connect_args={'options': f'-c search_path={schema}'})


@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["incoming", "outgoing"])
@pytest.mark.parametrize("phase", ["backup", "after_backup"])
async def test_backup_rejects_dependency_from_another_schema(direction, phase):
    async with acceptance_environment('empty') as runtime:
        owned = OwnedResources.capture(runtime)
        external = 'review_probe_' + uuid4().hex
        engine = owner_engine(runtime.schema)
        external_oid = None
        archive = tempfile.TemporaryDirectory(prefix='paper-review-late-dependency-')
        try:
            manifest = backup_owned_resources(owned, Path(archive.name)) if phase == 'after_backup' else None
            with engine.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA "{external}"'))
                external_oid = conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': external})
                if direction == 'incoming':
                    conn.execute(text(f'CREATE VIEW "{external}".dependent_view AS SELECT id FROM "{runtime.schema}".theses'))
                else:
                    conn.execute(text(f'CREATE TABLE "{external}".outside_table (id integer)'))
                    conn.execute(text(f'CREATE VIEW "{runtime.schema}".dependent_view AS SELECT id FROM "{external}".outside_table'))
            with pytest.raises(ValueError, match='depend|external'):
                owned.assert_cleanup_stage('schema')
            if phase == 'backup':
                with pytest.raises(ValueError, match='depend|external'):
                    backup_owned_resources(owned, Path(archive.name))
            else:
                await runtime.engine.dispose()
                await runtime.auth_engine.dispose()
                with pytest.raises(ValueError, match='depend|external'):
                    restore_owned_resources(owned, manifest, Path(archive.name))
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': runtime.schema}) == owned.schema_oid
                view_schema = external if direction == 'incoming' else runtime.schema
                assert conn.scalar(text('SELECT to_regclass(:name)'), {'name': f'{view_schema}.dependent_view'}) is not None
        finally:
            if external_oid is not None:
                with engine.begin() as conn:
                    assert conn.scalar(text('SELECT oid FROM pg_namespace WHERE nspname=:n'), {'n': external}) == external_oid
                    if direction == 'incoming':
                        conn.execute(text(f'DROP VIEW "{external}".dependent_view'))
                    else:
                        conn.execute(text(f'DROP VIEW "{runtime.schema}".dependent_view'))
                        conn.execute(text(f'DROP TABLE "{external}".outside_table'))
                    conn.execute(text(f'DROP SCHEMA "{external}"'))
            engine.dispose()
            archive.cleanup()


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
                assert details == [
                    {'version': 2, 'conflicts': {'SUPERVISOR_NAME': {'before': 0, 'after': 1, 'added': 1, 'removed': 0},
                                               'TENANT_ID': {'before': 0, 'after': 0, 'added': 0, 'removed': 0}}},
                    {'version': 3, 'conflicts': {'SUPERVISOR_NAME': {'before': 1, 'after': 0, 'added': 0, 'removed': 1},
                                               'TENANT_ID': {'before': 0, 'after': 0, 'added': 0, 'removed': 0}}},
                ]
        finally:
            engine.dispose()


@pytest.mark.asyncio
async def test_audit_summaries_deduplicate_replacement_and_ignore_failed_commands():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://review') as client:
            actor = await login(client, 'platform.chen', runtime.seed_password)
            expert = (await client.get('/api/v1/platform-review/experts', headers=auth(actor))).json()['data'][0]
            url = f"/api/v1/platform-review/experts/{expert['id']}"
            version = expert['version']
            for names in (['私密甲', '私密甲'], ['私密乙'], ['私密乙']):
                response = await client.put(url+'/conflicts', headers=auth(actor), json={
                    'version': version, 'items': [{'kind': 'SUPERVISOR_NAME', 'value': n} for n in names]})
                assert response.status_code == 200
                version = response.json()['data']['version']
            assert (await client.put(url+'/conflicts', headers=auth(actor), json={
                'version': version-1, 'items': []})).status_code == 409
            assert (await client.put(url+'/conflicts', headers=auth(actor), json={
                'version': version, 'items': [{'kind': 'TENANT_ID', 'value': str(uuid4())}]})).status_code == 422
            for action, status in ((':review-qualification', 'REJECTED'), (':set-service-status', 'UNAVAILABLE')):
                response = await client.post(url+action, headers=auth(actor), json={
                    'version': version, 'status': status, 'reason': '私密理由不写审计'})
                assert response.status_code == 200
                version = response.json()['data']['version']
            response = await client.patch(url, headers=auth(actor), json={
                'version': version, 'unit': '私密单位', 'title': expert['title'], 'discipline_codes': expert['discipline_codes']})
            assert response.status_code == 200
        engine = owner_engine(runtime.schema)
        try:
            with engine.connect() as conn:
                rows = conn.execute(text("SELECT action,detail FROM audit_events WHERE object_id=:id AND action LIKE 'expert.%' ORDER BY created_at"), {'id': expert['id']}).all()
                assert len(rows) == 6
                assert rows[0].detail['conflicts']['SUPERVISOR_NAME'] == {'before': 0, 'after': 1, 'added': 1, 'removed': 0}
                assert rows[1].detail['conflicts']['SUPERVISOR_NAME'] == {'before': 1, 'after': 1, 'added': 1, 'removed': 1}
                assert rows[2].detail['conflicts']['SUPERVISOR_NAME'] == {'before': 1, 'after': 1, 'added': 0, 'removed': 0}
                assert rows[3].detail == {'version': 5, 'before': 'APPROVED', 'after': 'REJECTED', 'reason_provided': True}
                assert rows[4].detail == {'version': 6, 'before': 'AVAILABLE', 'after': 'UNAVAILABLE', 'reason_provided': True}
                assert rows[5].detail == {'version': 7, 'changed_fields': ['unit']}
                assert '私密' not in str(rows)
                assert conn.scalar(text('SELECT count(*) FROM expert_conflicts WHERE expert_id=:id'), {'id': expert['id']}) == 1
        finally:
            engine.dispose()


@pytest.mark.asyncio
async def test_audit_failure_rolls_back_conflicts_version_and_event(monkeypatch):
    from app.modules.audit import service as audit
    from app.core.exceptions import AppError

    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://review') as client:
            actor = await login(client, 'platform.chen', runtime.seed_password)
            expert = (await client.get('/api/v1/platform-review/experts', headers=auth(actor))).json()['data'][0]
            original = audit.record

            async def fail_after_record(session, **kwargs):
                await original(session, **kwargs)
                if kwargs['action'] == 'expert.conflicts':
                    await session.flush()
                    raise AppError('VALIDATION_FAILED', 422, 'injected audit transaction failure')

            monkeypatch.setattr(audit, 'record', fail_after_record)
            response = await client.put(f"/api/v1/platform-review/experts/{expert['id']}/conflicts",
                                        headers=auth(actor), json={'version': expert['version'], 'items': [
                                            {'kind': 'SUPERVISOR_NAME', 'value': '未提交虚构导师'}]})
            assert response.status_code == 422
            current = (await client.get('/api/v1/platform-review/experts', headers=auth(actor))).json()['data']
            assert next(row for row in current if row['id'] == expert['id']) == expert
        engine = owner_engine(runtime.schema)
        try:
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM audit_events WHERE action='expert.conflicts' AND object_id=:id"), {'id': expert['id']}) == 0
        finally:
            engine.dispose()
