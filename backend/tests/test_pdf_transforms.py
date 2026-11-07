from tests.helpers import submit_current_draft
from io import BytesIO

import pytest
from pypdf import PdfReader, PdfWriter

from app.modules.files import transform_worker
from tests.pdf_samples import pdf_bytes


def document(*texts, author='Identity'):
    writer = PdfWriter()
    for text in texts:
        writer.add_page(PdfReader(BytesIO(pdf_bytes(text))).pages[0])
    writer.add_metadata({'/Author': author})
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_real_pdf_merge_extract_delete_and_metadata():
    a, b = document('A1', 'A2'), document('B1')
    result = transform_worker.transform([a, b], 'MERGE', [[2, 1], [1]], 1000000)
    reader = PdfReader(BytesIO(result))
    assert [p.extract_text().strip() for p in reader.pages] == ['A2', 'A1', 'B1']
    assert not reader.metadata or not reader.metadata.author
    assert '/Metadata' not in reader.root_object
    extracted = transform_worker.transform([a], 'EXTRACT', [[2]], 1000000)
    assert PdfReader(BytesIO(extracted)).pages[0].extract_text().strip() == 'A2'
    deleted = transform_worker.transform([a], 'DELETE_PAGES', [[1]], 1000000)
    assert PdfReader(BytesIO(deleted)).pages[0].extract_text().strip() == 'A2'


@pytest.mark.parametrize('operation,pages', [('DELETE_PAGES', [1, 2]), ('EXTRACT', []),
    ('EXTRACT', [0]), ('EXTRACT', [3]), ('EXTRACT', [1, 1]), ('EXTRACT', [True]),
    ('UNKNOWN', [1])])
def test_invalid_page_plan_rejected(operation, pages):
    with pytest.raises(ValueError):
        transform_worker.transform([document('A1', 'A2')], operation, [pages], 1000000)


def test_active_content_encrypted_and_size_limits_rejected():
    writer = PdfWriter(clone_from=PdfReader(BytesIO(document('A1'))))
    writer.add_js('app.alert("unsafe")')
    output = BytesIO()
    writer.write(output)
    for data in (output.getvalue(), pdf_bytes(encrypt=True), b'not a pdf'):
        with pytest.raises(ValueError):
            transform_worker.transform([data], 'EXTRACT', [[1]], 1000000)
    with pytest.raises(ValueError):
        transform_worker.transform([document('A1')], 'EXTRACT', [[1]], 20)


def test_actual_docker_conversion_and_timeout_cleanup(monkeypatch):
    from app.modules.files import transform_runtime
    from app.core.exceptions import AppError
    result, count = transform_runtime.convert([document('A1', 'A2')], 'EXTRACT', [[2]], 1000000)
    assert count == 1
    assert PdfReader(BytesIO(result)).pages[0].extract_text().strip() == 'A2'
    monkeypatch.setattr(transform_runtime, 'TIMEOUT_SECONDS', 0.001)
    with pytest.raises(AppError) as error:
        transform_runtime.convert([document('A1')], 'EXTRACT', [[1]], 1000000)
    assert error.value.http_status == 422
    import subprocess
    running = subprocess.run(['docker', 'ps', '-aq', '--filter', 'label=paper-review.transform'], capture_output=True, text=True, check=True)
    assert running.stdout.strip() == ''


