import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.helpers import login, auth


@pytest.mark.asyncio
async def test_expert_directory_read_and_role_boundaries():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform = await login(client, 'platform.chen', runtime.seed_password)
            response = await client.get('/api/v1/platform-review/experts', headers=auth(platform))
            assert response.status_code == 200
            rows = response.json()['data']
            assert len(rows) == 2
            assert all(row['qualification_status'] == 'APPROVED' and row['version'] == 1 for row in rows)
            assert all(row['unit'] == row['title'] == '' for row in rows)
            assert 'password' not in response.text
            for username in ('student.lin', 'school.wang', 'admin.system', 'expert.zhou'):
                actor = await login(client, username, runtime.seed_password)
                assert (await client.get('/api/v1/platform-review/experts', headers=auth(actor))).status_code == 403
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert['access_token']))
                assert await session.scalar(text('SELECT count(*) FROM experts')) == 1
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(platform['access_token']))
                with pytest.raises(DBAPIError):
                    await session.execute(text('SELECT password_hash FROM users'))
                await session.rollback()



@pytest.mark.asyncio
async def test_create_expert_replay_version_and_direct_assignment_gate():
    from tests.helpers import ready_thesis
    from types import SimpleNamespace
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform = await login(client, 'platform.chen', runtime.seed_password)
            headers = {**auth(platform), 'Idempotency-Key':'create-expert-test'}
            body = dict(username='pilot.expert',display_name='试点新专家',initial_password='Synthetic-Expert-Only',
                        unit='测试大学',title='教授',discipline_codes=['0812'])
            created = await client.post('/api/v1/platform-review/experts',headers=headers,json=body)
            assert created.status_code == 201
            item = created.json()['data']
            assert item['qualification_status'] == 'PENDING'
            assert (await client.post('/api/v1/platform-review/experts',headers=headers,json=body)).json()['data'] == item
            assert (await client.post('/api/v1/platform-review/experts',headers=headers,json={**body,'title':'副教授'})).status_code == 409
            assert (await client.post('/api/v1/platform-review/experts',headers={**headers,'Idempotency-Key':'different'},json=body)).status_code == 409
            assert (await client.post('/api/v1/platform-review/experts',headers=headers,json={**body,'initial_password':'Different-Synthetic-Only'})).status_code == 409
            from sqlalchemy import create_engine
            from tests.conftest import _test_url
            engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={runtime.schema}'})
            try:
                with engine.connect() as conn:
                    assert conn.scalar(text('SELECT count(*) FROM users WHERE username=:name'),{'name':body['username']})==1
                    assert conn.scalar(text('SELECT count(*) FROM experts WHERE user_id=:id'),{'id':item['user_id']})==1
                    assert conn.scalar(text('SELECT count(*) FROM user_role_assignments WHERE user_id=:id'),{'id':item['user_id']})==1
                    assert conn.scalar(text("SELECT count(*) FROM audit_events WHERE action='expert.create' AND object_id=:id"),{'id':item['id']})==1
                    stored=conn.execute(text("SELECT request_hash,response_body FROM idempotency_keys WHERE key='create-expert-test'")).one()
                    assert body['initial_password'] not in str(stored)
                    assert 'password' not in str(stored.response_body)
            finally:
                engine.dispose()
            expert = await login(client,body['username'],body['initial_password'])
            assert expert['access_token']
            _, school, thesis = await ready_thesis(client, SimpleNamespace(password=runtime.seed_password))
            tid = thesis['id']
            assert (await client.post(f'/api/v1/school-review/theses/{tid}:confirm-dispatch',
                                     headers=auth(school),json={'version':thesis['version']})).status_code == 200
            assign_url = f'/api/v1/platform-review/theses/{tid}:assign'
            assert (await client.post(assign_url,headers=auth(platform),json={'expert_id':item['id']})).status_code == 404
            url=f"/api/v1/platform-review/experts/{item['id']}"
            approved = await client.post(url+':review-qualification',headers=auth(platform),
                                        json={'version':1,'status':'APPROVED','reason':'已核验'})
            assert approved.status_code == 200
            assert (await client.patch(url,headers=auth(platform),json={
                'version':1,'unit':'x','title':'x','discipline_codes':['0812']})).status_code == 409
            paused = await client.post(url+':set-service-status',headers=auth(platform),
                                      json={'version':2,'status':'UNAVAILABLE','reason':'暂停'})
            assert paused.status_code == 200
            assert (await client.post(assign_url,headers=auth(platform),json={'expert_id':item['id']})).status_code == 404
            resumed = await client.post(url+':set-service-status',headers=auth(platform),
                                       json={'version':3,'status':'AVAILABLE','reason':'恢复'})
            assert resumed.status_code == 200
            assert (await client.post(assign_url,headers=auth(platform),json={'expert_id':item['id']})).status_code == 200


