import pytest

TEXT = '研究设计没有交代样本选择依据，建议补充抽样过程并解释样本代表性。'


def compare(current, history):
    from app.modules.review.comment_similarity import compare_comments
    return compare_comments(current, history)


def test_exact_reuse_returns_only_current_fragments_not_candidate_identity():
    report = compare(TEXT, [{'id': 'private-result', 'text': TEXT, 'school': 'private-school'}])
    assert report['hit_count'] == 1
    assert report['matches'][0]['kind'] == 'EXACT'
    assert report['max_similarity'] == 1
    assert 'private-result' not in str(report) and 'private-school' not in str(report)
    assert 'plagiarism_rate' not in report


def test_empty_history_and_short_text_are_not_quality_verdicts():
    assert compare(TEXT, [])['status'] == 'NO_HISTORY'
    assert compare('普通建议', [{'text': '普通建议'}])['status'] == 'INSUFFICIENT_TEXT'
    assert compare('建议通过。', [{'text': '建议通过。'}])['hit_count'] == 0


def test_normalization_maps_combining_marks_ligatures_and_emoji_to_original():
    original = '😀Ａe\u0301ﬃ：' + TEXT
    history = '😀Aéffi ' + TEXT
    report = compare(original, [{'text': history}])
    assert report['matches'][0]['kind'] == 'EXACT'
    fragments = report['matches'][0]['fragments']
    assert any('e\u0301ﬃ' in original[f['start']:f['end']] for f in fragments)
    assert all(original[f['start']:f['end']] == f['text'] for f in fragments)


def test_template_only_text_is_excluded_before_minimum_length():
    text = '建议通过。建议修改。不通过。修改后通过。' * 4
    assert compare(text, [{'text': text}])['hit_count'] == 0


def test_similar_long_text_and_dissimilar_text():
    text = TEXT + '实验结果需要增加独立样本验证并对研究结论的适用条件作出明确说明。'
    result = compare(text, [{'text': text.replace('明确说明', '详细说明')}])
    assert result['matches'][0]['kind'] == 'SIMILAR'
    assert result['max_similarity'] >= .85
    assert compare(text, [{'text': '农业生产研究应结合土地条件和当地气候评估种植方案的实际可行性。' * 2}])['hit_count'] == 0


