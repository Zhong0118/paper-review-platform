import asyncio
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.auth.deps import CurrentUser
from app.modules.thesis import service as theses
from app.modules.thesis.models import Thesis, ThesisVersion, ThesisVersionFile
from app.modules.dispatch import service as dispatch
from app.modules.dispatch.models import ReviewRound, ExpertTask
from app.modules.files.models import FileObject
from app.modules.user.models import User, TenantUserMembership
from tests.test_file_concurrency import independent_sessions, wait_for_db_lock
from tests.helpers import login, auth, create_draft, attach_files, ready_thesis, submit_current_draft
from tests.test_dispatch import expert_id
from tests.test_review import VALID_DRAFT

EDIT = theses.DraftInput(title='更新标题', abstract='更新摘要', discipline_code='0835', discipline_name='软件工程', keywords=['测试'])


def edit_for(draft):
    return theses.DraftEditInput(**EDIT.model_dump(), expected_content_revision=draft["current_version"]["content_revision"])


async def actor(session, username, role):
    uid = (await session.execute(select(User.id).where(User.username == username))).scalar_one()
    membership = (await session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == uid))).scalars().first()
    return CurrentUser(id=uid, role=role, tenant_id=membership.tenant_id if membership else None, data_scope={})


async def draft_with_files(client):
    student = await login(client, 'student.lin', get_settings().seed_password)
    draft = await create_draft(client, student)
    await attach_files(client, student, draft['id'])
    return student, (await client.get("/api/v1/theses/"+draft["id"], headers=auth(student))).json()["data"]


@pytest.mark.asyncio
async def test_stale_patch_cannot_mutate_frozen_version(independent_sessions):
    sessions, client = independent_sessions
    student, draft = await draft_with_files(client)
    async with sessions() as first, sessions() as second:
        await bind_candidate_identity(first, verified_access_claims(student['access_token']))
        await bind_candidate_identity(second, verified_access_claims(student['access_token']))
        user = await actor(first, 'student.lin', 'student')
        stale = await second.get(Thesis, UUID(draft['id']))
        version = await second.get(ThesisVersion, stale.current_version_id)
        await theses.submit(first, user, stale.id, draft['version'], None, draft['current_version']['content_revision'])
        await first.commit()
        with pytest.raises(AppError) as error:
            await theses.patch_draft(second, user, stale.id, edit_for(draft))
        assert error.value.code == 'STATE_TRANSITION_DENIED'
        await second.rollback()
    async with sessions() as session:
        row = await session.get(ThesisVersion, UUID(draft['current_version']['id']))
        assert row.title == draft['current_version']['title']
        assert row.is_editable is False


@pytest.mark.asyncio
async def test_submit_freezes_latest_metadata_after_patch(independent_sessions):
    sessions, client = independent_sessions
    student, draft = await draft_with_files(client)
    async with sessions() as first, sessions() as second:
        await bind_candidate_identity(first, verified_access_claims(student['access_token']))
        await bind_candidate_identity(second, verified_access_claims(student['access_token']))
        user = await actor(first, 'student.lin', 'student')
        stale = await second.get(Thesis, UUID(draft['id']))
        version = await second.get(ThesisVersion, stale.current_version_id)
        await theses.patch_draft(first, user, stale.id, edit_for(draft))
        await first.commit()
        fresh=(await client.get('/api/v1/theses/'+draft['id'],headers=auth(student))).json()['data']
        await theses.submit(second, user, stale.id, draft['version'], None, fresh['current_version']['content_revision'])
        assert version.title == '更新标题'
        assert version.discipline_code == '0835'
        assert not version.is_editable
        await second.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize('with_files', [False, True])
async def test_delete_pristine_draft_preserves_files_and_allows_new_draft(independent_sessions, with_files):
    sessions, client = independent_sessions
    student = await login(client, 'student.lin', get_settings().seed_password)
    draft = await create_draft(client, student)
    if with_files:
        await attach_files(client, student, draft['id'])
    res = await client.delete(f"/api/v1/theses/{draft['id']}", headers=auth(student))
    assert res.status_code == 200, res.text
    assert (await client.get(f"/api/v1/theses/{draft['id']}", headers=auth(student))).status_code == 404
    async with sessions() as session:
        assert (await session.execute(select(ThesisVersion))).scalars().all() == []
        assert (await session.execute(select(ThesisVersionFile))).scalars().all() == []
        files = (await session.execute(select(FileObject))).scalars().all()
        assert len(files) == (2 if with_files else 0)
        for f in files:
            assert f.upload_version_id is None
            assert (await client.put(f'/api/v1/files/{f.id}/content', headers=auth(student), content=b'new')).status_code == 409
    new = await create_draft(client, student)
    assert new['id'] != draft['id']