@pytest.mark.asyncio
async def test_expert_write_rls_rejects_privilege_and_parent_changes():
    from uuid import uuid4
    from sqlalchemy import create_engine
    from tests.conftest import _test_url

    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform = await login(client, 'platform.chen', runtime.seed_password)
            rows = (await client.get('/api/v1/platform-review/experts', headers=auth(platform))).json()['data']
            eid, uid = rows[0]['id'], rows[0]['user_id']
            created = await client.post('/api/v1/platform-review/experts',headers={**auth(platform),'Idempotency-Key':'rls-owned-user'},json={
                'username':'rls.owned.expert','display_name':'Owned','initial_password':'Synthetic-Owned-Only',
                'unit':'','title':'','discipline_codes':['0812']})
            assert created.status_code==201
            owned_uid=created.json()['data']['user_id']
            forbidden = [
                ("INSERT INTO users (id,username,password_hash,display_name,status,provisioned_by) VALUES (:id,'forged.expert','unused','x','ACTIVE',:uid)", {'id':uuid4(),'uid':uid}),
                ("INSERT INTO experts (id,user_id,service_status,discipline_codes) VALUES (:id,:uid,'AVAILABLE','[]')", {'id':uuid4(),'uid':platform['user']['id']}),
                ("INSERT INTO user_role_assignments (id,user_id,role_id,tenant_id,data_scope) SELECT :id,:uid,id,NULL,'{}' FROM roles WHERE code='system_admin'", {'id':uuid4(),'uid':owned_uid}),
                ("INSERT INTO user_role_assignments (id,user_id,role_id,tenant_id,data_scope) SELECT :id,:uid,id,NULL,'{}' FROM roles WHERE code='expert'", {'id':uuid4(),'uid':uid}),
                ("UPDATE experts SET user_id=:uid WHERE id=:eid", {'uid':rows[1]['user_id'],'eid':eid}),
                ("UPDATE expert_conflicts SET expert_id=:eid", {'eid':eid}),
                ("SELECT password_hash FROM users", {}),
                ("DELETE FROM experts WHERE id=:eid", {"eid":eid}),
            ]
            for sql, params in forbidden:
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(platform['access_token']))
                    with pytest.raises(DBAPIError) as caught:
                        await session.execute(text(sql), params)
                    assert getattr(caught.value.orig, 'sqlstate', None) == '42501'
                    await session.rollback()
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(platform['access_token']))
                result = await session.execute(text('UPDATE users SET display_name=\'forbidden\' WHERE id=:uid'), {'uid':uid})
                assert result.rowcount == 0
            admin = create_engine(_test_url().replace('+asyncpg','+psycopg'))
            try:
                with admin.connect() as conn:
                    row = conn.execute(text('SELECT prosecdef, proconfig FROM pg_proc WHERE pronamespace=to_regnamespace(:s) AND proname=\'app_provisioned_user\''), {'s':runtime.schema}).one()
                    assert row.prosecdef is False
                    assert row.proconfig == [f'search_path=pg_catalog, {runtime.schema}']
            finally:
                admin.dispose()


