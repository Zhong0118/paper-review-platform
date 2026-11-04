from tests.helpers import submit_current_draft
from io import BytesIO
from types import SimpleNamespace

import pytest
from pypdf import PdfReader, PdfWriter

from app.modules.files import pdf
from app.modules.thesis.detector import run_anonymization_check
from tests.pdf_samples import pdf_bytes


def pages_pdf(*pages, author=''):
    writer = PdfWriter()
    for data in pages:
        writer.add_page(PdfReader(BytesIO(data)).pages[0])
    writer.add_metadata({'/Author': author})
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


VERSION = SimpleNamespace(title='匿名论文', abstract='', keywords=[])
ELIGIBILITY = SimpleNamespace(student_name='林知远', student_no='20260042', supervisor_name='赵文博')
FILE = SimpleNamespace(original_filename='anonymous.pdf')


def test_physical_pages_preserved_and_inspect_contract_compatible():
    raw = pages_pdf(pdf_bytes('封面 作者林知远 印刷页99'), pdf_bytes('附录 导师赵文博 印刷页一'), author='20260042')
    report = pdf.extract_pdf_pages(raw)
    assert [p['page_number'] for p in report['pages']] == [1, 2]
    assert '林知远' in report['pages'][0]['text'] and '赵文博' in report['pages'][1]['text']
    assert pdf.inspect_pdf(raw) == ('\n'.join(p['text'] for p in report['pages']), report['metadata'], report['uncertain'])
    conclusion, findings = run_anonymization_check(VERSION, ELIGIBILITY, FILE, raw)
    assert conclusion == 'FAIL'
    assert [f['page_number'] for f in findings if f['source'] == 'body'] == [1, 2]
    assert all(f['page_number'] is None for f in findings if f['source'] != 'body')
    assert all(len(f['context']) <= 120 and f['severity'] == 'BLOCK' for f in findings)


@pytest.mark.parametrize('sample', [pdf_bytes(blank=True), pdf_bytes(image=True), pdf_bytes(inline_image=True)], ids=['blank', 'image', 'inline-image'])
def test_uncertain_page_never_becomes_pass(sample):
    raw = pages_pdf(pdf_bytes('匿名论文'), sample)
    result = pdf.extract_pdf_pages(raw)
    assert result['pages'][0]['uncertain'] is False
    assert result['pages'][1]['uncertain'] is True
    assert result['uncertain'] is True
    assert run_anonymization_check(VERSION, ELIGIBILITY, FILE, raw)[0] == 'REVIEW_REQUIRED'


def test_normalized_identity_context_and_filename_have_exact_sources():
    raw = pages_pdf(pdf_bytes('前言 ' + '安全文字' * 60 + '赵 文\u200b博 ' + '后文' * 60))
    conclusion, findings = run_anonymization_check(VERSION, ELIGIBILITY, SimpleNamespace(original_filename='20260042.pdf'), raw)
    assert conclusion == 'FAIL'
    assert findings[0]['source'] == 'filename' and findings[0]['page_number'] is None
    body = next(f for f in findings if f['source'] == 'body')
    assert body['page_number'] == 1 and '赵 文' in body['context'] and len(body['context']) <= 120


def test_identity_split_across_pages_keeps_previous_failure_behavior():
    conclusion, findings = run_anonymization_check(VERSION, ELIGIBILITY, FILE, pages_pdf(pdf_bytes('作者 林知'), pdf_bytes('远')))
    assert conclusion == 'FAIL'
    assert any(f['matched_text'] == '林知远' and f['page_number'] == 1 for f in findings)


