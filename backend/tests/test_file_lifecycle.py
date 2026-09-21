from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import select

from app.modules.files.models import FileObject
from app.modules.thesis.models import ThesisVersionFile
from app.modules.user.models import User, Role, UserRoleAssignment, TenantUserMembership
from tests.helpers import auth, login, create_draft, attach_files


async def prepare(client, tokens, thesis_id, purpose='anonymous'):
    return await client.post('/api/v1/files:prepare-upload', headers=auth(tokens), json={
        'thesis_id': thesis_id, 'purpose': purpose, 'filename': purpose + '.pdf',
        'content_type': 'application/pdf',
    })


async def pending(client, tokens, thesis_id):
    response = await prepare(client, tokens, thesis_id)
    assert response.status_code == 200, response.text
    file_id = response.json()['data']['file_id']
    response = await client.put(f'/api/v1/files/{file_id}/content', headers=auth(tokens), content=b'%PDF pending')
    assert response.status_code == 200, response.text
    return file_id


async def submit(client, tokens, thesis):
    response = await client.post(f"/api/v1/theses/{thesis['id']}:submit", headers=auth(tokens), json={'version': thesis['version']})
    assert response.status_code == 200, response.text
    return response.json()['data']


async def withdraw(client, tokens, thesis):
    response = await client.post(f"/api/v1/theses/{thesis['id']}:withdraw", headers=auth(tokens), json={'version': thesis['version'], 'reason': '修改'})
    assert response.status_code == 200, response.text
    return response.json()['data']


async def file_for(db_session, version_id):
    return (await db_session.execute(select(FileObject).join(ThesisVersionFile, ThesisVersionFile.file_id == FileObject.id).where(
        ThesisVersionFile.thesis_version_id == UUID(version_id), ThesisVersionFile.purpose == 'anonymous'
    ))).scalar_one()


@pytest.mark.asyncio
async def test_same_school_other_student_cannot_prepare(client, db_session):
    student = await login(client, 'student.lin')
    thesis = await create_draft(client, student)
    owner = (await db_session.execute(select(User).where(User.username == 'student.lin'))).scalar_one()
    member = (await db_session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == owner.id))).scalar_one()
    other = User(username='same.school.student', password_hash=owner.password_hash, status='ACTIVE')
    db_session.add(other)
    await db_session.flush()
    role = (await db_session.execute(select(Role).where(Role.code == 'student'))).scalar_one()
    db_session.add_all([
        UserRoleAssignment(user_id=other.id, tenant_id=member.tenant_id, role_id=role.id, data_scope={}),
        TenantUserMembership(user_id=other.id, tenant_id=member.tenant_id, organization_id=member.organization_id,
                             membership_type='STUDENT', external_id='same-school-probe', external_source='test'),
    ])
    await db_session.flush()
    tokens = await login(client, 'same.school.student')
    response = await prepare(client, tokens, thesis['id'])
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('submitted', [False, True])
async def test_completed_file_cannot_be_overwritten(client, db_session, submitted):
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    await attach_files(client, tokens, thesis['id'])
    obj = await file_for(db_session, thesis['current_version']['id'])
    original = Path(obj.storage_key).read_bytes()
    if submitted:
        await submit(client, tokens, thesis)
    response = await client.put(f'/api/v1/files/{obj.id}/content', headers=auth(tokens), content=b'replaced')
    assert response.status_code == 409
    assert Path(obj.storage_key).read_bytes() == original


@pytest.mark.asyncio
async def test_pending_old_version_cannot_complete_after_withdraw(client, db_session):
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    await attach_files(client, tokens, thesis['id'])
    file_id = await pending(client, tokens, thesis['id'])
    current = await withdraw(client, tokens, await submit(client, tokens, thesis))
    before = (await file_for(db_session, current['current_version']['id'])).id
    response = await client.post(f'/api/v1/files/{file_id}:complete', headers=auth(tokens))
    assert response.status_code == 409
    assert (await file_for(db_session, current['current_version']['id'])).id == before


@pytest.mark.asyncio
async def test_complete_retry_does_not_restore_replaced_file(client, db_session):
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    old = await pending(client, tokens, thesis['id'])
    assert (await client.post(f'/api/v1/files/{old}:complete', headers=auth(tokens))).status_code == 200
    replacement = await pending(client, tokens, thesis['id'])
    assert (await client.post(f'/api/v1/files/{replacement}:complete', headers=auth(tokens))).status_code == 200
    assert (await client.post(f'/api/v1/files/{old}:complete', headers=auth(tokens))).status_code == 200
    assert str((await file_for(db_session, thesis['current_version']['id'])).id) == replacement


@pytest.mark.asyncio
async def test_complete_rejects_bytes_not_matching_recorded_hash(client, db_session):
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    file_id = await pending(client, tokens, thesis['id'])
    obj = await db_session.get(FileObject, UUID(file_id))
    Path(obj.storage_key).write_bytes(b'%PDF changed outside transaction')
    response = await client.post(f'/api/v1/files/{file_id}:complete', headers=auth(tokens))
    assert response.status_code == 409


def test_failed_atomic_write_preserves_previous_bytes(tmp_path, monkeypatch):
    from app.modules.files import storage
    path = tmp_path / 'pending'
    path.write_bytes(b'previous')
    # Fault injection at rename, after writing the temporary file.
    def fail_replace(*args):
        raise OSError('disk error')
    monkeypatch.setattr('os.replace', fail_replace)
    with pytest.raises(OSError):
        storage.write_bytes(path, b'new')
    assert path.read_bytes() == b'previous'
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.asyncio
async def test_replacement_after_withdraw_preserves_submitted_version(client, db_session):
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    await attach_files(client, tokens, thesis['id'])
    old_version = thesis['current_version']['id']
    old_file = await file_for(db_session, old_version)
    old_id, old_bytes = old_file.id, Path(old_file.storage_key).read_bytes()
    current = await withdraw(client, tokens, await submit(client, tokens, thesis))
    replacement = await pending(client, tokens, thesis['id'])
    response = await client.post(f'/api/v1/files/{replacement}:complete', headers=auth(tokens))
    assert response.status_code == 200
    assert (await file_for(db_session, old_version)).id == old_id
    assert str((await file_for(db_session, current['current_version']['id'])).id) == replacement
    assert Path(old_file.storage_key).read_bytes() == old_bytes
    # A completed file retry must not copy the old file over the replacement.
    assert (await client.post(f'/api/v1/files/{old_id}:complete', headers=auth(tokens))).status_code == 200
    assert str((await file_for(db_session, current['current_version']['id'])).id) == replacement


@pytest.mark.asyncio
async def test_other_tenant_cannot_write_or_complete_upload(client):
    owner = await login(client, 'student.lin')
    other = await login(client, 'other.student')
    thesis = await create_draft(client, owner)
    assert (await prepare(client, other, thesis['id'])).status_code == 404
    file_id = await pending(client, owner, thesis['id'])
    assert (await client.put(f'/api/v1/files/{file_id}/content', headers=auth(other), content=b'other')).status_code == 404
    assert (await client.post(f'/api/v1/files/{file_id}:complete', headers=auth(other))).status_code == 404