async def dispatch_fixture(client, runtime):
    from tests.helpers import ready_thesis
    from types import SimpleNamespace
    platform = await login(client, 'platform.chen', runtime.seed_password)
    _, school, thesis = await ready_thesis(client, SimpleNamespace(password=runtime.seed_password))
    response = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",
                                headers=auth(school), json={'version':thesis['version']})
    assert response.status_code == 200
    experts = (await client.get('/api/v1/platform-review/experts',headers=auth(platform))).json()['data']
    expert = next(e for e in experts if e['username']=='expert.zhou')
    return platform, thesis, expert


@pytest.mark.asyncio
@pytest.mark.parametrize('accept_first', [False, True])
async def test_terminate_cancels_invited_task_under_rls(accept_first):
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform, thesis, expert = await dispatch_fixture(client, runtime)
            school = await login(client, 'school.wang', runtime.seed_password)
            reviewer = await login(client, 'expert.zhou', runtime.seed_password)
            assigned = await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",
                                         headers=auth(platform), json={'expert_id': expert['id']})
            assert assigned.status_code == 200, assigned.text
            task_id = assigned.json()['data']['task']['id']
            if accept_first:
                accepted = await client.post(f'/api/v1/expert/tasks/{task_id}:accept', headers=auth(reviewer))
                assert accepted.status_code == 200, accepted.text
            current = (await client.get(f"/api/v1/school-review/theses", headers=auth(school))).json()['data']
            version = next(row['version'] for row in current if row['id'] == thesis['id'])
            terminated = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:terminate",
                                           headers=auth(school), json={'version': version, 'reason': '验收终止'})
            assert terminated.status_code == 200, terminated.text
            tasks = (await client.get('/api/v1/expert/tasks', headers=auth(reviewer))).json()['data']
            assert next(row for row in tasks if row['id'] == task_id)['status'] == 'CANCELLED'
            assert (await client.post(f'/api/v1/expert/tasks/{task_id}:accept',
                                      headers=auth(reviewer))).status_code == 404


@pytest.mark.asyncio
async def test_school_task_cancel_policy_rejects_other_updates():
    from uuid import UUID
    from sqlalchemy import create_engine
    from tests.conftest import _test_url

    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform, thesis, expert = await dispatch_fixture(client, runtime)
            school = await login(client, 'school.wang', runtime.seed_password)
            assigned = await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",
                                         headers=auth(platform), json={'expert_id': expert['id']})
            assert assigned.status_code == 200, assigned.text
            task_id = UUID(assigned.json()['data']['task']['id'])
            experts = (await client.get('/api/v1/platform-review/experts', headers=auth(platform))).json()['data']
            other_expert_id = UUID(next(row['id'] for row in experts if row['id'] != expert['id']))
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                with pytest.raises(DBAPIError) as denied:
                    await session.execute(text("""
                        UPDATE expert_tasks SET status='CANCELLED', version=version+1 WHERE id=:id
                    """), {'id': task_id})
                assert denied.value.orig.sqlstate == '42501'
                await session.rollback()

            current = (await client.get('/api/v1/school-review/theses', headers=auth(school))).json()['data']
            version = next(row['version'] for row in current if row['id'] == thesis['id'])
            terminated = await client.post(f"/api/v1/school-review/theses/{thesis['id']}:terminate",
                                           headers=auth(school), json={'version': version, 'reason': '验收终止'})
            assert terminated.status_code == 200, terminated.text

            # An owner-only fixture recreates an unfinished row on a terminated
            # fictitious thesis so the school guard can be tested directly.
            owner = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                                  connect_args={'options': f'-c search_path={runtime.schema}'})
            try:
                with owner.begin() as conn:
                    conn.execute(text("UPDATE expert_tasks SET status='INVITED' WHERE id=:id"), {'id': task_id})
            finally:
                owner.dispose()
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                with pytest.raises(DBAPIError) as denied:
                    await session.execute(text("""
                        UPDATE expert_tasks SET status='CANCELLED', version=version+1,
                            expert_id=:other WHERE id=:id
                    """), {'id': task_id, 'other': other_expert_id})
                assert denied.value.orig.sqlstate == '42501'
                await session.rollback()
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                updated = await session.execute(text("""
                    UPDATE expert_tasks SET status='CANCELLED', version=version+1 WHERE id=:id
                """), {'id': task_id})
                assert updated.rowcount == 1
                await session.commit()


