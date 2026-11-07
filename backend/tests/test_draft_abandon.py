"""BUG-08: exercise restricted HTTP and the actual PDF worker, retaining evidence."""
import asyncio
import hashlib
from pathlib import Path
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.db.rls_context import bind_candidate_identity, verified_access_claims
from scripts.acceptance_server import acceptance_environment
from tests.conftest import _test_url
from tests.helpers import attach_files, auth, create_draft, login
from tests.test_rule_snapshot_migration import migrate


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['uploaded', 'checked', 'READY', 'APPLIED', 'CANCELLED'])
async def test_abandon_draft_with_materials(state):
    async with acceptance_environment('empty') as runtime, AsyncClient(
        transport=ASGITransport(app=runtime.app, raise_app_exceptions=False), base_url='http://test'
    ) as client:
        student = await login(client, 'student.lin', runtime.seed_password)
        school = await login(client, 'school.wang', runtime.seed_password)
        headers = auth(student)
        draft = await create_draft(client, student)
        tid = UUID(draft['id'])
        path = '/api/v1/theses/' + str(tid)
        await attach_files(client, student, str(tid))
        detail = (await client.get(path, headers=headers)).json()['data']
        files = {f['purpose']: f['file_id'] for f in detail['current_version']['files']}
        version = detail['version']
        checked = state in ('checked', 'APPLIED')
        if checked:
            check = await client.post(path + '/sensitive-checks', headers=headers,
                json={'expected_version': version, 'file_id': files['anonymous']})
            assert check.status_code == 200, check.text
        operation_id = None
        grants = []
        async def issue(file_id, identity):
            result = await client.post(f'/api/v1/files/{file_id}:authorize-download', headers=auth(identity))
            assert result.status_code == 200
            return result.json()['data']['url']
        grants += [await issue(files['original'], student), await issue(files['anonymous'], school)]
        if state in ('READY', 'APPLIED', 'CANCELLED'):
            result = await client.post(path + '/pdf-transforms', headers=headers, json={
                'expected_version': version, 'purpose': 'anonymous', 'operation': 'EXTRACT',
                'sources': [{'file_id': files['anonymous'], 'pages': [1]}]})
            assert result.status_code == 200, result.text
            operation = result.json()['data']
            operation_id = UUID(operation['operation_id'])
            files['output'] = operation['new_file_id']
            grants.append(await issue(files['output'], student))
            if state != 'READY':
                command = 'apply' if state == 'APPLIED' else 'cancel'
                result = await client.post(f'/api/v1/pdf-transforms/{operation_id}:{command}',
                    headers={**headers,'If-Draft-Revision':detail['current_version']['content_revision']}, json={'expected_version': version})
                assert result.status_code == 200, result.text

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student['access_token']))
            rights = (await session.execute(text("""
                SELECT rolsuper, rolbypassrls, has_table_privilege('anonymization_checks','DELETE'),
                       has_table_privilege('pdf_transform_operations','DELETE')
                FROM pg_roles WHERE rolname=current_user
            """))).one()
            assert tuple(rights) == (False, False, False, False)
        deleted = await client.delete(path, headers=headers)
        assert deleted.status_code == 200, (state, deleted.status_code, deleted.text)
        assert (await client.get(path, headers=headers)).status_code == 404
        school_path = '/api/v1/school-review/theses'
        assert (await client.get(f'{school_path}/{tid}', headers=auth(school))).status_code == 404
        for listing, identity in [('/api/v1/theses', student), (school_path, school)]:
            result = await client.get(listing, headers=auth(identity))
            assert result.status_code == 200
            assert str(tid) not in result.text
        closeout = await client.get('/api/v1/school-admin/batches/' + draft['review_batch']['id'] + '/closeout',
                                   headers=auth(school))
        assert closeout.status_code == 200 and str(tid) not in closeout.text
        for url in grants:
            assert (await client.get(url)).status_code == 404
        for file_id in files.values():
            for identity in (student, school):
                assert (await client.get(f'/api/v1/files/{file_id}/content', headers=auth(identity))).status_code == 404
        if operation_id:
            for command in ('apply', 'cancel'):
                assert (await client.post(f'/api/v1/pdf-transforms/{operation_id}:{command}',
                    headers={**headers,'If-Draft-Revision':detail['current_version']['content_revision']}, json={'expected_version': version})).status_code == 404
        assert (await client.delete(path, headers=headers)).status_code == 404
        if checked or operation_id:
            for identity in (student, school):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(identity['access_token']))
                    for table, key in [('theses', 'id'), ('thesis_versions', 'thesis_id'), ('file_objects', 'thesis_id'),
                                       ('thesis_version_files', 'thesis_id'), ('pdf_transform_operations', 'thesis_id')]:
                        assert await session.scalar(text(f'SELECT count(*) FROM {table} WHERE {key}=:id'), {'id': tid}) == 0
                    changed = await session.execute(text('UPDATE theses SET draft_abandoned_at=NULL WHERE id=:id'), {'id': tid})
                    assert changed.rowcount == 0
                    if identity == student and state == 'READY':
                        # No WHERE/RETURNING: PostgreSQL need not invoke SELECT RLS.
                        changed = await session.execute(text("UPDATE pdf_transform_operations SET status='CANCELLED'"))
                        assert changed.rowcount == 0
                        changed = await session.execute(text('UPDATE file_objects SET upload_version_id=NULL, thesis_id=NULL'))
                        assert changed.rowcount == 0
        replacement = await create_draft(client, student)
        assert replacement['id'] != str(tid)

        # Administrative read, restricted to this temporary schema; never use it to perform DELETE.
        engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                               connect_args={'options': f'-c search_path={runtime.schema}'})
        try:
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM audit_events WHERE action='delete_draft' AND object_id=:id"),
                                   {'id': str(tid)}) == 1
                if checked:
                    assert conn.scalar(text('SELECT count(*) FROM anonymization_checks c JOIN thesis_versions v '
                        'ON v.id=c.thesis_version_id WHERE v.thesis_id=:id'), {'id': tid}) == 1
                    assert conn.scalar(text("SELECT count(*) FROM audit_events WHERE action='sensitive_check' AND object_id=:id"),
                                       {'id': str(tid)}) == 1
                if checked or operation_id:
                    rows = conn.execute(text('SELECT id,storage_key,sha256 FROM file_objects WHERE thesis_id=:id'), {'id': tid}).all()
                    assert {str(row.id) for row in rows} == set(files.values())
                    for row in rows:
                        assert hashlib.sha256(Path(row.storage_key).read_bytes()).hexdigest() == row.sha256
                if operation_id:
                    op = conn.execute(text('SELECT status, sources, new_file_id FROM pdf_transform_operations '
                        'WHERE id=:id AND thesis_id=:thesis'), {'id': operation_id, 'thesis': tid}).one()
                    assert (op.status, op.sources[0]['file_id'], str(op.new_file_id)) == (state, files['anonymous'], files['output'])
                    assert conn.scalar(text("SELECT count(*) FROM audit_events WHERE action='PDF_TRANSFORM_GENERATED' AND object_id=:id"),
                                       {'id': str(operation_id)}) == 1
        finally:
            engine.dispose()
        if state == 'READY':
            refused = migrate(runtime.schema, 'downgrade', '0032_review_draft_revision')
            assert refused.returncode != 0 and 'would resurrect abandoned drafts' in refused.stderr
            assert (await client.get(path, headers=headers)).status_code == 404
            assert (await client.get('/api/v1/theses/'+replacement['id'], headers=headers)).status_code == 200


