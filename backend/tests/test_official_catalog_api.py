import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login, submit_current_draft


@pytest.mark.asyncio
async def test_official_import_preview_replay_and_school_scoped_choices():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as c:
            admin = await login(c, 'admin.system', runtime.seed_password)
            school = await login(c, 'school.wang', runtime.seed_password)
            student = await login(c, 'student.lin', runtime.seed_password)
            preview = await c.post('/api/v1/system/catalog-import:preview', headers=auth(admin), json={})
            assert preview.status_code == 200
            info = preview.json()['data']
            assert info['institutions']['added'] == 3196
            assert (await c.post('/api/v1/system/catalog-import:apply', headers=auth(school), json={'fingerprint':info['fingerprint']})).status_code == 403
            done = await c.post('/api/v1/system/catalog-import:apply', headers=auth(admin), json={'fingerprint':info['fingerprint']})
            assert done.status_code == 200
            stale = await c.post('/api/v1/system/catalog-import:apply', headers=auth(admin), json={'fingerprint':info['fingerprint']})
            assert stale.status_code == 409
            again = (await c.post('/api/v1/system/catalog-import:preview', headers=auth(admin), json={})).json()['data']
            assert again['institutions']['added'] == again['institutions']['changed'] == 0
            assert (await c.post('/api/v1/system/catalog-import:apply', headers=auth(admin), json={'fingerprint':again['fingerprint']})).status_code == 200
            assert len((await c.get('/api/v1/system/tenants', headers=auth(admin))).json()['data']) == 2
            rows = (await c.get('/api/v1/catalog/disciplines', headers=auth(student))).json()['data']
            assert len(rows) == 184
            institutions = (await c.get('/api/v1/system/institutions?q=4111010001', headers=auth(admin))).json()['data']
            assert institutions[0]['name'] == '北京大学'
            payload = {'code':'4111010001','name':'错误名称','institution_code':'4111010001',
                'organization':{'external_id':'root','name':'虚构学院'},
                'reviewer':{'username':'official.school','display_name':'虚构审核','external_id':'staff','password':runtime.seed_password}}
            assert (await c.post('/api/v1/system/tenants',headers={**auth(admin),'Idempotency-Key':'wrong-official-name'},json=payload)).status_code==422
            payload['name']='北京大学'
            created_school = await c.post('/api/v1/system/tenants',headers={**auth(admin),'Idempotency-Key':'new-official-school'},json=payload)
            assert created_school.status_code==200
            assert created_school.json()['data']['institution_code']=='4111010001'
            assert created_school.json()['data']['name']=='北京大学'
            settings = (await c.get('/api/v1/school-admin/discipline-settings', headers=auth(school))).json()['data']
            assert settings['configured'] is False
            body = {'codes':['0101'], 'expected_version':settings['version']}
            saved = await c.put('/api/v1/school-admin/discipline-settings', headers=auth(school), json=body)
            assert saved.status_code == 200
            assert (await c.put('/api/v1/school-admin/discipline-settings', headers=auth(school), json=body)).status_code == 409
            choices = (await c.get('/api/v1/catalog/my-disciplines', headers=auth(student))).json()['data']
            assert [r['code'] for r in choices] == ['0101']
            assert (await c.put('/api/v1/school-admin/discipline-settings', headers=auth(student), json=body)).status_code == 403
            assert (await c.put('/api/v1/school-admin/discipline-settings', headers=auth(school), json={'codes':['fake'], 'expected_version':1})).status_code == 422
            async with runtime.session_factory() as s:
                await bind_candidate_identity(s, verified_access_claims(student['access_token']))
                result = await s.execute(text("UPDATE institution_catalog SET name='forged'"))
                assert result.rowcount == 0
                assert await s.scalar(text("SELECT count(*) FROM institution_catalog WHERE name='forged'")) == 0
                await s.rollback()
            async with runtime.session_factory() as s:
                await bind_candidate_identity(s, verified_access_claims(school['access_token']))
                with pytest.raises(DBAPIError):
                    await s.execute(text("UPDATE school_discipline_settings SET tenant_id=gen_random_uuid()"))
                await s.rollback()


@pytest.mark.asyncio
async def test_scope_rejects_new_selection_but_preserves_existing_draft_snapshot():
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as c:
            school = await login(c,'school.wang',runtime.seed_password)
            student = await login(c,'student.lin',runtime.seed_password)
            admin = await login(c,'admin.system',runtime.seed_password)
            tenants = (await c.get('/api/v1/system/tenants',headers=auth(admin))).json()['data']
            other_id = next(t['id'] for t in tenants if t['code']=='other-univ')
            provision = await c.post(f'/api/v1/system/tenants/{other_id}/reviewers',headers={**auth(admin),'Idempotency-Key':'catalog-other-reviewer'},json={
                'username':'other.school','display_name':'虚构外校审核','external_id':'catalog-other','password':runtime.seed_password})
            assert provision.status_code==200
            other = await login(c,'other.school',runtime.seed_password)
            draft = {'title':'虚构哲学论文','abstract':'虚构内容','discipline_code':'0101','discipline_name':'哲学','keywords':['伦理']}
            created = await c.post('/api/v1/theses',headers=auth(student),json=draft)
            assert created.status_code in {200,201}, created.text
            item = created.json()['data']
            assert (await c.put('/api/v1/school-admin/discipline-settings',headers=auth(school),json={'codes':['0812'],'expected_version':0})).status_code==200
            patched = await c.patch(f"/api/v1/theses/{item['id']}",headers=auth(student),json={**draft,'expected_content_revision':item['current_version']['content_revision'],'title':'保留历史学科'})
            assert patched.status_code==200
            wrong = await c.patch(f"/api/v1/theses/{item['id']}",headers=auth(student),json={**draft,'expected_content_revision':patched.json()['data']['current_version']['content_revision'],'discipline_code':'0201','discipline_name':'理论经济学'})
            assert wrong.status_code==422
            submit = await submit_current_draft(c, f"/api/v1/theses/{item['id']}:submit",headers=auth(student),json={'version':patched.json()['data']['version']})
            assert submit.status_code==422
            assert '本校' in submit.json()['message']
            assert (await c.get('/api/v1/school-admin/discipline-settings',headers=auth(other))).json()['data']['configured'] is False
            async with runtime.session_factory() as s:
                await bind_candidate_identity(s,verified_access_claims(other['access_token']))
                assert await s.scalar(text('SELECT count(*) FROM school_discipline_settings')) == 0
                result = await s.execute(text("UPDATE school_discipline_settings SET codes='[]'"))
                assert result.rowcount==0
