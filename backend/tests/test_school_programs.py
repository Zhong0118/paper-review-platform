"""Program catalogs are tenant scoped; real RLS is exercised in the two-school scenario."""
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, create_draft, login, attach_files

SCHOOL = '/api/v1/school-admin/program-catalogs'
HEADER = '校内代码,校内名称,官方代码,状态\n'
DRAFT = dict(title='虚构校码走查',abstract='虚构摘要',keywords=['实验'],discipline_code='0812',discipline_name='计算机科学与技术')

def upload(name='虚构甲专业', code='0007', year=2026):
    return dict(year=year, source='虚构验收校方目录.csv',source_version='样本一',
                csv=HEADER+f'{code},{name},0812,启用\n')

async def preview(c, who, data):
    r=await c.post(SCHOOL+':preview',headers=auth(who),json=data)
    assert r.status_code==200,r.text
    return r.json()['data']

async def publish(c,who,data):
    prev=await preview(c,who,data)
    assert not prev['errors'],prev
    r=await c.post(SCHOOL+':publish',headers=auth(who),json={**data,'fingerprint':prev['fingerprint']})
    assert r.status_code==200,r.text
    return r.json()['data']

async def batch(c,who):
    return (await c.get('/api/v1/school-admin/batches',headers=auth(who))).json()['data'][0]

async def bind(c,who,b,cat):
    return await c.put(f"/api/v1/school-admin/batches/{b['id']}/program-catalog",headers=auth(who),
                       json={'catalog_id':cat['id'],'expected_version':b['version']})

async def test_import_errors_and_stale_preview(client,seed):
    school=await login(client,'school.wang',seed.password)
    for data in [{**upload(),'source':' '},{**upload(),'csv':HEADER+'0007,a,0812,启用\n0007,b,0812,启用'},
                 {**upload(),'csv':HEADER+'0001,专业,0000,启用'},
                 upload('含\x00空字符'),{**upload(),'source':'出处\x00'},
                 {**upload(),'csv':HEADER+'\n'.join(f'{i},'+'研'*120+',0812,启用' for i in range(1450))}]:
        prev=await preview(client,school,data)
        assert prev['errors'] and not prev['fingerprint']
    first=await publish(client,school,upload())
    stale=await preview(client,school,upload('改名'))
    second=await publish(client,school,upload('另一条','0008'))
    assert first['id']!=second['id'] and second['count']==2
    r=await client.post(SCHOOL+':publish',headers=auth(school),json={**upload('改名'),'fingerprint':stale['fingerprint']})
    assert r.status_code==409