@pytest.mark.asyncio
async def test_checked_draft_scope_and_submitted_history():
    async with acceptance_environment('operations') as runtime, AsyncClient(
        transport=ASGITransport(app=runtime.app), base_url='http://test'
    ) as client:
        owner = await login(client, 'student.lin', runtime.seed_password)
        other = await login(client, 'pilot.student', runtime.seed_password)
        school = await login(client, 'school.wang', runtime.seed_password)
        draft = await create_draft(client, owner)
        unrelated = await create_draft(client, other)
        path = '/api/v1/theses/' + draft['id']
        await attach_files(client, owner, draft['id'])
        detail = (await client.get(path, headers=auth(owner))).json()['data']
        source = next(f['file_id'] for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
        assert (await client.post(path+'/sensitive-checks', headers=auth(owner),
                                  json={'expected_version': detail['version'], 'file_id': source})).status_code == 200
        assert (await client.delete(path, headers=auth(other))).status_code == 404
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school['access_token']))
            with pytest.raises(DBAPIError) as denied:
                await session.execute(text('UPDATE theses SET draft_abandoned_at=now() WHERE id=:id'),
                                      {'id': UUID(draft['id'])})
            assert denied.value.orig.sqlstate == '42501'
        submitted = await client.post(path+':submit', headers=auth(owner), json={'version': detail['version'],
                                      'expected_content_revision': detail['current_version']['content_revision']})
        assert submitted.status_code == 200
        assert (await client.delete(path, headers=auth(owner))).status_code == 409
        back = await client.post(path+':withdraw', headers=auth(owner), json={'version': submitted.json()['data']['version']})
        assert back.status_code == 200 and back.json()['data']['stage'] == 'DRAFT'
        assert (await client.delete(path, headers=auth(owner))).status_code == 409
        assert (await client.get('/api/v1/theses/'+unrelated['id'], headers=auth(other))).status_code == 200