@pytest.mark.asyncio
async def test_school_terms_bound_reports_and_stale_confirmation():
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth, create_draft, attach_files
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            student, school = [await login(client, n, runtime.seed_password) for n in ('student.lin', 'school.wang')]
            settings = await client.get('/api/v1/school-admin/sensitive-terms', headers=auth(school))
            assert settings.status_code == 200
            assert settings.json()['data'] == {'version': 0, 'terms': []}
            saved = await client.put('/api/v1/school-admin/sensitive-terms', headers=auth(school), json={
                'expected_version': 0, 'terms': [{'text': '待核词', 'severity': 'WARN', 'description': '本校人工核对'}]})
            assert saved.status_code == 200, saved.text
            draft = await create_draft(client, student)
            await attach_files(client, student, draft['id'], anonymous_bytes=pages_pdf(pdf_bytes('匿名论文 待核词'), pdf_bytes('第二页')))
            detail = (await client.get('/api/v1/theses/'+draft['id'], headers=auth(student))).json()['data']
            file = next(f for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
            path = f"/api/v1/theses/{draft['id']}/sensitive-checks"
            report = await client.post(path, headers=auth(student), json={'expected_version': detail['version'], 'file_id': file['file_id']})
            assert report.status_code == 200, report.text
            data = report.json()['data']
            assert data['source_metadata']['terms_version'] == 1 and len(data['source_metadata']['file_sha256']) == 64
            assert any(f['kind'] == 'SCHOOL_TERM' and f['page_number'] == 1 for f in data['findings'])
            assert data['auto_conclusion'] == 'REVIEW_REQUIRED'
            submitted = (await submit_current_draft(client, f"/api/v1/theses/{draft['id']}:submit", headers=auth(student), json={'version': detail['version']})).json()['data']
            assert submitted['stage'] == 'PREPARING'
            no_reason = await client.post(f"/api/v1/school-review/theses/{draft['id']}:confirm-anonymization", headers=auth(school), json={'version': submitted['version'], 'decision':'PASS'})
            assert no_reason.status_code == 422
            changed = await client.put('/api/v1/school-admin/sensitive-terms', headers=auth(school), json={'expected_version': 1, 'terms': []})
            assert changed.status_code == 200
            confirm = f"/api/v1/school-review/theses/{draft['id']}:confirm-anonymization"
            response = await client.post(confirm, headers=auth(school), json={'version': submitted['version'], 'decision': 'PASS', 'reason': '已人工核验'})
            assert response.status_code == 409, response.text
            assert (await client.get('/api/v1/theses/'+draft['id'], headers=auth(student))).json()['data']['anonymization']['stale'] is True
            assert 'CONFIRM_ANONYMIZATION' not in (await client.get('/api/v1/theses/'+draft['id'], headers=auth(school))).json()['data']['allowed_actions']
            checked = await client.post(f"/api/v1/school-review/theses/{draft['id']}/sensitive-checks", headers=auth(school), json={'expected_version': submitted['version'], 'file_id': file['file_id']})
            assert checked.status_code == 200, checked.text
            response = await client.post(confirm, headers=auth(school), json={'version': submitted['version'], 'decision': 'PASS', 'reason': '重新核验'})
            assert response.status_code == 200, response.text


def test_literal_terms_and_title_are_not_semantic_or_regex_checks():
    from app.modules.thesis.detector import detect_sensitive
    raw = pdf_bytes('匿名论文 待核词 .*')
    inspected = pdf.extract_pdf_pages(raw)
    conclusion, findings, title = detect_sensitive(VERSION, ELIGIBILITY, FILE, raw, inspected,
        [{'text': '待核词', 'severity': 'WARN'}, {'text': '.*', 'severity': 'BLOCK'}])
    assert conclusion == 'FAIL' and title == 'FOUND'
    assert {f['matched_text'] for f in findings} == {'待核词', '.*'}
    other = SimpleNamespace(title='不同标题', abstract='', keywords=[])
    conclusion, findings, title = detect_sensitive(other, ELIGIBILITY, FILE, raw, inspected, [])
    assert conclusion == 'PASS' and title == 'TITLE_NOT_FOUND'
    assert findings[0]['severity'] == 'WARN' and findings[0]['page_number'] is None
    image = pdf_bytes(image=True)
    assert detect_sensitive(VERSION, ELIGIBILITY, FILE, image, pdf.extract_pdf_pages(image), [])[2] == 'NOT_CHECKED'


@pytest.mark.asyncio
async def test_terms_scope_races_and_report_input_freshness():
    import asyncio
    import json
    from uuid import UUID, uuid4
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from scripts.acceptance_server import acceptance_environment
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from tests.helpers import login, auth, create_draft, attach_files
    async with acceptance_environment('operations') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            actors = {n: await login(client, n, runtime.seed_password) for n in
                ('student.lin', 'school.wang', 'pilot.school', 'expert.zhou', 'platform.chen', 'admin.system', 'supervisor.zhao')}
            student, school = actors['student.lin'], actors['school.wang']
            settings = '/api/v1/school-admin/sensitive-terms'
            body = {'expected_version': 0, 'terms': [{'text': '待核词'}, {'text': '未命中隐藏词'}]}
            responses = await asyncio.gather(*[client.put(settings, headers=auth(school), json=body) for _ in range(2)])
            assert sorted(r.status_code for r in responses) == [200, 409]
            for terms in ([{'text': ' ' }], [{'text': '一'}], [{'text': '词条'}, {'text': ' 词条 '}],
                          [{'text': '词条', 'severity': 'UNKNOWN'}], [{'text': '字'*65}], [{'text': str(i)+'词'} for i in range(201)]):
                assert (await client.put(settings, headers=auth(school), json={'expected_version': 1, 'terms': terms})).status_code == 422
            for name, actor in actors.items():
                if name not in ('school.wang', 'pilot.school'):
                    assert (await client.get(settings, headers=auth(actor))).status_code == 403
                    assert (await client.put(settings, headers=auth(actor), json=body)).status_code == 403
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(actor['access_token']))
                    assert await session.scalar(text('SELECT count(*) FROM tenant_sensitive_terms')) == (1 if name == 'school.wang' else 0)
            assert (await client.get(settings, headers=auth(actors['pilot.school']))).json()['data']['terms'] == []
            draft = await create_draft(client, student)
            await attach_files(client, student, draft['id'], anonymous_bytes=pdf_bytes('匿名论文 待核词'))
            path = '/api/v1/theses/'+draft['id']
            detail = (await client.get(path, headers=auth(student))).json()['data']
            file = next(f for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
            payload = {'expected_version': detail['version'], 'file_id': file['file_id']}
            for name in ('pilot.school', 'expert.zhou', 'platform.chen', 'admin.system', 'supervisor.zhao'):
                assert (await client.post(path+'/sensitive-checks', headers=auth(actors[name]), json=payload)).status_code == 404
            for wrong in (str(uuid4()), next(f['file_id'] for f in detail['current_version']['files'] if f['purpose']=='original')):
                assert (await client.post(path+'/sensitive-checks', headers=auth(student), json={**payload,'file_id':wrong})).status_code == 404
            assert (await client.post(path+'/sensitive-checks', headers=auth(student), json={**payload,'expected_version':999})).status_code == 409
            checked = await client.post(path+'/sensitive-checks', headers=auth(student), json=payload)
            assert checked.status_code == 200, checked.text
            assert '未命中隐藏词' not in checked.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(student['access_token']))
                matched = await session.scalar(text('SELECT match_sensitive_terms(:t,:f,CAST(:s AS jsonb))'),
                    {'t':UUID(draft['id']),'f':UUID(file['file_id']),'s':json.dumps(['待核词'])})
                assert [t['text'] for t in matched['terms']] == ['待核词']
                assert await session.scalar(text("SELECT match_sensitive_terms(:t,:f,'[]')"), {'t':uuid4(),'f':UUID(file['file_id'])}) is None
            for name in ('expert.zhou', 'platform.chen', 'admin.system', 'supervisor.zhao', 'pilot.school'):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(actors[name]['access_token']))
                    assert await session.scalar(text('SELECT count(*) FROM anonymization_checks')) == 0
            version = detail['current_version']
            edited = await client.patch(path, headers=auth(student), json={"expected_content_revision":version["content_revision"], **{key: ('已编辑标题' if key=='title' else version[key]) for key in ('title','abstract','discipline_code','discipline_name','keywords')}})
            assert edited.status_code == 200, edited.text
            assert edited.json()['data']['anonymization']['stale'] is True
            assert (await client.post(path+'/sensitive-checks', headers=auth(student), json=payload)).status_code == 200
            await attach_files(client, student, draft['id'], anonymous_bytes=pdf_bytes('更换后的匿名论文'))
            detail = (await client.get(path, headers=auth(student))).json()['data']
            assert detail['anonymization']['stale'] is True
            assert (await client.post(path+'/sensitive-checks', headers=auth(student), json=payload)).status_code == 404