def test_school_task_cancel_migration_roundtrip():
    from sqlalchemy import create_engine
    from tests.conftest import _test_url, migrated_test_schema
    from tests.test_rule_snapshot_migration import migrate

    with migrated_test_schema('0018_round_rule_snapshot') as schema:
        owner = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                              connect_args={'options': f'-c search_path={schema}'})
        try:
            for direction, revision, present in (
                ('upgrade', '0019_school_task_cancellation', True),
                ('downgrade', '0018_round_rule_snapshot', False),
                ('upgrade', '0019_school_task_cancellation', True),
            ):
                result = migrate(schema, direction, revision)
                assert result.returncode == 0, result.stderr
                with owner.connect() as conn:
                    assert bool(conn.scalar(text("""
                        SELECT count(*) FROM pg_policies WHERE schemaname=current_schema()
                          AND tablename='expert_tasks' AND policyname='tasks_school_cancel'
                    """))) is present
                    assert bool(conn.scalar(text("""
                        SELECT count(*) FROM pg_trigger WHERE tgrelid='expert_tasks'::regclass
                          AND tgname='school_task_cancellation_guard'
                    """))) is present
        finally:
            owner.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['qualification','school','supervisor','discipline'])
async def test_updated_expert_gates_direct_assignment_and_preserves_invalid_input(change):
    from uuid import uuid4
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform, thesis, expert = await dispatch_fixture(client,runtime)
            url=f"/api/v1/platform-review/experts/{expert['id']}"
            invalid = await client.put(url+'/conflicts',headers=auth(platform),json={
                'version':1,'items':[{'kind':'TENANT_ID','value':str(uuid4())}]})
            assert invalid.status_code == 422
            invalid = await client.patch(url,headers=auth(platform),json={
                'version':1,'unit':'','title':'','discipline_codes':['NOT-A-CODE']})
            assert invalid.status_code == 422
            if change=='qualification':
                result=await client.post(url+':review-qualification',headers=auth(platform),json={
                    'version':1,'status':'REJECTED','reason':'未通过'})
            elif change=='discipline':
                options=(await client.get('/api/v1/platform-review/expert-options',headers=auth(platform))).json()['data']
                code=next(d['code'] for d in options['disciplines'] if d['code']!='0812')
                result=await client.patch(url,headers=auth(platform),json={
                    'version':1,'unit':'','title':'','discipline_codes':[code]})
            else:
                if change=='school':
                    school=await login(client,'school.wang',runtime.seed_password)
                    item={'kind':'TENANT_ID','value':school['user']['tenant_id']}
                else:
                    # This is the seeded thesis eligibility's supervisor, not the expert's own name.
                    item={'kind':'SUPERVISOR_NAME','value':'赵文博'}
                result=await client.put(url+'/conflicts',headers=auth(platform),json={
                    'version':1,'items':[item,item]})
                assert len(result.json()['data']['conflicts'])==1
            assert result.status_code == 200
            assert result.json()['data']['version']==2
            blocked=await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",
                                      headers=auth(platform),json={'expert_id':expert['id']})
            assert blocked.status_code in (404,409)


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid_identity', ['DISABLED','LOCKED','future','expired','missing','wrong-role'])
async def test_invalid_expert_identity_excluded_from_candidates_and_assign(invalid_identity):
    from sqlalchemy import create_engine
    from tests.conftest import _test_url
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform, thesis, expert = await dispatch_fixture(client,runtime)
            engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={runtime.schema}'})
            try:
                with engine.begin() as conn:
                    if invalid_identity in ('DISABLED','LOCKED'):
                        conn.execute(text('UPDATE users SET status=:s WHERE id=:id'),{'s':invalid_identity,'id':expert['user_id']})
                    else:
                        sql={
                            'future':"UPDATE user_role_assignments SET effective_from=now()+interval '1 day' WHERE user_id=:id",
                            'expired':"UPDATE user_role_assignments SET effective_until=now()-interval '1 day' WHERE user_id=:id",
                            'missing':'DELETE FROM user_role_assignments WHERE user_id=:id',
                            'wrong-role':"UPDATE user_role_assignments SET role_id=(SELECT id FROM roles WHERE code='platform_reviewer') WHERE user_id=:id",
                        }[invalid_identity]
                        conn.execute(text(sql),{'id':expert['user_id']})
            finally:
                engine.dispose()
            candidates=await client.get('/api/v1/platform-review/dispatch-candidates',headers=auth(platform),params={'thesis_id':thesis['id']})
            assert candidates.status_code==200
            assert expert['id'] not in [x['expert_id'] for x in candidates.json()['data']]
            blocked=await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",
                                      headers=auth(platform),json={'expert_id':expert['id']})
            assert blocked.status_code==404