@pytest.mark.asyncio
async def test_two_phase_permissions_idempotency_and_stale_apply():
    import asyncio
    from uuid import uuid4
    from httpx import AsyncClient, ASGITransport
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth, create_draft, attach_files
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            student = await login(client, 'student.lin', runtime.seed_password)
            school = await login(client, 'school.wang', runtime.seed_password)
            draft = await create_draft(client, student)
            await attach_files(client, student, draft['id'], anonymous_bytes=document('A1', 'A2'))
            path = '/api/v1/theses/' + draft['id']
            async def detail():
                return (await client.get(path, headers=auth(student))).json()['data']
            def anonymous(d):
                return next(f for f in d['current_version']['files'] if f['purpose'] == 'anonymous')['file_id']
            before = await detail()
            source = anonymous(before)
            payload = {'expected_version': before['version'], 'purpose': 'anonymous', 'operation': 'EXTRACT',
                       'sources': [{'file_id': source, 'pages': [2]}]}
            created = await client.post(path + '/pdf-transforms', headers=auth(student, 'convert-1'), json=payload)
            assert created.status_code == 200, created.text
            operation = created.json()['data']
            assert operation['status'] == 'READY' and operation['page_count'] == 1
            assert anonymous(await detail()) == source
            preview = '/api/v1/files/' + operation['new_file_id'] + '/content'
            assert (await client.get(preview, headers=auth(student))).status_code == 200
            assert (await client.get(preview, headers=auth(school))).status_code == 404
            replay = await client.post(path + '/pdf-transforms', headers=auth(student, 'convert-1'), json=payload)
            assert replay.json()['data'] == operation
            assert (await client.post(path + '/pdf-transforms', headers=auth(student, 'convert-1'), json={**payload, 'operation': 'DELETE_PAGES'})).status_code == 409
            assert (await client.post(path + '/pdf-transforms', headers=auth(school), json=payload)).status_code == 404
            assert (await client.post(path + '/pdf-transforms', headers=auth(student), json={**payload, 'sources': [{'file_id': str(uuid4()), 'pages': [1]}]})).status_code == 404
            apply = '/api/v1/pdf-transforms/' + operation['operation_id'] + ':apply'
            responses = await asyncio.gather(*[client.post(apply, headers={**auth(student),'If-Draft-Revision':before['current_version']['content_revision']}, json={'expected_version': before['version']}) for _ in range(2)])
            assert [r.status_code for r in responses] == [200, 200]
            assert anonymous(await detail()) == operation['new_file_id']
            # Original bytes survive replacement; only bindings change.
            from sqlalchemy import text
            from app.db.rls_context import bind_candidate_identity, verified_access_claims
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(student['access_token']))
                from pathlib import Path
                stored = (await session.execute(text('SELECT storage_key FROM file_objects WHERE id=CAST(:id AS uuid)'), {'id': source})).scalar_one()
                assert Path(stored).read_bytes() == document('A1', 'A2')
            next_payload = {**payload, 'sources': [{'file_id': operation['new_file_id'], 'pages': [1]}]}
            pending = await client.post(path + '/pdf-transforms', headers=auth(student, 'convert-2'), json=next_payload)
            assert pending.status_code == 200, pending.text
            submitted = await submit_current_draft(client, path + ':submit', headers=auth(student), json={'version': before['version']})
            assert submitted.status_code == 200, submitted.text
            stale_apply = '/api/v1/pdf-transforms/' + pending.json()['data']['operation_id'] + ':apply'
            assert (await client.post(stale_apply, headers={**auth(student),'If-Draft-Revision':before['current_version']['content_revision']}, json={'expected_version': before['version']})).status_code == 409
            assert (await client.get('/api/v1/files/' + pending.json()['data']['new_file_id'] + '/content', headers=auth(student))).status_code == 404


