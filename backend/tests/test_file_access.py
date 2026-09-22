from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse, parse_qs
from uuid import UUID

import jwt
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_access_token
from app.modules.audit.models import AuditEvent
from app.modules.files.models import FileObject
from app.modules.user.models import User
from tests.test_file_concurrency import independent_sessions
from tests.helpers import login, auth, ready_thesis
from tests.test_dispatch import expert_id
from tests.test_review import VALID_DRAFT


async def material(client, reuse=False):
    student, school, thesis = await ready_thesis(client, SimpleNamespace(password=get_settings().seed_password))
    tid = thesis['id']
    if reuse:
        res = await client.post(f'/api/v1/theses/{tid}:withdraw', headers=auth(student), json={'version': thesis['version']})
        draft = res.json()['data']
        res = await client.post(f'/api/v1/theses/{tid}:submit', headers=auth(student), json={'version': draft['version']})
        res = await client.post(f'/api/v1/school-review/theses/{tid}:confirm-anonymization', headers=auth(school), json={'version': res.json()['data']['version'], 'decision': 'PASS'})
        assert res.status_code == 200, res.text
        thesis = res.json()['data']
    assert (await client.post(f'/api/v1/school-review/theses/{tid}:confirm-dispatch', headers=auth(school), json={'version': thesis['version']})).status_code == 200
    platform = await login(client, 'platform.chen', get_settings().seed_password)
    eid = await expert_id(client, platform, tid, 'zhou')
    res = await client.post(f'/api/v1/platform-review/theses/{tid}:assign', headers=auth(platform), json={'expert_id': eid})
    task = res.json()['data']['task']['id']
    expert = await login(client, 'expert.zhou', get_settings().seed_password)
    assert (await client.post(f'/api/v1/expert/tasks/{task}:accept', headers=auth(expert))).status_code == 200
    files = (await client.get(f'/api/v1/expert/tasks/{task}/materials', headers=auth(expert))).json()['data']['files']
    return student, expert, task, files[0]['file_id']


async def grant(client, user, fid):
    res = await client.post(f'/api/v1/files/{fid}:authorize-download', headers=auth(user))
    assert res.status_code == 200, res.text
    data = res.json()['data']
    token = parse_qs(urlparse(data['url']).query)['token'][0]
    return data, token


@pytest.mark.asyncio
@pytest.mark.parametrize('reuse', [False, True])
async def test_download_link_and_api_read_match(independent_sessions, reuse):
    _, client = independent_sessions
    _, expert, _, fid = await material(client, reuse)
    data, _ = await grant(client, expert, fid)
    link = await client.get(data['url'])
    direct = await client.get(f'/api/v1/files/{fid}/content', headers=auth(expert))
    assert link.status_code == direct.status_code == 200
    assert link.content == direct.content and link.content.startswith(b'%PDF')
    assert link.headers['cache-control'] == 'no-store'


@pytest.mark.asyncio
async def test_file_token_cannot_authenticate_general_apis(independent_sessions):
    _, client = independent_sessions
    _, expert, _, fid = await material(client)
    data, token = await grant(client, expert, fid)
    payload = jwt.decode(token, options={'verify_signature': False})
    assert payload['exp'] == int(datetime.fromisoformat(data['expires_at']).timestamp())
    assert payload['exp'] - payload['iat'] == 300
    for method, url in [('get', '/api/v1/me'), ('put', f'/api/v1/files/{fid}/content')]:
        assert (await getattr(client, method)(url, headers={'Authorization': 'Bearer '+token})).status_code == 401


@pytest.mark.asyncio
async def test_invalid_query_tokens_fail_and_are_audited(independent_sessions):
    sessions, client = independent_sessions
    student, expert, _, fid = await material(client)
    _, token = await grant(client, expert, fid)
    payload = jwt.decode(token, options={'verify_signature': False})
    expired = jwt.encode({**payload, 'exp': 1}, get_settings().jwt_secret, algorithm='HS256')
    wrong_file = jwt.encode({**payload, 'file_id': '00000000-0000-0000-0000-000000000000'}, get_settings().jwt_secret, algorithm='HS256')
    wrong_signature = jwt.encode(payload, 'incorrect-signing-key-for-test-only-12345', algorithm='HS256')
    for invalid in [expired, wrong_file, wrong_signature, 'invalid', student['access_token']]:
        res = await client.get(f'/api/v1/files/{fid}/content', params={'token': invalid}, headers=auth(expert))
        assert res.status_code in (401, 404), res.text
    async with sessions() as session:
        events = (await session.execute(select(AuditEvent).where(AuditEvent.action == 'file_read', AuditEvent.result == 'DENIED'))).scalars().all()
        assert len(events) == 5
        assert all(event.request_id for event in events)


