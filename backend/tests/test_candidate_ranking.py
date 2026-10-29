import pytest
from httpx import ASGITransport, AsyncClient
from app.modules.dispatch.candidate_ranking import rank_candidate
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth,login
from tests.test_expert_operations import dispatch_fixture


def test_rule_score_explanations_and_empty_profiles():
    meta={'title':'图像识别与机器学习','abstract':'实验分析','keywords':['分类','检测','分割']}
    result=rank_candidate(meta,{'research_directions':['图像识别','机器学习'],'keywords':['分类','检测','分割']})
    assert result['match_score']==12
    assert sum(r['points'] for r in result['match_reasons'])==12
    assert result['match_rule_version']=='expert-rank-v1'
    assert {r['tag'] for r in result['match_reasons']}=={'图像识别','机器学习','分类','检测','分割'}
    assert rank_candidate(meta,{})['match_score']==0
    assert rank_candidate({}, {'research_directions':[''],'keywords':['']})['match_score']==0


def test_nfkc_lowercase_dedup_exact_keywords_and_separate_text_fields():
    meta={'title':'ＮＬＰ research','abstract':'机器学习','keywords':[' ＡＩ ','Ai','分类']}
    expert={'research_directions':[' NLP ','ｎｌｐ','人工智能','research机器'],'keywords':['ai','ＡＩ','分','人工智能']}
    result=rank_candidate(meta,expert)
    assert result['match_score']==5
    assert result['match_reasons']==[{'kind':'research_direction','tag':'nlp','points':3},{'kind':'keyword','tag':'ai','points':2}]


def test_caps_and_deterministic_scored_reasons():
    tags=[f'方向{i}' for i in range(9)]
    meta={'title':'、'.join(tags),'keywords':tags}
    a=rank_candidate(meta,{'research_directions':tags,'keywords':tags})
    b=rank_candidate(meta,{'research_directions':list(reversed(tags)),'keywords':list(reversed(tags))})
    assert a==b and a['match_score']==25
    assert len(a['match_reasons'])==10 and sum(r['points'] for r in a['match_reasons'])==25


@pytest.mark.asyncio
async def test_rank_hard_gates_versions_legacy_assignment_and_reassignment():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            actor,thesis,zhou=await dispatch_fixture(client,runtime)
            base='/api/v1/platform-review'
            experts=(await client.get(base+'/experts',headers=auth(actor))).json()['data']
            qian=next(e for e in experts if e['username']=='expert.qian')
            async def update(e,**extra):
                response=await client.patch(base+'/experts/'+e['id'],headers=auth(actor),json={
                    'version':e['version'],'unit':'虚构大学','title':'教授','discipline_codes':['0812'],**extra})
                assert response.status_code==200,response.text
                return response.json()['data']
            zhou=await update(zhou,research_directions=['论文','多校盲审'],keywords=['盲审','门禁'])
            qian=await update(qian)
            async def candidates():
                r=await client.get(base+'/dispatch-candidates',params={'thesis_id':thesis['id']},headers=auth(actor))
                assert r.status_code==200,r.text
                return r.json()['data']
            rows=await candidates()
            assert [r['expert_id'] for r in rows]==[zhou['id'],qian['id']]
            assert rows[0]['match_score']==10 and rows[1]['match_score']==0
            assert all(r['hard_allowed'] for r in rows)
            assert all(r['candidate_version']==2 and isinstance(r['thesis_version'],int) for r in rows)
            assert '一篇不含身份线索的摘要' not in str(rows)
            conflict=await client.put(base+'/experts/'+zhou['id']+'/conflicts',headers=auth(actor),
                json={'version':zhou['version'],'items':[{'kind':'SUPERVISOR_NAME','value':'赵文博'}]})
            assert conflict.status_code==200
            rows=await candidates()
            assert rows[0]['expert_id']==qian['id'] and rows[1]['match_score']==10
            assert rows[1]['hard_allowed'] is False and rows[1]['avoided'] is True
            url=base+'/theses/'+thesis['id']+':assign'
            assert (await client.post(url,headers=auth(actor),json={'expert_id':zhou['id'],'expected_expert_version':2})).status_code==409
            assert (await client.post(url,headers=auth(actor),json={'expert_id':zhou['id']})).status_code==409
            # No score supplied by the client can bypass validation.
            assert (await client.post(url,headers=auth(actor),json={'expert_id':qian['id'],'match_score':999})).status_code==422
            qualification_url=base+'/experts/'+qian['id']+':review-qualification'
            rejected=await client.post(qualification_url,headers=auth(actor),json={
                'version':qian['version'],'status':'REJECTED','reason':'资格复核'})
            assert rejected.status_code==200
            rows=await candidates()
            assert next(r for r in rows if r['expert_id']==qian['id'])['hard_allowed'] is False
            assert (await client.post(url,headers=auth(actor),json={'expert_id':qian['id'],'expected_expert_version':qian['version']})).status_code==409
            assert (await client.post(url,headers=auth(actor),json={'expert_id':qian['id']})).status_code==404
            approved=await client.post(qualification_url,headers=auth(actor),json={
                'version':rejected.json()['data']['version'],'status':'APPROVED','reason':'复核通过'})
            assert approved.status_code==200
            qian=approved.json()['data']
            qian=await update(qian,title='副教授')
            stale=await client.post(url,headers=auth(actor),json={'expert_id':qian['id'],'expected_expert_version':2})
            assert stale.status_code==409
            # An old client can still assign a compliant zero-score expert.
            assigned=await client.post(url,headers=auth(actor,'legacy-zero'),json={'expert_id':qian['id']})
            assert assigned.status_code==200,assigned.text
            old_task=assigned.json()['data']['task']['id']
            cleared=await client.put(base+'/experts/'+zhou['id']+'/conflicts',headers=auth(actor),json={'version':conflict.json()['data']['version'],'items':[]})
            zhou=cleared.json()['data']
            rows=await candidates()
            eligible=next(r for r in rows if r['expert_id']==zhou['id'])
            assert eligible['allowed_actions']==['REASSIGN_EXPERT']
            assert (await client.post(url,headers=auth(actor),json={'expert_id':zhou['id']})).status_code==409
            changed=await update(zhou,keywords=[])
            stale=await client.post('/api/v1/expert-tasks/'+old_task+':reassign',headers=auth(actor),
                json={'expert_id':zhou['id'],'expected_expert_version':zhou['version']})
            assert stale.status_code==409
            rows=await candidates()
            assert next(r for r in rows if r['expert_id']==qian['id'])['hard_allowed'] is False
            replacement_url='/api/v1/expert-tasks/'+old_task+':reassign'
            replacement_body={'expert_id':zhou['id'],'expected_expert_version':changed['version']}
            replacement=await client.post(replacement_url,headers=auth(actor,'version-bound-reassign'),json=replacement_body)
            assert replacement.status_code==200,replacement.text
            replay=await client.post(replacement_url,headers=auth(actor,'version-bound-reassign'),json=replacement_body)
            assert replay.status_code==200 and replay.json()['data']==replacement.json()['data']
            changed_body={**replacement_body,'expected_expert_version':changed['version']+1}
            assert (await client.post(replacement_url,headers=auth(actor,'version-bound-reassign'),json=changed_body)).status_code==409
            for name in ('school.wang','expert.zhou','student.lin','admin.system','supervisor.zhao'):
                other=await login(client,name,runtime.seed_password)
                denied=await client.get(base+'/dispatch-candidates',params={'thesis_id':thesis['id']},headers=auth(other))
                assert denied.status_code==403 and 'match_reasons' not in denied.text