@pytest.mark.asyncio
async def test_unbound_sources_cancel_rls_and_submit_during_conversion(monkeypatch):
    import asyncio
    from threading import Event
    from httpx import AsyncClient, ASGITransport
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from scripts.acceptance_server import acceptance_environment
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from app.modules.files import transform_runtime
    from tests.helpers import login, auth, create_draft, attach_files
    async with acceptance_environment('operations') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            actors={name:await login(client,name,runtime.seed_password) for name in ('student.lin','school.wang','pilot.student','platform.chen','expert.zhou','admin.system','supervisor.zhao')}
            student=actors['student.lin']
            draft=await create_draft(client,student)
            await attach_files(client,student,draft['id'],anonymous_bytes=document('A1','A2'))
            path='/api/v1/theses/'+draft['id']
            detail=(await client.get(path,headers=auth(student))).json()['data']
            source=next(f['file_id'] for f in detail['current_version']['files'] if f['purpose']=='anonymous')
            original=next(f['file_id'] for f in detail['current_version']['files'] if f['purpose']=='original')
            prepared=(await client.post('/api/v1/files:prepare-upload',headers=auth(student),json={'thesis_id':draft['id'],'purpose':'anonymous','filename':'B.pdf','content_type':'application/pdf'})).json()['data']
            await client.put(prepared['upload_url'],headers=auth(student),content=document('B1'))
            extra=prepared['file_id']
            assert (await client.post(f'/api/v1/files/{extra}:complete-transform-source',headers=auth(student))).status_code==200
            assert (await client.get(f'/api/v1/files/{extra}/content',headers=auth(student))).status_code==404
            assert (await client.post(f'/api/v1/files/{extra}:complete',headers={**auth(student),'If-Draft-Revision':detail['current_version']['content_revision']})).status_code == 409
            detail=(await client.get(path,headers=auth(student))).json()['data']
            assert next(f['file_id'] for f in detail['current_version']['files'] if f['purpose']=='anonymous')==source
            body={'expected_version':detail['version'],'purpose':'anonymous','operation':'MERGE','sources':[{'file_id':source,'pages':[2,1]},{'file_id':extra,'pages':[1]}]}
            merged=await client.post(path+'/pdf-transforms',headers=auth(student),json=body)
            assert merged.status_code==200,merged.text
            product=merged.json()['data']
            output=await client.get('/api/v1/files/'+product['new_file_id']+'/content',headers=auth(student))
            assert [p.extract_text().strip() for p in PdfReader(BytesIO(output.content)).pages]==['A2','A1','B1']
            for name,actor in actors.items():
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session,verified_access_claims(actor['access_token']))
                    assert await session.scalar(text('SELECT count(*) FROM pdf_transform_operations'))==(1 if name=='student.lin' else 0)
                    if name=='student.lin':
                        with pytest.raises(DBAPIError):
                            await session.execute(text("UPDATE pdf_transform_operations SET sources='[]'"))
                if name!='student.lin':
                    assert (await client.post(path+'/pdf-transforms',headers=auth(actor),json=body)).status_code==404
            assert (await client.post(path+'/pdf-transforms',headers=auth(student),json={**body,'sources':[{'file_id':original,'pages':[1]}]})).status_code==404
            grant=await client.post('/api/v1/files/'+product['new_file_id']+':authorize-download',headers=auth(student))
            assert grant.status_code==200
            cancelled=await client.post('/api/v1/pdf-transforms/'+product['operation_id']+':cancel',headers=auth(student),json={'expected_version':detail['version']})
            assert cancelled.status_code==200
            assert (await client.get(grant.json()['data']['url'])).status_code==404
            assert (await client.get('/api/v1/files/'+product['new_file_id']+'/content',headers=auth(student))).status_code==404
            assert (await client.post('/api/v1/pdf-transforms/'+product['operation_id']+':apply',headers={**auth(student),'If-Draft-Revision':detail['current_version']['content_revision']},json={'expected_version':detail['version']})).status_code==409
            started,release=Event(),Event()
            real_convert=transform_runtime.convert
            def paused(*args):
                started.set()
                assert release.wait(15)
                return real_convert(*args)
            monkeypatch.setattr(transform_runtime,'convert',paused)
            body={**body,'operation':'EXTRACT','sources':[{'file_id':source,'pages':[1]}]}
            pending=asyncio.create_task(client.post(path+'/pdf-transforms',headers=auth(student),json=body))
            try:
                assert await asyncio.to_thread(started.wait,5)
                submitted=await asyncio.wait_for(submit_current_draft(client, path+':submit',headers=auth(student),json={'version':detail['version']}),5)
                assert submitted.status_code==200,submitted.text
            finally:release.set()
            assert (await pending).status_code==409