async def test_two_school_mapping_and_legacy_with_real_rls():
    async with acceptance_environment('operations') as rt:
      async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
        a,b,sa,sb,expert=[await login(c,name,rt.seed_password) for name in
                           ('school.wang','pilot.school','student.lin','pilot.student','expert.zhou')]
        ba,bb=await batch(c,a),await batch(c,b)
        old=await create_draft(c,sa)
        ca=await publish(c,a,upload()); cb=await publish(c,b,upload('虚构乙专业'))
        assert (await bind(c,b,bb,ca)).status_code==404
        assert (await bind(c,a,ba,ca)).status_code==200
        assert (await bind(c,b,bb,cb)).status_code==200
        opts=(await c.get('/api/v1/catalog/student-programs',headers=auth(sb))).json()['data']
        assert opts['catalog_id']==cb['id'] and [(p['code'],p['name']) for p in opts['items']]==[('0007','虚构乙专业')]
        program={'catalog_id':cb['id'],'code':'0007'}
        for extra in ({},{'program':{**program,'catalog_id':ca['id']}},{'program':program,'discipline_code':'0000'}):
            r=await c.post('/api/v1/theses',headers=auth(sb),json={**DRAFT,**extra})
            assert r.status_code in (404,422)
        by_key=await c.post('/api/v1/theses',headers=auth(sb),json={**{k:v for k,v in DRAFT.items() if not k.startswith('discipline_')},'program':program})
        assert by_key.status_code==200,by_key.text
        saved=by_key.json()['data']
        assert saved['current_version']['discipline_code']=='0812'

        assert saved['current_version']['school_program']['name']=='虚构乙专业'
        later=await publish(c,b,upload('次年乙','0007',2027))
        assert (await bind(c,b,await batch(c,b),later)).status_code==409
        direct=await c.patch('/api/v1/theses/'+old['id'],headers=auth(sa),json=DRAFT)
        assert direct.status_code==200 and direct.json()['data']['current_version']['school_program'] is None
        # Grandfathered draft can submit unchanged; withdrawal keeps the original snapshot.
        await attach_files(c,sa,old['id'])
        sent=await c.post('/api/v1/theses/'+old['id']+':submit',headers=auth(sa,'legacy-send'),json={'version':old['version']})
        assert sent.status_code==200,sent.text
        fk=await c.get('/api/v1/school-review/theses/'+saved['id'],headers=auth(b))
        assert fk.json()['data']['current_version']['school_program']['name']=='虚构乙专业'
        # A later catalog cannot be substituted even if its local code looks identical.
        swapped=await c.patch('/api/v1/theses/'+saved['id'],headers=auth(sb),
                              json={**DRAFT,'program':{**program,'catalog_id':later['id']}})
        assert swapped.status_code==422
        await attach_files(c,sb,saved['id'])
        setting='/api/v1/school-admin/discipline-settings'
        assert (await c.put(setting,headers=auth(b),json={'codes':[],'expected_version':0})).status_code==200
        assert not (await c.get('/api/v1/catalog/student-programs',headers=auth(sb))).json()['data']['items']
        blocked=await c.post('/api/v1/theses/'+saved['id']+':submit',headers=auth(sb,'no-open-field'),json={'version':saved['version']})
        assert blocked.status_code==422
        assert (await c.put(setting,headers=auth(b),json={'codes':['0812'],'expected_version':1})).status_code==200
        bpath='/api/v1/school-review/theses/'+saved['id']
        spath='/api/v1/theses/'+saved['id']
        async def command(path,token,key,**body):
            reply=await c.post(path,headers=auth(token,key),json=body)
            assert reply.status_code==200,reply.text
            return reply.json()['data']
        v=await command(spath+':submit',sb,'send1',version=saved['version'])
        v=await command(spath+':withdraw',sb,'withdraw2',version=v['version'],reason='虚构撤回')
        assert v['current_version']['school_program']==saved['current_version']['school_program']
        v=await command(spath+':submit',sb,'send3',version=v['version'])
        v=await command(bpath+':confirm-anonymization',b,'pass3',decision='PASS',version=v['version'])
        await command(bpath+':confirm-dispatch',b,'dispatch',version=v['version'])
        platform=await login(c,'platform.chen',rt.seed_password)
        from tests.test_dispatch import expert_id
        from tests.test_review import VALID_DRAFT
        eid=await expert_id(c,platform,saved['id'],'zhou')
        assignment=await command('/api/v1/platform-review/theses/'+saved['id']+':assign',platform,'assign',expert_id=eid)
        task=assignment['task']['id']
        await command(f'/api/v1/expert/tasks/{task}:accept',expert,'accept')
        private=['虚构乙专业',cb['id'],'school_program']
        expert_view=await c.get('/api/v1/expert/tasks',headers=auth(expert))
        assert expert_view.status_code==200 and not any(v in expert_view.text for v in private)
        await command(f'/api/v1/expert/tasks/{task}:submit-final',expert,'final',**VALID_DRAFT)
        ready=(await c.get(bpath,headers=auth(b))).json()['data']
        await command(bpath+':publish',b,'release',version=ready['version'])
        from pypdf import PdfReader
        from io import BytesIO
        pdf=await c.get(bpath+'/published-review.pdf',headers=auth(b))
        assert pdf.status_code==200
        reader=PdfReader(BytesIO(pdf.content))
        content=str(reader.metadata)+''.join(page.extract_text() for page in reader.pages)
        assert '总分' in content and not any(v in content for v in private+['校内代码'])
        # Legacy draft may explicitly adopt a local code after withdrawal.
        old_again=await command('/api/v1/theses/'+old['id']+':withdraw',sa,'old-back',version=sent.json()['data']['version'],reason='改选专业')
        update=await c.patch('/api/v1/theses/'+old_again['id'],headers=auth(sa),json={**DRAFT,'program':{'catalog_id':ca['id'],'code':'0007'}})
        assert update.status_code==200 and update.json()['data']['current_version']['school_program']['name']=='虚构甲专业'
        import asyncio
        next_data=upload('并发专业','0011')
        p=await preview(c,a,next_data)
        requests=[c.post(SCHOOL+':publish',headers=auth(a),json={**next_data,'fingerprint':p['fingerprint']}) for _ in range(2)]
        assert sorted(resp.status_code for resp in await asyncio.gather(*requests))==[200,409]
        assert (await c.get('/api/v1/catalog/student-programs',headers=auth(expert))).status_code==403
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,verified_access_claims(expert['access_token']))
            for table in ('school_program_catalogs','school_batch_programs','thesis_program_choices'):
                assert await s.scalar(text(f'SELECT count(*) FROM {table}'))==0


