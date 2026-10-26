import pytest
from httpx import AsyncClient,ASGITransport
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.rls_context import bind_candidate_identity,verified_access_claims
from app.modules.review.rules import pilot_rule_snapshot
from scripts.acceptance_server import acceptance_environment
from tests.helpers import login,auth
from tests.test_review import VALID_DRAFT


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", ["'{}'::jsonb", "jsonb_set(rule_snapshot, '{required_experts}', '1.0')"])
async def test_rules_read_boundaries_and_database_immutability(replacement):
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            school=await login(client,'school.wang',runtime.seed_password)
            expert=await login(client,'expert.zhou',runtime.seed_password)
            student=await login(client,'student.lin',runtime.seed_password)
            response=await client.get('/api/v1/school-review/review-rule',headers=auth(school))
            assert response.status_code==200
            assert response.json()['data']==pilot_rule_snapshot()
            url=f'/api/v1/expert/tasks/{runtime.task_id}/rules'
            response=await client.get(url,headers=auth(expert))
            assert response.status_code==200 and response.json()['data']==pilot_rule_snapshot()
            other=await login(client,'expert.qian',runtime.seed_password)
            assert (await client.get(url,headers=auth(other))).status_code==404
            assert (await client.get('/api/v1/school-review/review-rule',headers=auth(student))).status_code==403
            assert (await client.put('/api/v1/school-review/review-rule',headers=auth(school),json={})).status_code==405
            response=await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results',headers=auth(school))
            assert response.json()['data']['rule_snapshot'] is None and response.json()['data']['outcome'] is None
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(school['access_token']))
                with pytest.raises(DBAPIError) as caught:
                    await session.execute(text(f"UPDATE review_rounds SET rule_snapshot={replacement} WHERE thesis_id=:id"),{'id':runtime.thesis_id})
                assert getattr(caught.value.orig,'sqlstate',None)=='23514'
                await session.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize('value',[True,1.5,'12',-1,16])
async def test_final_scores_strict_and_bounded(value):
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            response=await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',headers=auth(expert),json={**VALID_DRAFT,'topicValue':value})
            assert response.status_code==422
            assert (await client.get(f'/api/v1/expert/tasks/{runtime.task_id}/result',headers=auth(expert))).status_code==404


@pytest.mark.asyncio
@pytest.mark.parametrize('total,code',[(59,'FAIL'),(60,'REVISION_REQUIRED'),(79,'REVISION_REQUIRED'),(80,'PASS'),(100,'PASS')])
async def test_published_outcome_uses_frozen_rule_and_preserves_anonymity(monkeypatch,total,code):
    from app.modules.dispatch import service as dispatch_service
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            school=await login(client,'school.wang',runtime.seed_password)
            student=await login(client,'student.lin',runtime.seed_password)
            supervisor=await login(client,'supervisor.zhao',runtime.seed_password)
            result_url=f'/api/v1/my/theses/{runtime.thesis_id}/published-result'
            for actor in (student,supervisor): assert (await client.get(result_url,headers=auth(actor))).status_code==404
            def changed_default():
                raise AssertionError('an existing round must not consult the factory')
            monkeypatch.setattr(dispatch_service,'pilot_rule_snapshot',changed_default)
            body=dict(VALID_DRAFT)
            remainder=total
            for d in pilot_rule_snapshot()['dimensions']:
                body[d['key']]=min(remainder,d['max_score'])
                remainder-=body[d['key']]
            preview=await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/review-checks',headers=auth(expert),json={'payload':body})
            assert preview.status_code==200
            report=preview.json()['data']
            ack={key:report[key] for key in ('payload_hash','rule_version')}
            ack['codes']=sorted({finding['code'] for finding in report['findings']})
            response=await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',headers=auth(expert),json={**body,'check_ack':ack})
            assert response.status_code==200
            response=await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results',headers=auth(school))
            data=response.json()['data']
            assert data['outcome']['code']==code and data['rule_snapshot']==pilot_rule_snapshot()
            assert (await client.post(f'/api/v1/school-review/theses/{runtime.thesis_id}:publish',headers=auth(school),json={'version':data['version']})).status_code==200
            for actor in (student,supervisor):
                response=await client.get(result_url,headers=auth(actor))
                assert response.status_code==200
                assert response.json()['data']['outcome']['code']==code
                assert response.json()['data']['rule_snapshot']==data['rule_snapshot']
                assert response.json()['data']['total']==total
                assert 'expert_id' not in response.text and '周明远' not in response.text
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session,verified_access_claims(actor['access_token']))
                    assert await session.scalar(text('SELECT count(*) FROM expert_tasks'))==0


