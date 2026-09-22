import asyncio
from uuid import UUID
import pytest
from sqlalchemy import select
from app.modules.auth.deps import CurrentUser
from app.modules.user.models import User, TenantUserMembership
from app.modules.thesis.models import Thesis, ThesisVersion
from app.modules.thesis import service as thesis_service
from app.modules.dispatch.models import ExpertTask
from app.modules.review import service as review_service
from app.modules.review.models import ReviewResultVersion
from app.modules.result.models import ResultSummary
from tests.test_file_concurrency import independent_sessions
from tests.conftest import seed
from tests.helpers import login, create_draft, attach_files, accepted_task, auth
from tests.test_review import VALID_DRAFT

async def actor(session, username, role):
    uid = (await session.execute(select(User.id).where(User.username == username))).scalar_one()
    membership = (await session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == uid))).scalars().first()
    return CurrentUser(id=uid, role=role, tenant_id=membership.tenant_id if membership else None, data_scope={})

@pytest.mark.asyncio
async def test_delete_new_draft(independent_sessions):
    sessions, client = independent_sessions
    tokens = await login(client, 'student.lin')
    draft = await create_draft(client, tokens)
    with pytest.raises(Exception) as exc:
        await client.delete('/api/v1/theses/' + draft['id'], headers=auth(tokens))
    print('DELETE DRAFT ERROR', str(exc.value))

@pytest.mark.asyncio
async def test_late_patch_mutates_frozen_version(independent_sessions):
    sessions, client = independent_sessions
    tokens = await login(client, 'student.lin')
    draft = await create_draft(client, tokens)
    await attach_files(client, tokens, draft['id'])
    tid = UUID(draft['id'])
    async with sessions() as one, sessions() as two:
        user = await actor(one, 'student.lin', 'student')
        stale = await two.get(Thesis, tid)
        stale_version = await two.get(ThesisVersion, stale.current_version_id)
        await thesis_service.submit(one, user, tid, draft['version'], None)
        await one.commit()
        await thesis_service.patch_draft(two, user, tid, thesis_service.DraftInput(title='林知远 20260001', abstract='Late identity metadata', discipline_code='0835', discipline_name='软件工程', keywords=["keyword"]))
        await two.commit()
    async with sessions() as session:
        thesis = await session.get(Thesis, tid)
        version = await session.get(ThesisVersion, thesis.current_version_id)
        print('FROZEN METADATA', thesis.stage, version.is_editable, version.title, version.discipline_code)
        assert thesis.stage == 'PREPARING' and version.is_editable is False and version.title == '林知远 20260001'

@pytest.mark.asyncio
async def test_late_final_overwrites_locked_result(independent_sessions, seed):
    sessions, client = independent_sessions
    expert, student, task_id = await accepted_task(client, seed)
    async with sessions() as one, sessions() as two:
        user = await actor(one, 'expert.zhou', 'expert')
        stale = await two.get(ExpertTask, UUID(task_id))
        await review_service.submit_final(one, user, stale.id, review_service.ReviewPayload(**VALID_DRAFT))
        await one.commit()
        second = await review_service.submit_final(two, user, stale.id, review_service.ReviewPayload(**{**VALID_DRAFT, 'topicValue': 1}))
        await two.commit()
        print('LATE FINAL ACCEPTED', second)
    async with sessions() as session:
        results = list((await session.execute(select(ReviewResultVersion).where(ReviewResultVersion.task_id == UUID(task_id)).order_by(ReviewResultVersion.version_no))).scalars())
        summary = (await session.execute(select(ResultSummary))).scalar_one()
        print('RESULTS', [(r.version_no,r.total,r.is_current) for r in results], 'SUMMARY', summary.total)
        assert [(r.total, r.is_current) for r in results] == [(80,False),(69,True)] and summary.total == 80

@pytest.mark.asyncio
async def test_idempotency_ignores_final_body(independent_sessions, seed):
    sessions, client = independent_sessions
    expert, student, task_id = await accepted_task(client, seed)
    first = await client.post(f'/api/v1/expert/tasks/{task_id}:submit-final', headers=auth(expert,'same-key'), json=VALID_DRAFT)
    second = await client.post(f'/api/v1/expert/tasks/{task_id}:submit-final', headers=auth(expert,'same-key'), json={**VALID_DRAFT, 'topicValue':1})
    print('IDEMPOTENCY',first.status_code, second.status_code, second.json())
    assert first.status_code == second.status_code == 200

@pytest.mark.asyncio
async def test_second_expert_changes_published_result(independent_sessions, seed):
    from tests.helpers import published_thesis
    from app.modules.expert.models import Expert
    sessions, client = independent_sessions
    expert, student, task_id = await accepted_task(client, seed)
    school = await login(client, 'school.wang')
    platform = await login(client, 'platform.chen')
    qian = await login(client, 'expert.qian')
    theses = (await client.get('/api/v1/theses', headers=auth(student))).json()['data']
    tid = theses[0]['id']
    async with sessions() as session:
        qid = (await session.execute(select(User.id).where(User.username=='expert.qian'))).scalar_one()
        qexpert = (await session.execute(select(Expert).where(Expert.user_id==qid))).scalar_one()
        qexpert.discipline_codes = ['0812']
        qexpert_id = str(qexpert.id)
        await session.commit()
    assigned = await client.post(f'/api/v1/platform-review/theses/{tid}:assign', headers=auth(platform), json={'expert_id':qexpert_id})
    print('SECOND EXPERT ASSIGN',assigned.status_code)
    assert assigned.status_code == 200
    qtask = assigned.json()['data']['task']['id']
    assert (await client.post(f'/api/v1/expert/tasks/{qtask}:accept', headers=auth(qian))).status_code == 200
    assert (await client.post(f'/api/v1/expert/tasks/{task_id}:submit-final', headers=auth(expert), json=VALID_DRAFT)).status_code == 200
    thesis = (await client.get('/api/v1/theses', headers=auth(student))).json()['data'][0]
    assert (await client.post(f'/api/v1/school-review/theses/{tid}:publish', headers=auth(school), json={'version':thesis['version']})).status_code == 200
    before = (await client.get(f'/api/v1/my/theses/{tid}/published-result',headers=auth(student)))
    later = await client.post(f'/api/v1/expert/tasks/{qtask}:submit-final', headers=auth(qian), json={**VALID_DRAFT,'topicValue':1})
    print('LATE SECOND EXPERT FINAL',later.status_code)
    after = (await client.get(f'/api/v1/my/theses/{tid}/published-result',headers=auth(student)))
    print('PUBLIC BEFORE AFTER',before.status_code,before.text,after.text)

@pytest.mark.asyncio
async def test_objection_latest_projection(independent_sessions, seed):
    from tests.helpers import published_thesis
    sessions, client = independent_sessions
    student, school, tid = await published_thesis(client,seed)
    first = await client.post(f'/api/v1/my/theses/{tid}/objections', headers=auth(student), json={'reason':'First appeal'})
    oid = first.json()['data']['id']
    await client.post(f'/api/v1/school-review/objections/{oid}:record-resolution', headers=auth(school), json={'channel':'ONLINE','conclusion':'First resolution'})
    second = await client.post(f'/api/v1/my/theses/{tid}/objections', headers=auth(student), json={'reason':'Second appeal'})
    listed = await client.get(f'/api/v1/my/theses/{tid}/objections', headers=auth(student))
    print('OBJECTION ORDER', [(x['reason'],x['status']) for x in listed.json()['data']])
    assert listed.json()['data'][0]['id'] == oid
    assert second.json()['data']['id'] != oid