def test_program_migration_roundtrip_and_refuses_to_drop_data():
    from uuid import uuid4
    from sqlalchemy import create_engine
    from tests.conftest import migrated_test_schema,_test_url
    from tests.test_rule_snapshot_migration import migrate
    with migrated_test_schema('0027_expert_profiles') as schema:
        for direction,revision in [('upgrade','0029_school_return_clone'),('downgrade','0028_school_programs'),
                                   ('downgrade','0027_expert_profiles'),('upgrade','0029_school_return_clone')]:
            result=migrate(schema,direction,revision)
            assert result.returncode==0,result.stderr[-2500:]
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={schema}'})
        try:
            with engine.begin() as conn:
                # Deliberately insert a synthetic historical row without requiring seeded accounts.
                tid=conn.scalar(text("INSERT INTO tenants(id,code,name,status,sync_mapping,config_version) VALUES(:id,'fixture','测试','ACTIVE','{}',1) RETURNING id"),{'id':uuid4()})
                uid=conn.scalar(text("INSERT INTO users(id,username,display_name,status,password_hash,auth_version) VALUES(:id,'fixture','测试','ACTIVE','unused',1) RETURNING id"),{'id':uuid4()})
                conn.execute(text("""INSERT INTO school_program_catalogs(id,tenant_id,year,revision,source,source_version,published_by,entries)
                     VALUES(:id,:tenant,2026,1,'fixture','v1',:actor,'{}')"""),{'id':uuid4(),'tenant':tid,'actor':uid})
            result=migrate(schema,'downgrade','0027_expert_profiles')
            assert result.returncode and 'would discard school program history' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT relforcerowsecurity FROM pg_class WHERE oid=to_regclass(\'school_program_catalogs\')'))
        finally:engine.dispose()