@pytest.mark.asyncio
async def test_damaged_loaded_rule_fails_closed(monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm.attributes import set_committed_value
    from app.modules.dispatch.models import ReviewRound
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            original=AsyncSession.get
            async def damaged(self,entity,*args,**kwargs):
                value=await original(self,entity,*args,**kwargs)
                if entity is ReviewRound and value is not None:
                    # Simulate a damaged legacy load without bypassing the SQL write guard.
                    set_committed_value(value,'rule_snapshot',{'version':'unknown'})
                return value
            monkeypatch.setattr(AsyncSession,'get',damaged)
            for method,url,body in [('get',f'/api/v1/expert/tasks/{runtime.task_id}/rules',None),
                                    ('post',f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',VALID_DRAFT)]:
                kwargs={'headers':auth(expert)}
                if body is not None: kwargs['json']=body
                response=await getattr(client,method)(url,**kwargs)
                assert response.status_code==409 and response.json()['code']=='STATE_TRANSITION_DENIED'


@pytest.mark.asyncio
async def test_repeat_confirmation_and_resubmission_freeze_separate_rounds(monkeypatch):
    from types import SimpleNamespace
    from tests.helpers import ready_thesis
    from app.modules.dispatch import service as dispatch_service
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            student,school,thesis=await ready_thesis(client,SimpleNamespace(password=runtime.seed_password))
            tid=thesis['id']
            snapshots=[]
            def factory():
                rule=pilot_rule_snapshot()
                snapshots.append(rule)
                return rule
            monkeypatch.setattr(dispatch_service,'pilot_rule_snapshot',factory)
            url=f'/api/v1/school-review/theses/{tid}:confirm-dispatch'
            first=await client.post(url,headers=auth(school),json={'version':thesis['version']})
            assert first.status_code==200
            again=await client.post(url,headers=auth(school),json={'version':first.json()['data']['version']})
            assert again.status_code==200 and len(snapshots)==1
            withdrawn=await client.post(f'/api/v1/theses/{tid}:withdraw',headers=auth(student),json={'version':first.json()['data']['version'],'reason':'测试新版本'})
            assert withdrawn.status_code==200
            submit=await client.post(f'/api/v1/theses/{tid}:submit',headers=auth(student),json={'version':withdrawn.json()['data']['version']})
            assert submit.status_code==200
            ready=await client.post(f'/api/v1/school-review/theses/{tid}:confirm-anonymization',headers=auth(school),json={'version':submit.json()['data']['version'],'decision':'PASS'})
            assert ready.status_code==200
            second=await client.post(url,headers=auth(school),json={'version':ready.json()['data']['version']})
            assert second.status_code==200 and len(snapshots)==2
            assert snapshots[0] is not snapshots[1]
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(school['access_token']))
                rows=(await session.execute(text('SELECT id,status,rule_snapshot FROM review_rounds WHERE thesis_id=:id ORDER BY round_no'),{'id':tid})).all()
                assert len(rows)==2 and rows[0].id!=rows[1].id and rows[0].status=='CANCELLED'
                assert rows[0].rule_snapshot==rows[1].rule_snapshot==pilot_rule_snapshot()


@pytest.mark.asyncio
async def test_reassignment_keeps_round_snapshot():
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform=await login(client,'platform.chen',runtime.seed_password)
            old=await login(client,'expert.zhou',runtime.seed_password)
            before=(await client.get(f'/api/v1/expert/tasks/{runtime.task_id}/rules',headers=auth(old))).json()['data']
            rows=(await client.get('/api/v1/platform-review/experts',headers=auth(platform))).json()['data']
            target=next(e for e in rows if e['username']=='expert.qian')
            assert (await client.patch(f"/api/v1/platform-review/experts/{target['id']}",headers=auth(platform),json={'version':target['version'],'unit':'','title':'','discipline_codes':['0812']})).status_code==200
            replacement=await client.post(f'/api/v1/expert-tasks/{runtime.task_id}:reassign',headers=auth(platform),json={'expert_id':target['id']})
            assert replacement.status_code==200
            new_id=replacement.json()['data']['task']['id']
            new=await login(client,'expert.qian',runtime.seed_password)
            assert (await client.get(f'/api/v1/expert/tasks/{new_id}/rules',headers=auth(new))).json()['data']==before
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(platform['access_token']))
                assert await session.scalar(text('SELECT count(DISTINCT round_id) FROM expert_tasks WHERE thesis_id=:id'),{'id':runtime.thesis_id})==1