@pytest.mark.asyncio
async def test_transform_in_flight_cannot_rebind_abandoned_draft(monkeypatch):
    from threading import Event
    from app.modules.files import transform_runtime
    async with acceptance_environment('empty') as runtime, AsyncClient(
        transport=ASGITransport(app=runtime.app), base_url='http://test'
    ) as client:
        owner = await login(client, 'student.lin', runtime.seed_password)
        draft = await create_draft(client, owner)
        await attach_files(client, owner, draft['id'])
        path = '/api/v1/theses/' + draft['id']
        detail = (await client.get(path, headers=auth(owner))).json()['data']
        fid = next(f['file_id'] for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
        check = await client.post(path+'/sensitive-checks', headers=auth(owner),
                                  json={'expected_version': detail['version'], 'file_id': fid})
        assert check.status_code == 200
        entered, release = Event(), Event()
        actual_convert = transform_runtime.convert
        def paused(*args):
            entered.set()
            assert release.wait(15)
            return actual_convert(*args)
        monkeypatch.setattr(transform_runtime, 'convert', paused)
        generating = asyncio.create_task(client.post(path+'/pdf-transforms', headers=auth(owner), json={
            'expected_version': detail['version'], 'purpose': 'anonymous', 'operation': 'EXTRACT',
            'sources': [{'file_id': fid, 'pages': [1]}]}))
        try:
            assert await asyncio.to_thread(entered.wait, 8)
            assert (await asyncio.wait_for(client.delete(path, headers=auth(owner)), 5)).status_code == 200
        finally:
            release.set()
        assert (await generating).status_code == 404
        assert (await create_draft(client, owner))['id'] != draft['id']


def test_abandonment_migration_roundtrip_without_tombstones():
    from tests.conftest import isolated_runtime_roles
    with isolated_runtime_roles(revision='0032_review_draft_revision') as roles:
        for direction, target in [('upgrade','0033_abandoned_drafts'), ('downgrade','0032_review_draft_revision'),
                                  ('upgrade','0033_abandoned_drafts')]:
            result = migrate(roles.schema, direction, target, roles)
            assert result.returncode == 0, result.stderr


@pytest.mark.asyncio
@pytest.mark.parametrize('winner', ['submit', 'delete'])
async def test_checked_submit_and_abandon_serialize(winner):
    from app.core.exceptions import AppError
    from app.modules.auth.deps import CurrentUser
    from app.modules.thesis import service
    from tests.test_file_concurrency import wait_for_db_lock
    async with acceptance_environment('empty') as runtime, AsyncClient(
        transport=ASGITransport(app=runtime.app), base_url='http://test'
    ) as client:
        student = await login(client, 'student.lin', runtime.seed_password)
        draft = await create_draft(client, student)
        tid = UUID(draft['id'])
        await attach_files(client, student, str(tid))
        path = '/api/v1/theses/' + str(tid)
        detail = (await client.get(path, headers=auth(student))).json()['data']
        source = next(f['file_id'] for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
        check = await client.post(path+'/sensitive-checks', headers=auth(student),
                                  json={'expected_version': detail['version'], 'file_id': source})
        assert check.status_code == 200
        claims = verified_access_claims(student['access_token'])
        user = CurrentUser(claims.user_id, claims.role, claims.tenant_id, {})
        async with runtime.session_factory() as first, runtime.session_factory() as second:
            for session in (first, second):
                await bind_candidate_identity(session, claims)
            pid = await second.scalar(text('SELECT pg_backend_pid()'))
            if winner == 'delete':
                await service.delete_draft(first, user, tid)
                blocked = service.submit(second, user, tid, detail['version'], None, detail['current_version']['content_revision'])
            else:
                await service.submit(first, user, tid, detail['version'], None, detail['current_version']['content_revision'])
                blocked = service.delete_draft(second, user, tid)
            waiter = asyncio.create_task(blocked)
            try:
                await wait_for_db_lock(runtime.session_factory, pid)
                await first.commit()
                with pytest.raises(AppError) as error:
                    await asyncio.wait_for(waiter, 5)
                assert error.value.code == ('RESOURCE_NOT_FOUND' if winner == 'delete' else 'STATE_TRANSITION_DENIED')
            finally:
                waiter.cancel()
                await asyncio.gather(waiter, return_exceptions=True)


@pytest.mark.asyncio
async def test_abandon_waits_for_running_detector_and_retains_report(monkeypatch):
    from threading import Event
    from app.modules.auth.deps import CurrentUser
    from app.modules.thesis import sensitive_terms, service
    from tests.test_file_concurrency import wait_for_db_lock
    async with acceptance_environment('empty') as runtime, AsyncClient(
        transport=ASGITransport(app=runtime.app), base_url='http://test'
    ) as client:
        owner = await login(client, 'student.lin', runtime.seed_password)
        draft = await create_draft(client, owner)
        tid = UUID(draft['id'])
        path = '/api/v1/theses/' + str(tid)
        await attach_files(client, owner, str(tid))
        detail = (await client.get(path, headers=auth(owner))).json()['data']
        fid = next(f['file_id'] for f in detail['current_version']['files'] if f['purpose'] == 'anonymous')
        payload = {'expected_version': detail['version'], 'file_id': fid}
        entered, release = Event(), Event()
        real_extract = sensitive_terms.extract_pdf_pages
        def paused(*args):
            entered.set()
            assert release.wait(15)
            return real_extract(*args)
        monkeypatch.setattr(sensitive_terms, 'extract_pdf_pages', paused)
        detector = asyncio.create_task(client.post(path+'/sensitive-checks', headers=auth(owner), json=payload))
        try:
            assert await asyncio.to_thread(entered.wait, 8)
            claims = verified_access_claims(owner['access_token'])
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, claims)
                pid = await session.scalar(text('SELECT pg_backend_pid()'))
                user = CurrentUser(claims.user_id, claims.role, claims.tenant_id, {})
                waiting = asyncio.create_task(service.delete_draft(session, user, tid))
                try:
                    await wait_for_db_lock(runtime.session_factory, pid)
                    release.set()
                    assert (await detector).status_code == 200
                    await asyncio.wait_for(waiting, 6)
                    await session.commit()
                finally:
                    release.set()
                    waiting.cancel()
                    await asyncio.gather(waiting, return_exceptions=True)
        finally:
            release.set()
            await asyncio.gather(detector, return_exceptions=True)
        assert (await client.post(path+'/sensitive-checks', headers=auth(owner), json=payload)).status_code == 404
        assert (await create_draft(client, owner))['id'] != str(tid)
        engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                               connect_args={'options': f'-c search_path={runtime.schema}'})
        try:
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT count(*) FROM anonymization_checks c JOIN thesis_versions v '
                    'ON v.id=c.thesis_version_id WHERE v.thesis_id=:id'), {'id': tid}) == 1
        finally:
            engine.dispose()