@pytest.mark.asyncio
async def test_transform_report_and_owned_recovery():
    from tempfile import TemporaryDirectory
    from pathlib import Path
    from httpx import AsyncClient, ASGITransport
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources
    from tests.helpers import login, auth, create_draft, attach_files
    owned=None
    def guard(stage):
        if owned:owned.assert_cleanup_stage(stage)
    async with acceptance_environment('empty',cleanup_guard=guard,strict_cleanup=True) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            student=await login(client,'student.lin',runtime.seed_password)
            draft=await create_draft(client,student)
            await attach_files(client,student,draft['id'],anonymous_bytes=document('A1','A2'))
            path='/api/v1/theses/'+draft['id']
            detail=(await client.get(path,headers=auth(student))).json()['data']
            source=next(f['file_id'] for f in detail['current_version']['files'] if f['purpose']=='anonymous')
            old=await client.post(path+'/sensitive-checks',headers=auth(student),json={'expected_version':1,'file_id':source})
            assert old.status_code==200
            product=(await client.post(path+'/pdf-transforms',headers=auth(student),json={'expected_version':1,'purpose':'anonymous','operation':'DELETE_PAGES','sources':[{'file_id':source,'pages':[1]}]})).json()['data']
            applied=await client.post('/api/v1/pdf-transforms/'+product['operation_id']+':apply',headers={**auth(student),'If-Draft-Revision':detail['current_version']['content_revision']},json={'expected_version':1})
            assert applied.status_code==200,applied.text
            assert (await client.get(path,headers=auth(student))).json()['data']['anonymization']['stale'] is True
            checked=await client.post(path+'/sensitive-checks',headers=auth(student),json={'expected_version':1,'file_id':product['new_file_id']})
            assert checked.status_code==200
            assert checked.json()['data']['source_metadata']['file_sha256']!=old.json()['data']['source_metadata']['file_sha256']
            from tests.test_rule_snapshot_migration import migrate
            rejected=migrate(runtime.schema,'downgrade','0025_sensitive_locations')
            assert rejected.returncode!=0 and 'would discard PDF provenance' in rejected.stderr
            owned=OwnedResources.capture(runtime)
            with TemporaryDirectory(prefix='paper-review-e08-restore-') as directory:
                manifest=backup_owned_resources(owned,Path(directory))
                assert manifest['tables']['pdf_transform_operations']['count']==1
                assert len(manifest['tables']['pdf_transform_operations']['content_sha256'])==64
                assert len(manifest['files'])==3
                await runtime.engine.dispose();await runtime.auth_engine.dispose()
                restore_owned_resources(owned,manifest,Path(directory))
                student=await login(client,'student.lin',runtime.seed_password)
                after=(await client.get(path,headers=auth(student))).json()['data']
                assert after['anonymization']==checked.json()['data']
                assert next(f['file_id'] for f in after['current_version']['files'] if f['purpose']=='anonymous')==product['new_file_id']
                assert (await client.post('/api/v1/pdf-transforms/'+product['operation_id']+':apply',headers={**auth(student),'If-Draft-Revision':detail['current_version']['content_revision']},json={'expected_version':1})).json()['data']['status']=='APPLIED'


def test_container_enforces_limits_and_unavailable_runtime_fails_closed(monkeypatch):
    import json
    import subprocess
    from app.modules.files import transform_runtime
    from app.core.exceptions import AppError
    original=subprocess.run
    inspected=[]
    def run(command, **kwargs):
        if command[:3]==['docker','start','-a']:
            info=json.loads(original(['docker','inspect',command[3]],capture_output=True,text=True,check=True).stdout)[0]
            host=info['HostConfig']
            assert host['Memory']==536870912 and host['MemorySwap']==536870912
            assert host['NetworkMode']=='none' and host['ReadonlyRootfs'] is True
            assert host['CapDrop']==['ALL'] and host['SecurityOpt']==['no-new-privileges']
            assert info['Config']['User']=='65534:65534'
            # Docker inspect does not promise a presentation order for independent mounts.
            assert sorted((m['Destination'],m['RW']) for m in info['Mounts'])==[('/input',False),('/output',True)]
            assert all('paper-review-transform-' in m['Source'] for m in info['Mounts'])
            inspected.append(True)
        return original(command,**kwargs)
    monkeypatch.setattr(subprocess,'run',run)
    transform_runtime.convert([document('bounded')],'EXTRACT',[[1]],1000000)
    assert inspected
    monkeypatch.setattr(transform_runtime,'IMAGE','paper-review-pdf-worker:e08-missing-test-image')
    with pytest.raises(AppError) as error:
        transform_runtime.convert([document('bounded')],'EXTRACT',[[1]],1000000)
    assert error.value.http_status==503


def test_transform_migration_roundtrip():
    from tests.conftest import isolated_runtime_roles
    from tests.test_rule_snapshot_migration import migrate
    with isolated_runtime_roles(revision='0025_sensitive_locations') as roles:
        for direction,target in [('upgrade','0026_pdf_transforms'),('downgrade','0025_sensitive_locations'),('upgrade','0026_pdf_transforms')]:
            result=migrate(roles.schema,direction,target,roles)
            assert result.returncode==0,result.stderr
