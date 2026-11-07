import csv
from io import StringIO

import pytest
from httpx import ASGITransport, AsyncClient

from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login

BASE = '/api/v1/platform-review'
COLUMNS = ['username','unit','title','discipline_codes','province_name','doctoral_supervisor',
           'masters_supervisor','research_directions','keywords','source_url','source_note']


def csv_bytes(*rows):
    out = StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode('utf-8-sig')


def row(username='expert.zhou', **changes):
    return {**dict.fromkeys(COLUMNS, ''), 'username': username, 'unit': '测试大学', 'title': '教授',
            'discipline_codes': '0812', 'province_name': '北京市', 'doctoral_supervisor': 'false',
            'masters_supervisor': 'true', 'research_directions': '自然语言处理', 'keywords': '机器学习;知识图谱',
            'source_url': 'https://example.edu.cn/profile', 'source_note': '人工核对的虚构验收资料', **changes}


@pytest.mark.asyncio
async def test_profile_fields_tristate_filters_and_role_boundaries():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            platform = await login(client, 'platform.chen', runtime.seed_password)
            headers = auth(platform)
            experts = (await client.get(BASE+'/experts', headers=headers)).json()['data']
            assert all('doctoral_supervisor' in e and e['doctoral_supervisor'] is None for e in experts)
            assert all(e['research_directions'] == [] and e['source_checked_at'] is None for e in experts)
            options = (await client.get(BASE+'/expert-options', headers=headers)).json()['data']
            assert '北京市' in options['provinces'] and len(options['provinces']) == 31
            template=await client.get(BASE+'/experts/import-template',headers=headers)
            assert template.status_code==200
            assert list(csv.reader(StringIO(template.content.decode('utf-8-sig'))))==[COLUMNS]
            zhou = next(e for e in experts if e['username'] == 'expert.zhou')
            body = dict(version=zhou['version'], unit='测试大学', title='教授', discipline_codes=['0812'],
                province_name='北京市', doctoral_supervisor=False, masters_supervisor=None,
                research_directions=['自然语言处理'], keywords=['机器学习'],
                source_url='https://example.edu.cn/profile', source_note='人工维护')
            changed = await client.patch(BASE+'/experts/'+zhou['id'], headers=headers, json=body)
            assert changed.status_code == 200, changed.text
            assert changed.json()['data']['doctoral_supervisor'] is False
            assert changed.json()['data']['source_checked_at'] is not None
            for params, names in [({'doctoral_supervisor':'false'}, ['expert.zhou']),
                                  ({'doctoral_supervisor':'unknown'}, ['expert.qian']),
                                  ({'doctoral_supervisor':'true'}, []),
                                  ({'province_name':'北京市','title':'教授','discipline_code':'0812','keyword':'机器学习','research_direction':'自然语言处理'}, ['expert.zhou']),
                                  ({'keyword':'机器'}, [])]:
                filtered = await client.get(BASE+'/experts', headers=headers, params=params)
                assert filtered.status_code == 200
                assert [e['username'] for e in filtered.json()['data']] == names
            assert (await client.get(BASE+'/experts',headers=headers,params={'keyword':'bad\x00value'})).status_code==422
            for updates in ({'discipline_codes':['NO_CODE']}, {'province_name':'自造省份'},
                            {'doctoral_supervisor':'false'}, {'keywords':['字']}, {'keywords':['字'*65]},
                            {'keywords':[str(i)+'标签' for i in range(21)]}, {'source_url':'javascript:alert(1)'},
                            {'source_checked_at':'2026-01-01T00:00:00Z'}, {'tenant_id':'forged'}, {'unit':'test\x00unit'}):
                bad = await client.patch(BASE+'/experts/'+zhou['id'], headers=headers, json={**body,'version':changed.json()['data']['version'],**updates})
                assert bad.status_code == 422, bad.text
            from tests.test_rule_snapshot_migration import migrate
            rejected=migrate(runtime.schema,'downgrade','0026_pdf_transforms')
            assert rejected.returncode!=0 and 'would discard expert profile data' in rejected.stderr
            for username in ('school.wang','student.lin','expert.zhou','supervisor.zhao','admin.system'):
                actor = await login(client, username, runtime.seed_password)
                denied = await client.get(BASE+'/experts',headers=auth(actor))
                assert denied.status_code == 403 and 'research_directions' not in denied.text
                assert (await client.patch(BASE+'/experts/'+zhou['id'],headers=auth(actor),json=body)).status_code == 403


async def preview(client, actor, *rows):
    response = await client.post(BASE+'/experts/import:preview', headers=auth(actor),
                                files={'file':('experts.csv',csv_bytes(*rows),'text/csv')})
    assert response.status_code == 200, response.text
    return response.json()['data']


async def apply(client, actor, data, key='apply-import'):
    return await client.post(BASE+'/experts/import:apply',headers=auth(actor,key),json={'preview_id':data['preview_id']})


def owner_engine(runtime):
    from sqlalchemy import create_engine
    from tests.conftest import _test_url
    return create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={runtime.schema}'})


