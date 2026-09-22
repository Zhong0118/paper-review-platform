import asyncio
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.expert.models import Expert
from app.modules.user.models import User
from tests.helpers import accepted_task, auth, login, published_thesis
from tests.test_review import VALID_DRAFT
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.modules.thesis import service as theses
from app.modules.review import service as reviews
from tests.test_file_concurrency import independent_sessions
from tests.test_thesis_integrity import actor


async def context(client, seed, db_session):
    expert, student, tid = await accepted_task(client, seed)
    school = await login(client, 'school.wang', seed.password)
    platform = await login(client, 'platform.chen', seed.password)
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    qian = (await db_session.execute(select(Expert).join(User, User.id == Expert.user_id).where(User.username == 'expert.qian'))).scalar_one()
    return expert, student, school, platform, thesis, tid, qian


@pytest.mark.asyncio
async def test_terminate_cancels_active_work_and_replays(client, seed, db_session):
    expert, student, school, _, thesis, tid, _ = await context(client, seed, db_session)
    path = f"/api/v1/school-review/theses/{thesis['id']}:terminate"
    body = {'version': thesis['version'], 'reason': '学校撤销本次送审'}
    response = await client.post(path, headers=auth(school, idempotency='terminate-1'), json=body)
    assert response.status_code == 200, response.text
    assert response.json()['data']['stage'] == 'TERMINATED'
    assert response.json()['data']['allowed_actions'] == []
    assert (await client.post(path, headers=auth(school, idempotency='terminate-1'), json=body)).json()['data'] == response.json()['data']
    assert (await client.post(path, headers=auth(school, idempotency='terminate-1'), json={**body, 'reason': '更改原因'})).status_code == 409
    task = await db_session.get(ExpertTask, UUID(tid), populate_existing=True)
    assert task.status == 'CANCELLED'
    assert (await db_session.get(ReviewRound, task.round_id, populate_existing=True)).status == 'CANCELLED'
    assert (await client.get(f'/api/v1/expert/tasks/{tid}/materials', headers=auth(expert))).status_code == 404
    assert (await client.post(f'/api/v1/expert/tasks/{tid}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 409
    assert (await client.post(path, headers=auth(student), json=body)).status_code == 403


@pytest.mark.asyncio
async def test_terminate_rejects_empty_reason_and_stale_version(client, seed, db_session):
    _, _, school, _, thesis, tid, _ = await context(client, seed, db_session)
    path = f"/api/v1/school-review/theses/{thesis['id']}:terminate"
    assert (await client.post(path, headers=auth(school), json={'version': thesis['version'], 'reason': '  '})).status_code == 422
    assert (await client.post(path, headers=auth(school), json={'version': 0, 'reason': '终止'})).status_code == 409
    assert (await db_session.get(ExpertTask, UUID(tid), populate_existing=True)).status == 'IN_REVIEW'


@pytest.mark.asyncio
async def test_reassign_is_atomic_and_preserves_old_task(client, seed, db_session):
    expert, _, school, platform, thesis, tid, qian = await context(client, seed, db_session)
    path = f'/api/v1/expert-tasks/{tid}:reassign'
    body = {'expert_id': str(qian.id)}
    rejected = await client.post(path, headers=auth(platform), json=body)
    assert rejected.status_code == 409, rejected.text
    assert (await db_session.get(ExpertTask, UUID(tid), populate_existing=True)).status == 'IN_REVIEW'
    qian.discipline_codes = ['0812']
    await db_session.flush()
    response = await client.post(path, headers=auth(platform, idempotency='reassign-1'), json=body)
    assert response.status_code == 200, response.text
    new = response.json()['data']['task']
    assert new['status'] == 'INVITED' and new['replaces_task_id'] == tid
    assert (await db_session.get(ExpertTask, UUID(tid), populate_existing=True)).status == 'CANCELLED'
    assert (await client.post(path, headers=auth(platform, idempotency='reassign-1'), json=body)).json()['data'] == response.json()['data']
    assert (await client.post(path, headers=auth(platform), json=body)).status_code == 409
    assert (await client.get(f'/api/v1/expert/tasks/{tid}/materials', headers=auth(expert))).status_code == 404
    assert (await client.post(f'/api/v1/expert/tasks/{tid}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 409
    assert (await client.post(path, headers=auth(school), json=body)).status_code == 403


@pytest.mark.asyncio
async def test_formal_result_cannot_be_reassigned_or_published_thesis_terminated(client, seed, db_session):
    student, school, thesis_id = await published_thesis(client, seed)
    platform = await login(client, 'platform.chen', seed.password)
    task = (await db_session.execute(select(ExpertTask))).scalar_one()
    response = await client.post(f'/api/v1/expert-tasks/{task.id}:reassign', headers=auth(platform), json={'expert_id': str(task.expert_id)})
    assert response.status_code == 409, response.text
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    response = await client.post(f'/api/v1/school-review/theses/{thesis_id}:terminate', headers=auth(school), json={'version': thesis['version'], 'reason': '终止'})
    assert response.status_code == 409
    assert (await db_session.get(ExpertTask, task.id, populate_existing=True)).status == 'SUBMITTED'




@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['terminate', 'reassign'])
@pytest.mark.parametrize('operation', ['draft', 'final'])
async def test_delayed_expert_cannot_write_after_cancellation(independent_sessions, command, operation):
    sessions, client = independent_sessions
    async with sessions() as setup_session:
        expert, student, school, platform, thesis, tid, qian = await context(client, SimpleNamespace(password=get_settings().seed_password), setup_session)
        qian.discipline_codes = ['0812']
        await setup_session.commit()
        replacement = str(qian.id)
    async with sessions() as delayed:
        stale = await delayed.get(ExpertTask, UUID(tid))
        user = await actor(delayed, 'expert.zhou', 'expert')
        if command == 'terminate':
            response = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:terminate", headers=auth(school), json={'version': thesis['version'], 'reason': '终止'})
        else:
            response = await client.post(f'/api/v1/expert-tasks/{tid}:reassign', headers=auth(platform), json={'expert_id': replacement})
        assert response.status_code == 200, response.text
        with pytest.raises(AppError) as error:
            action = reviews.save_draft if operation == 'draft' else reviews.submit_final
            await action(delayed, user, stale.id, reviews.ReviewPayload(**VALID_DRAFT))
        assert error.value.code == 'STATE_TRANSITION_DENIED'
        await delayed.rollback()


@pytest.mark.asyncio
async def test_concurrent_reassign_creates_only_one_replacement(independent_sessions):
    sessions, client = independent_sessions
    async with sessions() as session:
        _, _, _, platform, _, tid, qian = await context(client, SimpleNamespace(password=get_settings().seed_password), session)
        qian.discipline_codes = ['0812']
        await session.commit()
        replacement = str(qian.id)
    responses = await asyncio.gather(*[
        client.post(f'/api/v1/expert-tasks/{tid}:reassign', headers=auth(platform, idempotency=f'replace-{i}'), json={'expert_id': replacement})
        for i in range(2)
    ])
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with sessions() as session:
        tasks = list((await session.execute(select(ExpertTask))).scalars())
        assert sorted(task.status for task in tasks) == ['CANCELLED', 'INVITED']


@pytest.mark.asyncio
async def test_other_tenant_cannot_terminate(client, seed, db_session):
    _, _, _, _, thesis, tid, _ = await context(client, seed, db_session)
    school = await actor(db_session, 'school.wang', 'school_reviewer')
    from dataclasses import replace
    other_school = replace(school, tenant_id=uuid4())
    with pytest.raises(AppError) as error:
        await theses.terminate(db_session, other_school, UUID(thesis['id']), thesis['version'], '终止', None)
    assert error.value.code == 'RESOURCE_NOT_FOUND'
    assert (await db_session.get(ExpertTask, UUID(tid), populate_existing=True)).status == 'IN_REVIEW'


@pytest.mark.asyncio
@pytest.mark.parametrize('command', ['terminate', 'reassign'])
async def test_same_key_concurrent_retry_replays_success(independent_sessions, command):
    sessions, client = independent_sessions
    async with sessions() as session:
        _, _, school, platform, thesis, tid, qian = await context(client, SimpleNamespace(password=get_settings().seed_password), session)
        qian.discipline_codes = ['0812']
        await session.commit()
        replacement = str(qian.id)
    if command == 'terminate':
        path, tokens, body = f"/api/v1/school-review/theses/{thesis['id']}:terminate", school, {'version': thesis['version'], 'reason': '终止'}
    else:
        path, tokens, body = f'/api/v1/expert-tasks/{tid}:reassign', platform, {'expert_id': replacement}
    responses = await asyncio.gather(*[client.post(path, headers=auth(tokens, idempotency='same-command'), json=body) for _ in range(2)])
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()['data'] == responses[1].json()['data']


@pytest.mark.asyncio
async def test_terminate_result_processing_preserves_formal_result(client, seed, db_session):
    from app.modules.review.models import ReviewResultVersion
    expert, student, school, _, thesis, tid, _ = await context(client, seed, db_session)
    assert (await client.post(f'/api/v1/expert/tasks/{tid}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 200
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    response = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:terminate", headers=auth(school), json={'version': thesis['version'], 'reason': '终止'})
    assert response.status_code == 200, response.text
    task = await db_session.get(ExpertTask, UUID(tid), populate_existing=True)
    assert task.status == 'SUBMITTED'
    assert (await db_session.get(ReviewRound, task.round_id, populate_existing=True)).status == 'CANCELLED'
    result = (await db_session.execute(select(ReviewResultVersion).where(ReviewResultVersion.task_id == task.id))).scalar_one()
    assert result.total == 80 and result.is_current
    assert (await client.post(f"/api/v1/school-review/theses/{thesis['id']}:publish", headers=auth(school), json={'version': response.json()['data']['version']})).status_code == 409