def add_history(runtime, payload, *, count=1, username='expert.zhou', age_days=0, status='SUBMITTED', summary=False):
    """Owned virtual records only; production corpus queries still use the business role."""
    import json
    from uuid import uuid4
    from sqlalchemy import create_engine, text
    from tests.conftest import _test_url
    engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
        connect_args={'options': f'-c search_path={runtime.schema}'})
    made = []
    try:
        with engine.begin() as conn:
            task = conn.execute(text('SELECT * FROM expert_tasks WHERE id=:id'), {'id':runtime.task_id}).mappings().one()
            expert = conn.scalar(text('SELECT e.id FROM experts e JOIN users u ON e.user_id=u.id WHERE u.username=:u'), {'u':username})
            batch = str(conn.scalar(text('SELECT review_batch_id FROM theses WHERE id=:id'), {'id':task['thesis_id']}))
            for _ in range(count):
                ids = {name:str(uuid4()) for name in ('thesis','version','round','task','result','batch')}
                for table, source, overrides in (
                    ('review_batches', batch, {'id':ids['batch'], 'code':ids['batch'].replace('-', '')}),
                    ('theses', str(task['thesis_id']), {'id':ids['thesis'], 'current_version_id':None, 'review_batch_id':ids['batch'], 'stage':'RESULT_PROCESSING'}),
                    ('thesis_versions', None, {'id':ids['version'], 'thesis_id':ids['thesis']}),
                    ('review_rounds', str(task['round_id']), {'id':ids['round'], 'thesis_id':ids['thesis'], 'thesis_version_id':ids['version'], 'status':'RESULT_READY'}),
                    ('expert_tasks', str(task['id']), {'id':ids['task'], 'thesis_id':ids['thesis'], 'round_id':ids['round'], 'expert_id':str(expert), 'status':status}),
                ):
                    if table == 'thesis_versions':
                        source = str(conn.scalar(text('SELECT thesis_version_id FROM review_rounds WHERE id=:id'), {'id':task['round_id']}))
                    conn.execute(text(f'INSERT INTO {table} SELECT (jsonb_populate_record(NULL::{table}, to_jsonb(src) || CAST(:changes AS jsonb))).* FROM {table} src WHERE id=:id'), {'id':source,'changes':json.dumps(overrides)})
                    if table == 'thesis_versions':
                        conn.execute(text('UPDATE theses SET current_version_id=:version WHERE id=:thesis'), ids)
                scores={key:payload[key] for key in ('topicValue','literatureTheory','methodology','innovation','writingStandards','resultsWorkload')}
                conn.execute(text("""INSERT INTO review_result_versions (id,task_id,round_id,tenant_id,version_no,scores,total,comments,is_current,created_at)
                    VALUES(:result,:task,:round,:tenant,1,CAST(:scores AS jsonb),:total,CAST(:comments AS jsonb),true,now()-make_interval(days => :age))"""),
                    {**ids,'tenant':task['tenant_id'],'scores':json.dumps(scores),'total':sum(scores.values()),'comments':json.dumps(payload),'age':age_days})
                if summary:
                    conn.execute(text("""INSERT INTO result_summaries (id,tenant_id,thesis_id,round_id,total,rule_snapshot,result_task_ids,version)
                        SELECT :id,tenant_id,thesis_id,id,:total,rule_snapshot,CAST(:tasks AS jsonb),1 FROM review_rounds WHERE id=:round"""),
                        {'id':str(uuid4()),'round':ids['round'],'total':sum(scores.values()),'tasks':json.dumps([ids['task']])})
                made.append(ids)
    finally:
        engine.dispose()
    return made


@pytest.mark.asyncio
async def test_real_rls_corpus_scope_limit_and_confirmation():
    from httpx import AsyncClient, ASGITransport
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth
    from tests.test_review import VALID_DRAFT
    from sqlalchemy import text
    from app.db.rls_context import bind_candidate_identity, verified_access_claims

    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            other=await login(client,'expert.qian',runtime.seed_password)
            school=await login(client,'school.wang',runtime.seed_password)
            url=f'/api/v1/expert-tasks/{runtime.task_id}/review-similarity'
            empty=await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})
            assert empty.status_code==200,empty.text
            assert empty.json()['data']['similarity']['status']=='NO_HISTORY'
            assert (await client.post(url,headers=auth(other),json={'payload':VALID_DRAFT})).status_code==404
            assert (await client.post(url,headers=auth(school),json={'payload':VALID_DRAFT})).status_code==403
            assert (await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT,'expert_id':other['user']['id']})).status_code==422
            foreign=add_history(runtime,VALID_DRAFT,username='expert.qian')
            add_history(runtime,VALID_DRAFT,age_days=366)
            add_history(runtime,VALID_DRAFT,status='CANCELLED')
            none=await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})
            assert none.json()['data']['similarity']['coverage']['examined']==0
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(expert['access_token']))
                assert await session.scalar(text('SELECT count(*) FROM review_result_versions WHERE id=:id'),{'id':foreign[0]['result']})==0
            add_history(runtime,VALID_DRAFT,count=201)
            preview=await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})
            report=preview.json()['data']
            assert report['similarity']['coverage']=={'window_days':365,'limit':200,'examined':200,'truncated':True}
            assert report['similarity']['hit_count']==200
            assert 'EXACT' in {item['kind'] for item in report['similarity']['matches']}
            assert not any(word in str(report) for word in ('expert_id','tenant_id','thesis_id','private-result'))
            ack={key:report[key] for key in ('payload_hash','rule_version')}
            ack['codes']=sorted({f['code'] for f in report['findings']})
            submit=f'/api/v1/expert/tasks/{runtime.task_id}:submit-final'
            assert (await client.post(submit,headers=auth(expert),json=VALID_DRAFT)).status_code==409
            add_history(runtime,VALID_DRAFT)
            stale=await client.post(submit,headers=auth(expert),json={**VALID_DRAFT,'check_ack':ack})
            assert stale.status_code==409 and stale.json()['code']=='CHECK_ACK_REQUIRED'
            fresh=(await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})).json()['data']
            assert fresh['similarity']['fingerprint']!=report['similarity']['fingerprint']
            ack={key:fresh[key] for key in ('payload_hash','rule_version')}
            ack['codes']=sorted({f['code'] for f in fresh['findings']})
            done=await client.post(submit,headers=auth(expert,'similarity-final'),json={**VALID_DRAFT,'check_ack':ack})
            assert done.status_code==200,done.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(expert['access_token']))
                summary=await session.scalar(text('SELECT check_summary FROM review_result_versions WHERE task_id=:id'),{'id':runtime.task_id})
                assert summary['similarity']['fingerprint']==fresh['similarity']['fingerprint']
                assert 'matches' not in summary['similarity']