async def other_platform(client,runtime):
    from sqlalchemy import text
    from uuid import uuid4
    engine=owner_engine(runtime)
    try:
        with engine.begin() as conn:
            uid=uuid4()
            conn.execute(text("INSERT INTO users(id,username,display_name,password_hash,status) SELECT :id,'platform.import.other','另一人工维护员',password_hash,'ACTIVE' FROM users WHERE username='platform.chen'"),{'id':uid})
            conn.execute(text("INSERT INTO user_role_assignments(id,user_id,role_id,tenant_id,data_scope) SELECT :id,:uid,id,NULL,'{}' FROM roles WHERE code='platform_reviewer'"),{'id':uuid4(),'uid':uid})
    finally: engine.dispose()
    return await login(client,'platform.import.other',runtime.seed_password)


@pytest.mark.asyncio
async def test_import_atomic_conflict_actor_binding_idempotency_and_noop():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            actor=await login(client,'platform.chen',runtime.seed_password)
            initial=(await client.get(BASE+'/experts',headers=auth(actor))).json()['data']
            pending=await preview(client,actor,row(),row('expert.qian',unit='第二测试大学'))
            assert pending['errors']==[] and len(pending['changes'])==2
            change=next(c for c in pending['changes'] if c['username']=='expert.zhou')
            assert change['diff']['doctoral_supervisor']=={'before':None,'after':False}
            other=await other_platform(client,runtime)
            assert (await apply(client,other,pending)).status_code==404
            conflict=await client.patch(BASE+'/experts/'+change['expert_id'],headers=auth(other),
                json={'version':change['version'],'unit':'并发维护大学','title':'教授','discipline_codes':['0812']})
            assert conflict.status_code==200,conflict.text
            failed=await apply(client,actor,pending)
            assert failed.status_code==409,failed.text
            after=(await client.get(BASE+'/experts',headers=auth(actor))).json()['data']
            assert next(e for e in after if e['username']=='expert.qian')==next(e for e in initial if e['username']=='expert.qian')
            fresh=await preview(client,actor,row(),row('expert.qian',unit='第二测试大学'))
            applied=await apply(client,actor,fresh,'fresh-import')
            assert applied.status_code==200,applied.text
            assert applied.json()['data']['updated_count']==2
            assert (await apply(client,actor,fresh,'fresh-import')).json()['data']==applied.json()['data']
            assert (await apply(client,actor,pending,'fresh-import')).status_code==409
            saved=(await client.get(BASE+'/experts',headers=auth(actor))).json()['data']
            for e in saved:
                previous=next(i for i in initial if i['id']==e['id'])
                for name in ('qualification_status','account_status','service_status','conflicts'): assert e[name]==previous[name]
            duplicate=await preview(client,actor,row(),row('expert.qian',unit='第二测试大学'))
            assert all(c['diff']=={} for c in duplicate['changes'])
            assert (await apply(client,actor,duplicate,'noop')).json()['data']['updated_count']==0
            assert (await client.get(BASE+'/experts',headers=auth(actor))).json()['data']==saved
            clear=await preview(client,actor,row(province_name='',doctoral_supervisor='',masters_supervisor='',research_directions='',keywords='',source_url='',source_note=''))
            assert clear['changes'][0]['diff']['province_name']=={'before':'北京市','after':None}
            assert (await apply(client,actor,clear,'clear')).status_code==200
            cleared=next(e for e in (await client.get(BASE+'/experts',headers=auth(actor))).json()['data'] if e['username']=='expert.zhou')
            assert cleared['province_name'] is None and cleared['doctoral_supervisor'] is None and cleared['keywords']==[]


@pytest.mark.asyncio
async def test_import_rejects_invalid_rows_files_expiry_and_protected_fields(monkeypatch):
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            actor=await login(client,'platform.chen',runtime.seed_password)
            invalid=await preview(client,actor,row(),row(),row('does.not.exist'),row('expert.qian',discipline_codes='NO_CODE'))
            assert len(invalid['errors'])>=3
            assert (await apply(client,actor,invalid)).status_code==409
            for bad in (row('expert.\x00zhou'),row(unit='=cmd()'),row(source_note='  +cmd'),row(title='@SUM(1)'),row(doctoral_supervisor='False'),row(keywords='字'),row(source_url='file:///tmp/private'),row(title='字'*129)):
                result=await preview(client,actor,bad)
                assert result['errors'],bad
                assert (await apply(client,actor,result,result['preview_id'])).status_code==409
            for raw in (b'username,qualification_status\nexpert.zhou,APPROVED',b'\xff\xff',b'x'*(1024*1024+1),csv_bytes(*[row() for _ in range(501)]),csv_bytes()):
                res=await client.post(BASE+'/experts/import:preview',headers=auth(actor),files={'file':('invalid.csv',raw,'text/csv')})
                assert res.status_code==422,res.text
            valid=await preview(client,actor,row())
            assert (await client.post(BASE+'/experts/import:apply',headers=auth(actor,'extra'),json={'preview_id':valid['preview_id'],'tenant_id':'forged'})).status_code==422
            from app.modules.expert import import_service
            from datetime import datetime,timedelta,timezone
            monkeypatch.setattr(import_service,'utcnow',lambda:datetime.now(timezone.utc)+timedelta(minutes=11))
            expired=await apply(client,actor,valid,'expired')
            assert expired.status_code==409 and 'diff' not in expired.text
            for name in ('school.wang','expert.zhou','admin.system','student.lin'):
                denied=await login(client,name,runtime.seed_password)
                assert (await client.post(BASE+'/experts/import:preview',headers=auth(denied),files={'file':('e.csv',csv_bytes(row()),'text/csv')})).status_code==403
                assert (await apply(client,denied,valid)).status_code==403