@pytest.mark.asyncio
async def test_terms_and_bound_reports_survive_owned_restore():
    from tempfile import TemporaryDirectory
    from pathlib import Path
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources
    from tests.helpers import login, auth, create_draft, attach_files
    owned = None
    def guard(stage):
        if owned is not None:
            owned.assert_cleanup_stage(stage)
    async with acceptance_environment('empty', cleanup_guard=guard, strict_cleanup=True) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            student, school = [await login(client, n, runtime.seed_password) for n in ('student.lin','school.wang')]
            saved = await client.put('/api/v1/school-admin/sensitive-terms', headers=auth(school), json={'expected_version':0,'terms':[{'text':'核对词'}]})
            assert saved.status_code == 200
            draft = await create_draft(client, student)
            await attach_files(client, student, draft['id'], anonymous_bytes=pdf_bytes('匿名论文 核对词'))
            path='/api/v1/theses/'+draft['id']
            detail=(await client.get(path,headers=auth(student))).json()['data']
            file=next(f for f in detail['current_version']['files'] if f['purpose']=='anonymous')
            payload={'expected_version':detail['version'],'file_id':file['file_id']}
            before=(await client.post(path+'/sensitive-checks',headers=auth(student),json=payload)).json()['data']
            owned=OwnedResources.capture(runtime)
            with TemporaryDirectory(prefix='paper-review-e07-restore-') as directory:
                archive=Path(directory)
                manifest=backup_owned_resources(owned,archive)
                assert manifest['tables']['tenant_sensitive_terms']['count'] == 1
                assert manifest['tables']['anonymization_checks']['count'] == 1
                await runtime.engine.dispose()
                await runtime.auth_engine.dispose()
                restore_owned_resources(owned,manifest,archive)
                student, school = [await login(client,n,runtime.seed_password) for n in ('student.lin','school.wang')]
                assert (await client.get('/api/v1/school-admin/sensitive-terms',headers=auth(school))).json()['data'] == saved.json()['data']
                after=(await client.get(path,headers=auth(student))).json()['data']['anonymization']
                assert after == before
                assert (await client.post(path+'/sensitive-checks',headers=auth(student),json=payload)).status_code == 200


