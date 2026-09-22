import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.modules.dispatch.models import ExpertTask
from app.modules.expert.models import Expert, ExpertConflict
from app.modules.result.models import ResultSummary
from app.modules.review.models import ReviewResultVersion
from app.modules.user.models import User, StudentEligibility
from tests.test_file_concurrency import independent_sessions
from tests.test_thesis_integrity import confirmed_round
from tests.helpers import auth, login
from tests.test_review import VALID_DRAFT
from app.core.config import get_settings


async def setup(client, sessions):
    student, school, thesis = await confirmed_round(client)
    platform = await login(client, 'platform.chen', get_settings().seed_password)
    async with sessions() as session:
        experts = (await session.execute(select(Expert, User).join(User, User.id == Expert.user_id))).all()
        ids = {}
        for expert, user in experts:
            expert.discipline_codes = ['0812']
            ids[user.username] = str(expert.id)
        await session.commit()
    return student, school, platform, thesis, ids


async def assign(client, platform, thesis, eid):
    return await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign", headers=auth(platform), json={'expert_id': eid})


async def submitted(client, sessions):
    student, school, platform, thesis, ids = await setup(client, sessions)
    assigned = await assign(client, platform, thesis, ids['expert.zhou'])
    assert assigned.status_code == 200, assigned.text
    task_id = assigned.json()['data']['task']['id']
    expert = await login(client, 'expert.zhou', get_settings().seed_password)
    assert (await client.post(f'/api/v1/expert/tasks/{task_id}:accept', headers=auth(expert))).status_code == 200
    res = await client.post(f'/api/v1/expert/tasks/{task_id}:submit-final', headers=auth(expert), json=VALID_DRAFT)
    assert res.status_code == 200, res.text
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    return student, school, platform, thesis, ids


@pytest.mark.asyncio
async def test_concurrent_different_experts_share_single_seat(independent_sessions):
    sessions, client = independent_sessions
    _, _, platform, thesis, ids = await setup(client, sessions)
    replies = await asyncio.gather(*(assign(client, platform, thesis, eid) for eid in ids.values()))
    assert sorted(r.status_code for r in replies) == [200, 409]
    async with sessions() as session:
        assert len((await session.execute(select(ExpertTask))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_profile_conflict_rejected_by_assign_api(independent_sessions):
    sessions, client = independent_sessions
    _, _, platform, thesis, ids = await setup(client, sessions)
    async with sessions() as session:
        name = (await session.execute(select(StudentEligibility.supervisor_name).where(StudentEligibility.student_name == '林知远'))).scalar_one()
        session.add(ExpertConflict(expert_id=UUID(ids['expert.zhou']), kind='SUPERVISOR_NAME', value=name))
        await session.commit()
    res = await assign(client, platform, thesis, ids['expert.zhou'])
    assert res.status_code == 409, res.text


@pytest.mark.asyncio
async def test_rejected_task_reopens_waiting_and_seat(independent_sessions):
    sessions, client = independent_sessions
    _, school, platform, thesis, ids = await setup(client, sessions)
    res = await assign(client, platform, thesis, ids['expert.zhou'])
    task = res.json()['data']['task']['id']
    expert = await login(client, 'expert.zhou', get_settings().seed_password)
    assert (await client.post(f'/api/v1/expert/tasks/{task}:reject', headers=auth(expert), json={'reason': '时间不足'})).status_code == 200
    progress = (await client.get('/api/v1/school-review/progress', headers=auth(school))).json()['data']
    assert progress['totals']['waiting'] == 1
    assert progress['totals']['rejected'] == 1
    assert (await assign(client, platform, thesis, ids['expert.qian'])).status_code == 200


async def add_legacy_task(sessions, eid, status='IN_REVIEW', with_result=False):
    async with sessions() as session:
        original = (await session.execute(select(ExpertTask))).scalars().first()
        tid = uuid4()
        session.add(ExpertTask(id=tid, tenant_id=original.tenant_id, round_id=original.round_id, expert_id=UUID(eid), status=status))
        await session.flush()
        if with_result:
            session.add(ReviewResultVersion(task_id=tid, version_no=1, total=69, scores={}, comments={'recommendation': '其他意见'}, is_current=True))
        await session.commit()
        return tid


@pytest.mark.asyncio
async def test_late_legacy_task_cannot_submit_after_results_ready(independent_sessions):
    sessions, client = independent_sessions
    _, _, _, _, ids = await submitted(client, sessions)
    tid = await add_legacy_task(sessions, ids['expert.qian'])
    qian = await login(client, 'expert.qian', get_settings().seed_password)
    res = await client.post(f'/api/v1/expert/tasks/{tid}:submit-final', headers=auth(qian), json=VALID_DRAFT)
    assert res.status_code == 409, res.text


@pytest.mark.asyncio
async def test_published_output_uses_recorded_task_set(independent_sessions):
    sessions, client = independent_sessions
    student, school, _, thesis, ids = await submitted(client, sessions)
    res = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:publish", headers=auth(school), json={'version': thesis['version']})
    assert res.status_code == 200, res.text
    before = (await client.get(f"/api/v1/my/theses/{thesis['id']}/published-result", headers=auth(student))).json()['data']
    await add_legacy_task(sessions, ids['expert.qian'], status='SUBMITTED', with_result=True)
    after = (await client.get(f"/api/v1/my/theses/{thesis['id']}/published-result", headers=auth(student))).json()['data']
    assert after == before
    school_result = (await client.get(f"/api/v1/school-review/theses/{thesis['id']}/results", headers=auth(school))).json()['data']
    assert len(school_result['items']) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('corruption', ['total', 'missing', 'extra_task'])
async def test_publish_rejects_inconsistent_summary(independent_sessions, corruption):
    sessions, client = independent_sessions
    _, school, _, thesis, ids = await submitted(client, sessions)
    if corruption == 'extra_task':
        await add_legacy_task(sessions, ids['expert.qian'])
    else:
        async with sessions() as session:
            summary = (await session.execute(select(ResultSummary))).scalar_one()
            if corruption == 'total':
                summary.total = 99
            else:
                summary.result_task_ids = []
            await session.commit()
    res = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:publish", headers=auth(school), json={'version': thesis['version']})
    assert res.status_code == 409, res.text


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['accept', 'reject'])
async def test_stale_invitation_cannot_overwrite_submitted_task(independent_sessions, action):
    from app.modules.dispatch import service as dispatch
    from app.core.exceptions import AppError
    from tests.test_thesis_integrity import actor

    sessions, client = independent_sessions
    _, _, platform, thesis, ids = await setup(client, sessions)
    assigned = await assign(client, platform, thesis, ids['expert.zhou'])
    tid = UUID(assigned.json()['data']['task']['id'])
    async with sessions() as delayed:
        stale = await delayed.get(ExpertTask, tid)
        user = await actor(delayed, 'expert.zhou', 'expert')
        expert = await login(client, 'expert.zhou', get_settings().seed_password)
        assert (await client.post(f'/api/v1/expert/tasks/{tid}:accept', headers=auth(expert))).status_code == 200
        assert (await client.post(f'/api/v1/expert/tasks/{tid}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 200
        with pytest.raises(AppError) as error:
            if action == 'accept':
                await dispatch.accept_task(delayed, user, tid)
            else:
                await dispatch.reject_task(delayed, user, tid, '延迟拒绝')
        assert error.value.code == 'STATE_TRANSITION_DENIED'
        await delayed.rollback()