@pytest.mark.asyncio
async def test_import_rls_immutable_provenance_and_concurrent_batches():
    import asyncio
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            actor=await login(client,'platform.chen',runtime.seed_password)
            other=await other_platform(client,runtime)
            a=await preview(client,actor,row(),row('expert.qian'))
            b=await preview(client,other,row('expert.qian',title='副教授'),row(title='副教授'))
            for token,expected in ((actor,1),(other,1),(await login(client,'school.wang',runtime.seed_password),0),
                                   (await login(client,'expert.zhou',runtime.seed_password),0)):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session,verified_access_claims(token['access_token']))
                    assert await session.scalar(text('SELECT count(*) FROM expert_import_previews'))==expected
                    assert await session.scalar(text('SELECT count(*) FROM expert_import_previews WHERE id=:id'),{'id':a['preview_id']})==(1 if token==actor else 0)
            for sql in ("UPDATE expert_import_previews SET canonical_changes='[]'",'DELETE FROM expert_import_previews'):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session,verified_access_claims(actor['access_token']))
                    with pytest.raises(DBAPIError): await session.execute(text(sql))
                    await session.rollback()
            results=await asyncio.wait_for(asyncio.gather(apply(client,actor,a,'concurrent-a'),apply(client,other,b,'concurrent-b')),10)
            assert sorted(r.status_code for r in results)==[200,409]
            saved=(await client.get(BASE+'/experts',headers=auth(actor))).json()['data']
            assert all(e['version']==2 for e in saved)
            assert len({e['title'] for e in saved})==1
            winner=actor if results[0].status_code==200 else other
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session,verified_access_claims(winner['access_token']))
                with pytest.raises(DBAPIError):
                    await session.execute(text("UPDATE expert_import_previews SET status='READY' WHERE status='APPLIED'"))
                await session.rollback()
            engine=owner_engine(runtime)
            try:
                with engine.connect() as conn:
                    audits=conn.execute(text("SELECT detail FROM audit_events WHERE action='expert.import'")).scalars().all()
                    assert len(audits)==2
                    assert '测试大学' not in str(audits) and 'example.edu' not in str(audits)
            finally: engine.dispose()


@pytest.mark.asyncio
async def test_import_profile_owned_recovery_and_populated_downgrade_refusal():
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from scripts.recovery_drill import OwnedResources,backup_owned_resources,restore_owned_resources
    from tests.test_rule_snapshot_migration import migrate
    owned=None
    def guard(stage):
        if owned: owned.assert_cleanup_stage(stage)
    async with acceptance_environment('empty',cleanup_guard=guard,strict_cleanup=True) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            actor=await login(client,'platform.chen',runtime.seed_password)
            pending=await preview(client,actor,row())
            result=await apply(client,actor,pending)
            assert result.status_code==200
            saved=(await client.get(BASE+'/experts',headers=auth(actor))).json()['data']
            rejected=migrate(runtime.schema,'downgrade','0026_pdf_transforms')
            assert rejected.returncode!=0 and 'would discard expert import provenance' in rejected.stderr
            owned=OwnedResources.capture(runtime)
            with TemporaryDirectory(prefix='paper-review-e09-restore-') as directory:
                bundle=backup_owned_resources(owned,Path(directory))
                assert bundle['tables']['expert_import_previews']['count']==1
                for name in ('experts','expert_import_previews'): assert len(bundle['tables'][name]['content_sha256'])==64
                await runtime.engine.dispose();await runtime.auth_engine.dispose()
                restore_owned_resources(owned,bundle,Path(directory))
                actor=await login(client,'platform.chen',runtime.seed_password)
                assert (await client.get(BASE+'/experts',headers=auth(actor))).json()['data']==saved
                assert (await apply(client,actor,pending)).json()['data']==result.json()['data']


def test_expert_profile_migration_roundtrip():
    from tests.conftest import isolated_runtime_roles
    from tests.test_rule_snapshot_migration import migrate
    with isolated_runtime_roles(revision='0026_pdf_transforms') as roles:
        for direction,target in [('upgrade','0027_expert_profiles'),('downgrade','0026_pdf_transforms'),('upgrade','0027_expert_profiles')]:
            result=migrate(roles.schema,direction,target,roles)
            assert result.returncode==0,result.stderr