@pytest.mark.asyncio
@pytest.mark.parametrize('revoke', ['submit', 'disable'])
async def test_download_rechecks_permission(independent_sessions, revoke):
    sessions, client = independent_sessions
    _, expert, task, fid = await material(client)
    data, _ = await grant(client, expert, fid)
    assert (await client.get(data['url'])).status_code == 200
    if revoke == 'submit':
        assert (await client.post(f'/api/v1/expert/tasks/{task}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 200
    else:
        async with sessions() as session:
            user = (await session.execute(select(User).where(User.username == 'expert.zhou'))).scalar_one()
            user.status = 'DISABLED'
            await session.commit()
    assert (await client.get(data['url'])).status_code in (401, 404)


@pytest.mark.asyncio
async def test_success_and_denial_audit_and_missing_bytes(independent_sessions):
    sessions, client = independent_sessions
    _, expert, _, fid = await material(client)
    data, _ = await grant(client, expert, fid)
    assert (await client.get(data['url'])).status_code == 200
    other = await login(client, 'expert.qian', get_settings().seed_password)
    assert (await client.post(f'/api/v1/files/{fid}:authorize-download', headers=auth(other))).status_code == 404
    async with sessions() as session:
        obj = await session.get(FileObject, UUID(fid))
        Path(obj.storage_key).unlink()
    res = await client.get(f'/api/v1/files/{fid}/content', headers=auth(expert))
    assert res.status_code == 404
    async with sessions() as session:
        events = (await session.execute(select(AuditEvent).where(AuditEvent.object_id == fid))).scalars().all()
        assert {(e.action, e.result) for e in events} >= {('file_authorize', 'SUCCESS'), ('file_authorize', 'DENIED'), ('file_read', 'SUCCESS'), ('file_read', 'DENIED')}


@pytest.mark.asyncio
async def test_legacy_download_token_not_a_login(independent_sessions):
    sessions, client = independent_sessions
    async with sessions() as session:
        user = (await session.execute(select(User).where(User.username == 'expert.zhou'))).scalar_one()
        legacy = create_access_token(user_id=user.id, role='expert', tenant_id=None, data_scope={'purpose':'download','file_id':'old'})
    assert (await client.get('/api/v1/me', headers={'Authorization':'Bearer '+legacy})).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['INVITED', 'CANCELLED'])
async def test_inactive_task_cannot_use_existing_grant(independent_sessions, status):
    from app.modules.dispatch.models import ExpertTask
    sessions, client = independent_sessions
    _, expert, task, fid = await material(client)
    data, _ = await grant(client, expert, fid)
    async with sessions() as session:
        row = await session.get(ExpertTask, UUID(task))
        row.status = status
        await session.commit()
    assert (await client.get(data['url'])).status_code == 404
    assert (await client.get(f'/api/v1/files/{fid}/content', headers=auth(expert))).status_code == 404
    assert (await client.post(f'/api/v1/files/{fid}:authorize-download', headers=auth(expert))).status_code == 404


@pytest.mark.asyncio
async def test_original_hidden_from_expert_and_admin(independent_sessions):
    _, client = independent_sessions
    student, expert, _, _ = await material(client)
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    original = next(f['file_id'] for f in thesis['current_version']['files'] if f['purpose'] == 'original')
    admin = await login(client, 'admin.system', get_settings().seed_password)
    for user in [expert, admin]:
        assert (await client.get(f'/api/v1/files/{original}/content', headers=auth(user))).status_code == 404
        assert (await client.post(f'/api/v1/files/{original}:authorize-download', headers=auth(user))).status_code == 404


@pytest.mark.asyncio
async def test_incomplete_file_is_not_readable(independent_sessions):
    sessions, client = independent_sessions
    student, _, _, fid = await material(client)
    async with sessions() as session:
        obj = await session.get(FileObject, UUID(fid))
        obj.completed_at = None
        await session.commit()
    assert (await client.get(f'/api/v1/files/{fid}/content', headers=auth(student))).status_code == 404
    assert (await client.post(f'/api/v1/files/{fid}:authorize-download', headers=auth(student))).status_code == 404


@pytest.mark.asyncio
async def test_authorize_auth_failures_are_audited(independent_sessions):
    sessions, client = independent_sessions
    _, expert, _, fid = await material(client)
    payload = jwt.decode(expert['access_token'], options={'verify_signature': False})
    expired = jwt.encode({**payload, 'exp': 1}, get_settings().jwt_secret, algorithm='HS256')
    for headers in [{}, {'Authorization': 'Bearer invalid'}, {'Authorization': 'Bearer '+expired}]:
        assert (await client.post(f'/api/v1/files/{fid}:authorize-download', headers=headers)).status_code == 401
    async with sessions() as session:
        user = (await session.execute(select(User).where(User.username == 'expert.zhou'))).scalar_one()
        user.status = 'DISABLED'
        await session.commit()
    assert (await client.post(f'/api/v1/files/{fid}:authorize-download', headers=auth(expert))).status_code == 401
    async with sessions() as session:
        events = (await session.execute(select(AuditEvent).where(AuditEvent.action == 'file_authorize', AuditEvent.result == 'DENIED', AuditEvent.object_id == fid))).scalars().all()
        assert len(events) == 4
        assert all(event.actor_id is None and event.request_id for event in events)