async def test_manual_return_copies_mapped_version_under_real_school_role():
    async with acceptance_environment('operations') as rt:
      async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
        school=await login(c,'pilot.school',rt.seed_password); student=await login(c,'pilot.student',rt.seed_password)
        cat=await publish(c,school,upload())
        assert (await bind(c,school,await batch(c,school),cat)).status_code==200
        draft=await create_draft(c,student,program={'catalog_id':cat['id'],'code':'0007'})
        tid=draft['id']
        await attach_files(c,student,tid)
        sent=await c.post(f'/api/v1/theses/{tid}:submit',headers=auth(student,'submit'),json={'version':draft['version']})
        assert sent.status_code==200
        old=sent.json()['data']['current_version']
        url=f'/api/v1/school-review/theses/{tid}:confirm-anonymization'
        body={'decision':'REJECT','reason':'虚构退回','version':sent.json()['data']['version']}
        other=await login(c,'school.wang',rt.seed_password)
        assert (await c.post(url,headers=auth(other,'cross'),json=body)).status_code==404
        assert (await c.post(url,headers=auth(school,'stale'),json={**body,'version':draft['version']})).status_code==409
        returned=await c.post(url,headers=auth(school,'return'),json=body)
        assert returned.status_code==200,returned.text
        new=returned.json()['data']['current_version']
        assert new['id']!=old['id'] and new['school_program']==old['school_program']
        assert sorted((f['purpose'],f['file_id']) for f in new['files'])==sorted((f['purpose'],f['file_id']) for f in old['files'])
        assert new['is_editable'] and all(new[k]==old[k] for k in ('title','abstract','keywords','discipline_code','discipline_name'))
        replay=await c.post(url,headers=auth(school,'return'),json=body)
        assert replay.status_code==200 and replay.json()['data']['current_version']['id']==new['id']
        assert (await c.post(url,headers=auth(school,'repeat'),json=body)).status_code==409
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,verified_access_claims(school['access_token']))
            assert await s.scalar(text('SELECT count(*) FROM thesis_versions WHERE thesis_id=:tid'),{'tid':tid})==2
            assert await s.scalar(text('SELECT is_editable FROM thesis_versions WHERE id=:id'),{'id':old['id']}) is False
            assert await s.scalar(text("SELECT count(*) FROM workflow_events WHERE thesis_id=:tid AND action='reject_anonymization'"),{'tid':tid})==1
        # A second genuine submission freezes the new version; a later return should work again.
        resubmit=await c.post(f'/api/v1/theses/{tid}:submit',headers=auth(student,'resubmit'),
                              json={'version':returned.json()['data']['version']})
        assert resubmit.status_code==200,resubmit.text
        again=await c.post(url,headers=auth(school,'return2'),json={**body,'version':resubmit.json()['data']['version']})
        assert again.status_code==200,again.text
        latest=again.json()['data']['current_version']
        assert latest['id'] not in (old['id'],new['id']) and latest['school_program']==new['school_program']


async def test_school_return_denies_direct_writes_and_rolls_back_on_abort():
    import pytest
    from sqlalchemy.exc import DBAPIError
    from uuid import UUID
    from app.modules.auth.deps import CurrentUser
    from app.modules.thesis.service import ConfirmInput, confirm_anonymization

    async with acceptance_environment('operations') as rt:
      async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
        school=await login(c,'pilot.school',rt.seed_password)
        student=await login(c,'pilot.student',rt.seed_password)
        draft=await create_draft(c,student)
        tid=draft['id']
        await attach_files(c,student,tid)
        sent=await c.post(f'/api/v1/theses/{tid}:submit',headers=auth(student,'send'),json={'version':draft['version']})
        assert sent.status_code==200
        original=sent.json()['data']
        claims=verified_access_claims(school['access_token'])
        # The runtime role cannot install/invoke the trigger or change frozen content.
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,claims)
            assert not await s.scalar(text("SELECT has_function_privilege(current_user,'clone_on_school_return()','EXECUTE')"))
            rows=await s.execute(text("UPDATE thesis_versions SET title='篡改' WHERE thesis_id=:tid RETURNING id"),{'tid':tid})
            assert not rows.all()
        # Even an otherwise valid row transition must not clone without a fresh, matching event.
        async def denied(sql):
            async with rt.session_factory() as s:
                await bind_candidate_identity(s,claims)
                with pytest.raises(DBAPIError) as caught:
                    await s.execute(text(sql),{'tid':tid})
                assert caught.value.orig.sqlstate=='42501'
        stage_sql="UPDATE theses SET stage='DRAFT',return_reason='测试退回',version=version+1 WHERE id=:tid"
        await denied(stage_sql)
        # A prior actor-matching event, committed while the paper was still PREPARING, is not authority.
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,claims)
            await s.execute(text("""INSERT INTO workflow_events(id,tenant_id,thesis_id,from_stage,to_stage,action,actor_id,reason,payload)
                SELECT gen_random_uuid(),tenant_id,id,'PREPARING','DRAFT','reject_anonymization',app_actor_id(),'测试退回',
                jsonb_build_object('source_version_id',current_version_id) FROM theses WHERE id=:tid"""),{'tid':tid})
            await s.commit()
        await denied(stage_sql)
        await denied("""INSERT INTO thesis_versions(id,thesis_id,tenant_id,version_no,title,abstract,discipline_code,discipline_name,keywords,is_editable)
            SELECT gen_random_uuid(),thesis_id,tenant_id,version_no+1,'篡改',abstract,discipline_code,discipline_name,keywords,true
            FROM thesis_versions WHERE thesis_id=:tid""")
        await denied("""INSERT INTO thesis_version_files(id,thesis_id,tenant_id,thesis_version_id,file_id,purpose)
            SELECT gen_random_uuid(),thesis_id,tenant_id,thesis_version_id,file_id,'anonymous'
            FROM thesis_version_files WHERE thesis_id=:tid AND purpose='original'""")
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,claims)
            actor=CurrentUser(id=claims.user_id,role=claims.role,tenant_id=claims.tenant_id,data_scope={})
            changed=await confirm_anonymization(s,actor,UUID(tid),ConfirmInput(decision='REJECT',reason='测试退回',version=original['version']),None)
            assert str(changed.current_version_id)!=original['current_version']['id']
            # A compromised SQL caller must not manufacture another copy by replaying the
            # same event against an earlier pointer inside this still-open transaction.
            await s.execute(text("UPDATE theses SET stage='PREPARING',current_version_id=:frozen WHERE id=:tid"),
                            {'tid':tid,'frozen':original['current_version']['id']})
            with pytest.raises(DBAPIError) as repeated:
                await s.execute(text(stage_sql),{'tid':tid})
            assert repeated.value.orig.sqlstate=='42501'
            await s.rollback()
        async with rt.session_factory() as s:
            await bind_candidate_identity(s,claims)
            assert await s.scalar(text('SELECT count(*) FROM thesis_versions WHERE thesis_id=:tid'),{'tid':tid})==1
            assert await s.scalar(text('SELECT count(*) FROM thesis_version_files WHERE thesis_id=:tid'),{'tid':tid})==2
        detail=(await c.get('/api/v1/theses/'+tid,headers=auth(student))).json()['data']
        assert detail['stage']=='PREPARING' and detail['version']==original['version']
        assert detail['current_version']==original['current_version']

        # A service started before the matching migration must fail closed, not leave a frozen DRAFT.
        from tests.test_rule_snapshot_migration import migrate
        down=migrate(rt.schema,'downgrade','0028_school_programs')
        assert down.returncode==0,down.stderr[-500:]
        fail=await c.post(f'/api/v1/school-review/theses/{tid}:confirm-anonymization',headers=auth(school,'no-schema'),
                          json={'decision':'REJECT','reason':'未迁移演练','version':original['version']})
        assert fail.status_code==503
        after=(await c.get('/api/v1/theses/'+tid,headers=auth(student))).json()['data']
        assert (after['stage'],after['version'],after['current_version'])==('PREPARING',original['version'],original['current_version'])