async def confirmed_round(client):
    student, school, thesis = await ready_thesis(client, SimpleNamespace(password=get_settings().seed_password))
    res = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch", headers=auth(school), json={'version': thesis['version']})
    assert res.status_code == 200, res.text
    return student, school, res.json()['data']


@pytest.mark.asyncio
async def test_withdraw_retires_old_round_and_resubmission_uses_new_version(independent_sessions):
    sessions, client = independent_sessions
    student, school, thesis = await confirmed_round(client)
    tid = thesis['id']
    withdrawn = await client.post(f'/api/v1/theses/{tid}:withdraw', headers=auth(student), json={'version': thesis['version'], 'reason': '修改'})
    assert withdrawn.status_code == 200, withdrawn.text
    draft = withdrawn.json()['data']
    progress = (await client.get('/api/v1/school-review/progress', headers=auth(school))).json()['data']
    assert progress['items'] == []
    assert progress['totals']['waiting'] == 0
    assert draft['current_version']['id'] != thesis['current_version']['id']
    assert (await client.delete(f'/api/v1/theses/{tid}', headers=auth(student))).status_code == 409
    platform = await login(client, 'platform.chen', get_settings().seed_password)
    eid = await expert_id(client, platform, tid, 'zhou')
    async with sessions() as session:
        old = await session.get(ReviewRound, UUID(thesis['round']['id']))
        assert old.status == 'CANCELLED'
        assert old.thesis_version_id == UUID(thesis['current_version']['id'])
        assert (await session.get(ThesisVersion, old.thesis_version_id)).is_editable is False
    submitted = await submit_current_draft(client, f'/api/v1/theses/{tid}:submit', headers=auth(student), json={'version': draft['version']})
    assert submitted.status_code == 200, submitted.text
    ready = await client.post(f'/api/v1/school-review/theses/{tid}:confirm-anonymization', headers=auth(school), json={'version': submitted.json()['data']['version'], 'decision': 'PASS'})
    assert ready.status_code == 200, ready.text
    premature = await client.post(f'/api/v1/platform-review/theses/{tid}:assign', headers=auth(platform), json={'expert_id': eid})
    assert premature.status_code == 409, premature.text
    confirmed = await client.post(f'/api/v1/school-review/theses/{tid}:confirm-dispatch', headers=auth(school), json={'version': ready.json()['data']['version']})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()['data']['round']['round_no'] == 2
    assigned = await client.post(f'/api/v1/platform-review/theses/{tid}:assign', headers=auth(platform), json={'expert_id': eid})
    assert assigned.status_code == 200, assigned.text
    task = assigned.json()['data']['task']['id']
    expert = await login(client, 'expert.zhou', get_settings().seed_password)
    assert (await client.post(f'/api/v1/expert/tasks/{task}:accept', headers=auth(expert))).status_code == 200
    assert (await client.post(f'/api/v1/expert/tasks/{task}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 200
    results = await client.get(f'/api/v1/school-review/theses/{tid}/results', headers=auth(school))
    assert results.status_code == 200, results.text
    assert results.json()['data']['items'][0]['total'] == 80
    progress = (await client.get('/api/v1/school-review/progress', headers=auth(school))).json()['data']
    assert len(progress['items']) == 1
    assert progress['totals']['completed'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('winner', ['submit', 'delete', 'patch'])
async def test_thesis_writes_serialize_on_same_row(independent_sessions, winner):
    sessions, client = independent_sessions
    student, draft = await draft_with_files(client)
    async with sessions() as first, sessions() as second:
        await bind_candidate_identity(first, verified_access_claims(student['access_token']))
        await bind_candidate_identity(second, verified_access_claims(student['access_token']))
        user = await actor(first, 'student.lin', 'student')
        stale = await second.get(Thesis, UUID(draft['id']))
        version = await second.get(ThesisVersion, stale.current_version_id)
        tid = stale.id
        pid = (await second.execute(text('SELECT pg_backend_pid()'))).scalar_one()
        if winner == 'submit':
            await theses.submit(first, user, tid, draft['version'], None, draft['current_version']['content_revision'])
            operation = theses.delete_draft(second, user, tid)
        elif winner == 'delete':
            await theses.delete_draft(first, user, tid)
            operation = theses.submit(second, user, tid, draft['version'], None, draft['current_version']['content_revision'])
        else:
            saved = await theses.patch_draft(first, user, tid, edit_for(draft))
            fresh = await theses.serialize_thesis(first, user, saved)
            operation = theses.submit(second, user, tid, draft['version'], None, fresh['current_version']['content_revision'])
        pending = asyncio.create_task(operation)
        try:
            await wait_for_db_lock(sessions, pid)
            await first.commit()
            if winner == 'patch':
                result = await asyncio.wait_for(pending, 5)
                assert result.stage == 'PREPARING'
                assert version.title == '更新标题'
                await second.commit()
            else:
                with pytest.raises(AppError) as error:
                    await asyncio.wait_for(pending, 5)
                assert error.value.code == ('RESOURCE_NOT_FOUND' if winner == 'delete' else 'STATE_TRANSITION_DENIED')
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            await first.rollback()
            await second.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize('winner', ['assign', 'withdraw'])
async def test_first_assignment_and_withdraw_cannot_both_succeed(independent_sessions, winner):
    sessions, client = independent_sessions
    _, _, draft = await confirmed_round(client)
    platform = await login(client, 'platform.chen', get_settings().seed_password)
    eid = UUID(await expert_id(client, platform, draft['id'], 'zhou'))
    async with sessions() as first, sessions() as second:
        student = await actor(first, 'student.lin', 'student')
        admin = await actor(first, 'platform.chen', 'platform_reviewer')
        stale = await second.get(Thesis, UUID(draft['id']))
        tid = stale.id
        pid = (await second.execute(text('SELECT pg_backend_pid()'))).scalar_one()
        if winner == 'assign':
            await dispatch.assign(first, admin, tid, eid, None)
            operation = theses.withdraw(second, student, tid, draft['version'], '修改')
        else:
            await theses.withdraw(first, student, tid, draft['version'], '修改')
            operation = dispatch.assign(second, admin, tid, eid, None)
        pending = asyncio.create_task(operation)
        try:
            await wait_for_db_lock(sessions, pid)
            await first.commit()
            with pytest.raises(AppError) as error:
                await asyncio.wait_for(pending, 5)
            assert error.value.code in {'STATE_TRANSITION_DENIED', 'VERSION_CONFLICT'}
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            await first.rollback()
            await second.rollback()
    async with sessions() as session:
        thesis = await session.get(Thesis, tid)
        tasks = (await session.execute(select(ExpertTask))).scalars().all()
        assert thesis.stage == ('UNDER_REVIEW' if winner == 'assign' else 'DRAFT')
        assert len(tasks) == (1 if winner == 'assign' else 0)


@pytest.mark.asyncio
async def test_delayed_school_confirmation_rechecks_withdrawn_thesis(independent_sessions):
    sessions, client = independent_sessions
    _, _, draft = await ready_thesis(client, SimpleNamespace(password=get_settings().seed_password))
    async with sessions() as first, sessions() as second:
        student = await actor(first, 'student.lin', 'student')
        school = await actor(first, 'school.wang', 'school_reviewer')
        stale = await second.get(Thesis, UUID(draft['id']))
        await theses.withdraw(first, student, stale.id, draft['version'], '修改')
        await first.commit()
        with pytest.raises(AppError) as error:
            await dispatch.confirm_dispatch(second, school, stale, draft['version'], None)
        assert error.value.code == 'STATE_TRANSITION_DENIED'
        await second.rollback()
    async with sessions() as session:
        assert (await session.execute(select(ReviewRound))).scalars().all() == []


@pytest.mark.asyncio
async def test_foreign_student_cannot_modify_or_delete_draft(independent_sessions):
    sessions, client = independent_sessions
    _, draft = await draft_with_files(client)
    other = await login(client, 'other.student', get_settings().seed_password)
    url = f"/api/v1/theses/{draft['id']}"
    assert (await client.patch(url, headers=auth(other), json=edit_for(draft).model_dump())).status_code == 404
    assert (await client.delete(url, headers=auth(other))).status_code == 404
    async with sessions() as session:
        assert (await session.get(Thesis, UUID(draft['id']))).stage == 'DRAFT'
