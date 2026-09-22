from urllib.parse import urlparse, parse_qs
from uuid import UUID
import pytest
from sqlalchemy import select, func
from tests.conftest import test_schema, test_engine, db_session, client, seed
from tests.helpers import login, auth, create_draft, attach_files
from tests.test_dispatch import expert_id
from app.modules.audit.models import AuditEvent

@pytest.mark.asyncio
async def test_observed_download_token_is_general_login_token(client, db_session):
    student = await login(client,'student.lin')
    thesis = await create_draft(client,student)
    await attach_files(client,student,thesis['id'])
    detail=(await client.get('/api/v1/theses/'+thesis['id'],headers=auth(student))).json()['data']
    fid=detail['current_version']['files'][0]['file_id']
    before=(await db_session.execute(select(func.count()).select_from(AuditEvent))).scalar_one()
    grant=(await client.post(f'/api/v1/files/{fid}:authorize-download',headers=auth(student))).json()['data']
    token=parse_qs(urlparse(grant['url']).query)['token'][0]
    response=await client.get('/api/v1/me',headers={'Authorization':'Bearer '+token})
    assert response.status_code==200  # diagnostic: should not authenticate a general API
    assert (await client.get(grant['url'])).status_code==401  # advertised URL alone does not work
    assert (await client.get(f'/api/v1/files/{fid}/content',headers=auth(student))).status_code==200
    after=(await db_session.execute(select(func.count()).select_from(AuditEvent))).scalar_one()
    assert after==before  # diagnostic: file grant and read lack audit events

@pytest.mark.asyncio
async def test_observed_reused_file_breaks_expert_access(client):
    student=await login(client,'student.lin')
    school=await login(client,'school.wang')
    platform=await login(client,'platform.chen')
    expert=await login(client,'expert.zhou')
    thesis=await create_draft(client,student)
    await attach_files(client,student,thesis['id'])
    async def submit(t):
        r=await client.post(f"/api/v1/theses/{t['id']}:submit",headers=auth(student),json={'version':t['version']})
        assert r.status_code==200,r.text
        return r.json()['data']
    thesis=await submit(thesis)
    r=await client.post(f"/api/v1/theses/{thesis['id']}:withdraw",headers=auth(student),json={'version':thesis['version'],'reason':'改标题'})
    assert r.status_code==200,r.text
    thesis=await submit(r.json()['data'])
    r=await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",headers=auth(school),json={'version':thesis['version'],'decision':'PASS'})
    thesis=r.json()['data']
    r=await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",headers=auth(school),json={'version':thesis['version']})
    assert r.status_code==200,r.text
    eid=await expert_id(client,platform,thesis['id'],'zhou')
    r=await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",headers=auth(platform),json={'expert_id':eid})
    task=r.json()['data']['task']['id']
    assert (await client.post(f'/api/v1/expert/tasks/{task}:accept',headers=auth(expert))).status_code==200
    materials=(await client.get(f'/api/v1/expert/tasks/{task}/materials',headers=auth(expert))).json()['data']
    fid=materials['files'][0]['file_id']
    # ASGI test client propagates the server error, which would become HTTP 500.
    from sqlalchemy.exc import MultipleResultsFound
    with pytest.raises(MultipleResultsFound):
        await client.post(f'/api/v1/files/{fid}:authorize-download',headers=auth(expert))