async def test_abandoned_draft_entrypoints_match_absent_resource_and_do_not_block_archive():
    """Use real logins, one still-pending upload and one stored report, not arbitrary nonexistent IDs."""
    from tests.test_file_lifecycle import pending
    from uuid import uuid4
    async with acceptance_environment("operations") as rt, AsyncClient(transport=ASGITransport(app=rt.app),base_url="http://test") as c:
        users = {key: await login(c, name, rt.seed_password) for key,name in {
            "s":"student.lin","w":"school.wang","p":"platform.chen","t":"supervisor.zhao",
            "other":"pilot.student","e":"expert.zhou","admin":"admin.system"}.items()}
        owner = users["s"]
        h = auth(owner)
        draft = await create_draft(c, owner, title="仅供弃稿入口核对")
        tid = draft["id"]
        path = "/theses/"+tid
        school = "/school-review"+path
        mine = "/my"+path
        batch = "/school-admin/batches/"+draft["review_batch"]["id"]
        await attach_files(c,owner,tid)
        detail = (await c.get("/api/v1"+path,headers=h)).json()["data"]
        v = detail["current_version"]
        rev = v["content_revision"]
        fid = next(f["file_id"] for f in v["files"] if f["purpose"]=="anonymous")
        cmd = {"expected_version":1,"file_id":fid}
        assert (await c.post("/api/v1"+path+"/sensitive-checks",headers=h,json=cmd)).is_success
        pending_id = await pending(c,owner,tid)
        transform = {"expected_version":1,"purpose":"anonymous","operation":"EXTRACT","sources":[{"file_id":fid,"pages":[1]}]}
        op = (await c.post("/api/v1"+path+"/pdf-transforms",headers=auth(owner,"discard-preview"),json=transform)).json()["data"]
        assert (await c.delete("/api/v1"+path,headers=h)).status_code == 200
        patch = {k:v[k] for k in ("title","abstract","discipline_code","discipline_name","keywords")}
        ver = {"version":1}
        checks = [
            ("PATCH",path,"s",{**patch,"expected_content_revision":rev}), ("POST",path+":submit","s",{**ver,"expected_content_revision":rev}),
            ("POST",path+":withdraw","s",{**ver,"reason":"撤回"}), ("POST",path+"/sensitive-checks","s",cmd), ("POST",school+"/sensitive-checks","w",cmd),
            ("POST",school+":confirm-anonymization","w",{**ver,"decision":"PASS"}), ("POST",school+":confirm-dispatch","w",ver),
            ("POST",school+":terminate","w",{**ver,"reason":"复核"}), ("POST",school+":publish","w",ver),
            ("GET",school+"/progress","w",None), ("GET",school+"/results","w",None), ("GET",school+"/published-review.pdf","w",None),
            ("GET",mine+"/published-result","s",None), ("GET",mine+"/published-result","t",None),
            ("GET",mine+"/objections","s",None), ("POST",mine+"/objections","s",{"reason":"复核"}),
            ("GET",path,"other",None), ("GET","/platform-review/dispatch-candidates?thesis_id="+tid,"p",None),
            ("POST","/platform-review"+path+":assign","p",{"expert_id":str(uuid4())}),
            ("POST","/files:prepare-upload","s",{"thesis_id":tid,"purpose":"anonymous","filename":"sample.pdf"}),
            ("POST",f"/files/{pending_id}:complete","s",None), ("POST",f"/files/{pending_id}:complete-transform-source","s",None),
            ("POST",path+"/pdf-transforms","s",transform),
            ("POST","/pdf-transforms/"+op["operation_id"]+":apply","s",{"expected_version":1}),
            ("POST","/pdf-transforms/"+op["operation_id"]+":cancel","s",{"expected_version":1})]
        for file in [fid,pending_id,op["new_file_id"]]:
            for role in users:
                checks.extend([("GET",f"/files/{file}/content",role,None),("POST",f"/files/{file}:authorize-download",role,None)])
        for method,route,role,body in checks:
            headers = {**auth(users[role]),"If-Draft-Revision":rev}
            if route == path+"/pdf-transforms": headers["Idempotency-Key"]="discard-preview"
            result = await c.request(method,"/api/v1"+route,headers=headers,**({"json":body} if body else {}))
            assert (result.status_code,result.json()["code"]) == (404,"RESOURCE_NOT_FOUND"), (method,route,role,result.status_code,result.text[:150])
        assert (await c.put(f"/api/v1/files/{pending_id}/content",headers=h,content=b"attempt")).status_code == 404
        for role,route in [("s","/me/eligibility"),("s","/theses"),("w","/school-review/theses"),("w","/school-review/progress"),
                           ("w","/school-review/objections"),("p","/platform-review/dispatch-queue"),("t","/supervisor/theses/published"),
                           ("w",batch+"/closeout"),("w",batch+"/eligibilities")]:
            r = await c.get("/api/v1"+route,headers=auth(users[role]))
            assert r.status_code == 200 and tid not in r.text and patch["title"] not in r.text, route
        for role,route in [("w","/school-review/dashboard"),("p","/platform-review/dashboard")]:
            cards = (await c.get("/api/v1"+route,headers=auth(users[role]))).json()["data"]["cards"]
            assert all(n in (0,None) for n in cards.values())
        for role in ("s","w"):
            async with rt.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(users[role]["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM anonymization_checks WHERE thesis_version_id=:vid"),{"vid":UUID(v["id"])}) == 0
                assert await session.scalar(text("SELECT match_sensitive_terms(:t,:f,'[]'::jsonb)"),{"t":UUID(tid),"f":UUID(fid)}) is None
        sh = auth(users["w"])
        rows = (await c.get("/api/v1/school-admin/batches", headers=sh)).json()["data"]
        row = next(b for b in rows if b["id"]==draft["review_batch"]["id"])
        for action in ("close-submissions","archive"):
            r = await c.post("/api/v1"+batch+":"+action,headers=auth(users["w"],action),json={"expected_version":row["version"]})
            assert r.status_code == 200
            row = r.json()["data"]
            if action=="close-submissions": assert "ARCHIVE" in row["allowed_actions"]
        assert row["status"]=="ARCHIVED"