@pytest.mark.asyncio
@pytest.mark.parametrize('config_first', [True,False])
@pytest.mark.parametrize('operation', ['status','conflict'])
async def test_expert_configuration_and_assignment_serialize(monkeypatch,config_first,operation):
    import asyncio
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.sql import Select
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform, thesis, expert = await dispatch_fixture(client,runtime)
            school=await login(client,'school.wang',runtime.seed_password)
            url=f"/api/v1/platform-review/experts/{expert['id']}"
            reached, release, second_started = asyncio.Event(),asyncio.Event(),asyncio.Event()
            original=AsyncSession.execute
            calls=0
            async def controlled(self,stmt,*args,**kwargs):
                nonlocal calls
                is_lock=isinstance(stmt,Select) and stmt._for_update_arg is not None and 'FROM experts' in str(stmt)
                first=False
                if is_lock:
                    calls+=1
                    first=calls==1
                    if calls==2: second_started.set()
                result=await original(self,stmt,*args,**kwargs)
                if first:
                    reached.set()
                    await asyncio.wait_for(release.wait(),10)
                return result
            monkeypatch.setattr(AsyncSession,'execute',controlled)
            async def configure():
                if operation=='status':
                    return await client.post(url+':set-service-status',headers=auth(platform),json={
                        'version':1,'status':'UNAVAILABLE','reason':'并发验收'})
                return await client.put(url+'/conflicts',headers=auth(platform),json={
                    'version':1,'items':[{'kind':'TENANT_ID','value':school['user']['tenant_id']}]})
            async def assign():
                return await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",
                                         headers=auth(platform),json={'expert_id':expert['id']})
            first=asyncio.create_task(configure() if config_first else assign())
            second=None
            try:
                await asyncio.wait_for(reached.wait(),10)
                second=asyncio.create_task(assign() if config_first else configure())
                await asyncio.wait_for(second_started.wait(),10)
                assert not second.done()
                # A separate database transaction proves the first request holds the row lock.
                async with runtime.session_factory() as probe:
                    await bind_candidate_identity(probe,verified_access_claims(platform['access_token']))
                    with pytest.raises(DBAPIError) as caught:
                        await probe.execute(text('SELECT id FROM experts WHERE id=:id FOR UPDATE NOWAIT'),{'id':expert['id']})
                    assert getattr(caught.value.orig,'sqlstate',None)=='55P03'
                    await probe.rollback()
            finally:
                release.set()
                results=await asyncio.wait_for(asyncio.gather(first,*([second] if second else []),return_exceptions=True),10)
            assert len(results)==2 and all(not isinstance(r,Exception) for r in results)
            configured,assigned=results if config_first else results[::-1]
            assert configured.status_code==200
            expected = (404 if operation=='status' else 409) if config_first else 200
            assert assigned.status_code == expected
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(platform['access_token']))
                count=await session.scalar(text("SELECT count(*) FROM expert_tasks WHERE thesis_id=:id AND status='INVITED'"),{'id':thesis['id']})
                assert count==(0 if config_first else 1)