@pytest.mark.parametrize('length,changed,hit', [(40, 3, True), (51, 4, False), (76, 6, True)])
def test_jaccard_threshold_not_rounded_before_comparison(length, changed, hit):
    current = ''.join(chr(0x4e00+i) for i in range(length))
    candidate = ''.join(chr(0x5000+i) for i in range(changed)) + current[changed:]
    result = compare(current,[{'text':candidate}])
    assert bool(result['hit_count']) is hit  # 35/41 > .85; 45/53 < .85 despite rounding to .85; 68/80 == .85.


def test_near_match_under_40_is_not_reported_and_hangul_composition_is_supported():
    text = ''.join(chr(0x4e00+i) for i in range(39))
    assert compare(text,[{'text':'丙'+text[1:]}])['hit_count']==0
    current='각'+TEXT
    result=compare(current,[{'text':'각'+TEXT}])
    assert result['matches'][0]['kind']=='EXACT'
    assert result['matches'][0]['fragments'][0]['text'].startswith('각')


@pytest.mark.asyncio
@pytest.mark.parametrize('history_age', [0, 366])
async def test_correction_excludes_self_and_activation_invalidates_corpus(history_age):
    from httpx import AsyncClient, ASGITransport
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth
    from tests.test_review import VALID_DRAFT
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            platform=await login(client,'platform.chen',runtime.seed_password)
            school=await login(client,'school.wang',runtime.seed_password)
            other=await login(client,'expert.qian',runtime.seed_password)
            history=add_history(runtime,VALID_DRAFT,summary=True,age_days=history_age)[0]
            url=f'/api/v1/expert-tasks/{runtime.task_id}/review-similarity'
            before=(await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})).json()['data']
            assert before['similarity']['hit_count']==(1 if history_age == 0 else 0)
            requested=await client.post(f"/api/v1/expert-tasks/{history['task']}/corrections",headers=auth(expert,'sim-request'),
                json={'base_result_id':history['result'],'reason':'核对历史意见'})
            assert requested.status_code==200,requested.text
            row=requested.json()['data']
            cid=row['id']
            check=f'/api/v1/expert-corrections/{cid}/review-similarity'
            assert (await client.post(check,headers=auth(expert),json={'payload':VALID_DRAFT})).status_code==404
            approved=await client.post(f'/api/v1/platform-review/corrections/{cid}:decide',headers=auth(platform,'sim-approve'),
                json={'version':row['version'],'decision':'APPROVE','reason':'同意核对'})
            assert approved.status_code==200,approved.text
            own=(await client.post(check,headers=auth(expert),json={'payload':VALID_DRAFT})).json()['data']
            assert own['similarity']['coverage']['examined']==0
            assert own['similarity']['status']=='NO_HISTORY'
            assert (await client.post(check,headers=auth(other),json={'payload':VALID_DRAFT})).status_code==404
            corrected={**VALID_DRAFT,'overallComment':'该文围绕农业生产开展田间调查，详细讨论了不同气候条件和灌溉方式对于农作物收成的影响，收集材料较为充分，建议进一步研究土壤营养成分的季节变化。',
                       'issues':'田间数据测量周期较短，应延长跟踪时间并增加不同地域之间的比较。','strengths':'选题符合农业实际需要','revisionAdvice':'增加土壤长期观测数据。'}
            submitted=await client.post(f'/api/v1/expert-corrections/{cid}:submit',headers=auth(expert,'sim-revision'),
                json={'version':approved.json()['data']['version'],'payload':corrected})
            assert submitted.status_code==200,submitted.text
            pending=(await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})).json()['data']
            assert pending['similarity']['fingerprint']==before['similarity']['fingerprint']
            activated=await client.post(f'/api/v1/school-review/corrections/{cid}:activate',headers=auth(school,'sim-activate'),
                json={'version':submitted.json()['data']['version'],'reason':'确认生效'})
            assert activated.status_code==200,activated.text
            after=(await client.post(url,headers=auth(expert),json={'payload':VALID_DRAFT})).json()['data']
            assert after['similarity']['coverage']['examined']==1
            assert after['similarity']['hit_count']==0
            assert after['similarity']['fingerprint']!=before['similarity']['fingerprint']
            ack={key:before[key] for key in ('payload_hash','rule_version')}
            ack['codes']=sorted({item['code'] for item in before['findings']})
            stale=await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',headers=auth(expert),json={**VALID_DRAFT,'check_ack':ack})
            assert stale.status_code==409 and stale.json()['code']=='CHECK_ACK_REQUIRED'