def test_sensitive_migration_roundtrip_and_public_acl():
    from sqlalchemy import create_engine, text
    from tests.conftest import isolated_runtime_roles, _test_url
    from tests.test_rule_snapshot_migration import migrate
    with isolated_runtime_roles(revision='0024_expert_task_time_scope') as roles:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={roles.schema}'})
        try:
            for direction,target in [('upgrade','0025_sensitive_locations'),('downgrade','0024_expert_task_time_scope'),('upgrade','0025_sensitive_locations')]:
                result=migrate(roles.schema,direction,target,roles)
                assert result.returncode==0,result.stderr
                with engine.connect() as conn:
                    assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relkind='r' AND relname<>'alembic_version'")) is True
                    if direction=='upgrade':
                        assert conn.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='match_sensitive_terms(uuid,uuid,jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')")) is False
                        assert conn.scalar(text("SELECT has_function_privilege(:role,'match_sensitive_terms(uuid,uuid,jsonb)','EXECUTE')"),{'role':roles.business_role}) is True
                        assert conn.scalar(text("SELECT has_function_privilege(:role,'match_sensitive_terms(uuid,uuid,jsonb)','EXECUTE')"),{'role':roles.auth_role}) is False
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO tenants(id,name,code) VALUES('00000000-0000-0000-0000-000000000001','迁移测试','E07-MIGRATION')"))
                conn.execute(text("INSERT INTO tenant_sensitive_terms(id,tenant_id,terms,version) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','[]',1)"))
            result=migrate(roles.schema,'downgrade','0024_expert_task_time_scope',roles)
            assert result.returncode != 0 and 'would discard sensitive terms or bound reports' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT relforcerowsecurity FROM pg_class WHERE oid='tenant_sensitive_terms'::regclass")) is True
                assert conn.scalar(text('SELECT version_num FROM alembic_version'))=='0025_sensitive_locations'
        finally: engine.dispose()