@pytest.mark.asyncio
@pytest.mark.parametrize('gate',['status','qualification','school','supervisor'])
async def test_reassign_rejects_new_gate_without_cancelling_old_task(gate):
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform=await login(client,'platform.chen',runtime.seed_password)
            school=await login(client,'school.wang',runtime.seed_password)
            rows=(await client.get('/api/v1/platform-review/experts',headers=auth(platform))).json()['data']
            target=next(e for e in rows if e['username']!='expert.zhou')
            url=f"/api/v1/platform-review/experts/{target['id']}"
            assert (await client.patch(url,headers=auth(platform),json={
                'version':1,'unit':'','title':'','discipline_codes':['0812']})).status_code==200
            if gate in ('status','qualification'):
                suffix,status=(':set-service-status','UNAVAILABLE') if gate=='status' else (':review-qualification','REJECTED')
                response=await client.post(url+suffix,headers=auth(platform),json={
                    'version':2,'status':status,'reason':'测试门禁'})
            else:
                item={'kind':'TENANT_ID','value':school['user']['tenant_id']} if gate=='school' else {'kind':'SUPERVISOR_NAME','value':'赵文博'}
                response=await client.put(url+'/conflicts',headers=auth(platform),json={'version':2,'items':[item]})
            assert response.status_code==200
            response=await client.post(f'/api/v1/expert-tasks/{runtime.task_id}:reassign',
                                       headers=auth(platform),json={'expert_id':target['id']})
            assert response.status_code == (404 if gate in ('status','qualification') else 409)
            assert response.json()['code'] in ('RESOURCE_NOT_FOUND','STATE_TRANSITION_DENIED')
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(platform['access_token']))
                assert await session.scalar(text('SELECT status FROM expert_tasks WHERE id=:id'),{'id':runtime.task_id})=='IN_REVIEW'
                assert await session.scalar(text('SELECT count(*) FROM expert_tasks WHERE thesis_id=:id'),{'id':runtime.thesis_id})==1


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario',['accepted','published'])
async def test_configuration_changes_preserve_existing_work_and_published_output(scenario):
    from tests.test_review import VALID_DRAFT
    async with acceptance_environment(scenario) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            platform=await login(client,'platform.chen',runtime.seed_password)
            student=await login(client,'student.lin',runtime.seed_password)
            expert=await login(client,'expert.zhou',runtime.seed_password)
            result_url=f'/api/v1/my/theses/{runtime.thesis_id}/published-result'
            before=await client.get(result_url,headers=auth(student)) if scenario=='published' else None
            rows=(await client.get('/api/v1/platform-review/experts',headers=auth(platform))).json()['data']
            target=next(e for e in rows if e['username']=='expert.zhou')
            url=f"/api/v1/platform-review/experts/{target['id']}"
            for version,suffix,status in [(1,':set-service-status','UNAVAILABLE'),(2,':review-qualification','REJECTED')]:
                assert (await client.post(url+suffix,headers=auth(platform),json={
                    'version':version,'status':status,'reason':'新派单暂停，原任务保留'})).status_code==200
            if scenario=='accepted':
                response=await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',headers=auth(expert),json=VALID_DRAFT)
                assert response.status_code==200
            else:
                after=await client.get(result_url,headers=auth(student))
                assert before.status_code==after.status_code==200
                assert before.json()['data']==after.json()['data']