async def test_recovery_preserves_school_program_choices_and_pin():
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from scripts.recovery_drill import OwnedResources,backup_owned_resources,restore_owned_resources
    owned=None
    def guard(stage):
        if owned: owned.assert_cleanup_stage(stage)
    async with acceptance_environment('operations',cleanup_guard=guard,strict_cleanup=True) as rt:
        owned=OwnedResources.capture(rt)
        async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
            school=await login(c,'pilot.school',rt.seed_password); student=await login(c,'pilot.student',rt.seed_password)
            cat=await publish(c,school,upload('虚构恢复专业'))
            assert (await bind(c,school,await batch(c,school),cat)).status_code==200
            draft=await create_draft(c,student,program={'catalog_id':cat['id'],'code':'0007'})
        with TemporaryDirectory(prefix='program-recovery-') as tmp:
            archive=Path(tmp)
            manifest=backup_owned_resources(owned,archive)
            for table in ('school_program_catalogs','school_batch_programs','thesis_program_choices'):
                assert manifest['tables'][table]['count']==1
            await rt.engine.dispose();await rt.auth_engine.dispose()
            restore_owned_resources(owned,manifest,archive)
            assert owned.schema_oid!=manifest['schema_oid']
            async with AsyncClient(transport=ASGITransport(app=rt.app),base_url='http://test') as c:
                school=await login(c,'pilot.school',rt.seed_password)
                detail=(await c.get('/api/v1/school-review/theses/'+draft['id'],headers=auth(school))).json()['data']
                assert detail['current_version']['school_program']==draft['current_version']['school_program']