def test_no_history_takes_precedence_even_when_current_text_is_short():
    assert compare('简短',[])['status']=='NO_HISTORY'


def test_comparison_has_no_io_and_accepts_explicit_template_configuration(monkeypatch):
    from app.modules.review import comment_similarity
    def no_io():
        raise AssertionError('pure comparison must not read files')
    from app.modules.review import comment_checks
    monkeypatch.setattr(comment_checks,'load_dictionary',no_io)
    assert comment_similarity.compare_comments(TEXT,[{'text':TEXT}])['hit_count']==1
    assert comment_similarity.compare_comments(TEXT,[{'text':TEXT}],config={'version':'test','templates':[TEXT]})['hit_count']==0


@pytest.mark.asyncio
async def test_one_configuration_snapshot_binds_rules_and_similarity(monkeypatch):
    from copy import deepcopy
    from types import SimpleNamespace
    from app.modules.review import comment_checks, comment_similarity
    from app.modules.review.rules import pilot_rule_snapshot
    from tests.test_review import VALID_DRAFT
    original=comment_checks.load_dictionary()
    changed=deepcopy(original)
    changed['similarity']['templates']=[comment_similarity.comment_text(VALID_DRAFT)[0]]
    configs=iter([original,changed])
    def changing_file(): return next(configs)
    monkeypatch.setattr(comment_checks,'load_dictionary',changing_file)
    async def history(*args):
        return [{'id':'own-id','comments':VALID_DRAFT}],{'window_days':365,'limit':200,'examined':1,'truncated':False}
    monkeypatch.setattr(comment_similarity,'own_history',history)
    report=await comment_similarity.checked_report(None,SimpleNamespace(id='expert'),'task',VALID_DRAFT,pilot_rule_snapshot())
    assert report['similarity']['hit_count']==1


def test_reports_actual_maximum_even_below_warning_threshold():
    text=''.join(chr(0x4e00+i) for i in range(40))
    changed=''.join(chr(0x5000+i) for i in range(4))+text[4:]
    report=compare(text,[{'text':changed}])
    assert report['hit_count']==0
    assert report['max_similarity']==pytest.approx(34/42)
