from pathlib import Path
from contextlib import asynccontextmanager
from types import SimpleNamespace
import asyncio,json,os,secrets,sys
root=next(parent for parent in Path(__file__).resolve().parents if (parent/'AGENTS.md').is_file()); scratch=root/'.superpowers/sdd/2026-10-29-post-commit-acceptance'
scratch.mkdir(parents=True,exist_ok=True)
password_file=scratch/'browser-password'
fd=os.open(password_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as stream:
    password=secrets.token_urlsafe(24);stream.write(password)
os.environ['SEED_PASSWORD']=password
sys.path.insert(0,str(root/'backend'))
from scripts import acceptance_server
from httpx import ASGITransport,AsyncClient
from tests.helpers import login,auth,create_draft,attach_files,ready_thesis
from tests.test_pdf_transforms import document
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from uuid import UUID,uuid4
from tests.conftest import _test_url
from app.modules.thesis.models import Thesis
from app.modules.tenant.models import ReviewBatch
from app.modules.user.models import StudentEligibility
def new_batch(runtime,label):
    engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={runtime.schema}'})
    try:
        with Session(engine) as session:
            original=session.get(Thesis,UUID(runtime.thesis_id))
            batch=session.get(ReviewBatch,original.review_batch_id)
            eligibility=session.scalar(select(StudentEligibility).where(StudentEligibility.student_membership_id==original.student_membership_id,StudentEligibility.review_batch_id==original.review_batch_id))
            def clone(model,source,**changes):
                values={c.name:getattr(source,c.name) for c in model.__table__.columns if c.name not in {'id','created_at','updated_at'}}
                row=model(id=uuid4(),**{**values,**changes});session.add(row);session.flush();return row
            added=clone(ReviewBatch,batch,code='e10-'+label,name='E10虚构验收-'+label)
            clone(StudentEligibility,eligibility,review_batch_id=added.id)
            session.commit()
    finally:engine.dispose()
original=acceptance_server.acceptance_environment
@asynccontextmanager
async def with_materials(scenario):
    async with original(scenario) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            student=await login(client,'student.lin',runtime.seed_password)
            new_batch(runtime,'materials')
            draft=await create_draft(client,student)
            await attach_files(client,student,draft['id'],anonymous_bytes=document('A1 Anonymous paper','A2 Research','A3 Conclusion'))
            (scratch/'extra.pdf').write_bytes(document('B1 Appendix'))
            new_batch(runtime,'ranking')
            _,school,ranking=await ready_thesis(client,SimpleNamespace(password=runtime.seed_password))
            sent=await client.post('/api/v1/school-review/theses/'+ranking['id']+':confirm-dispatch',headers=auth(school),json={'version':ranking['version']})
            assert sent.status_code==200
            platform=await login(client,'platform.chen',runtime.seed_password)
            experts=(await client.get('/api/v1/platform-review/experts',headers=auth(platform))).json()['data']
            ids={}
            for e in experts:
                fields={'version':e['version'],'unit':'虚构大学','title':'教授','discipline_codes':['0812']}
                if e['username']=='expert.zhou': fields.update(research_directions=['面向','多校','盲审','论文','提交','门禁'],keywords=['盲审','门禁'])
                result=await client.patch('/api/v1/platform-review/experts/'+e['id'],headers=auth(platform),json=fields)
                assert result.status_code==200
                ids[e['username']]=e['id']
                if e['username']=='expert.zhou':
                    conflict=await client.put('/api/v1/platform-review/experts/'+e['id']+'/conflicts',headers=auth(platform),json={'version':result.json()['data']['version'],'items':[{'kind':'SUPERVISOR_NAME','value':'赵文博'}]})
                    assert conflict.status_code==200
            for username,name,directions,keywords in [('rank.leading','候选甲教授',['论文','多校盲审'],['盲审','门禁']),('rank.secondary','候选乙教授',['盲审'],['门禁'])]:
                result=await client.post('/api/v1/platform-review/experts',headers=auth(platform,username),json={'username':username,'display_name':name,'initial_password':runtime.seed_password,'unit':'虚构大学','title':'教授','discipline_codes':['0812'],'research_directions':directions,'keywords':keywords})
                assert result.status_code==201
                expert=result.json()['data'];ids[username]=expert['id']
                result=await client.post('/api/v1/platform-review/experts/'+expert['id']+':review-qualification',headers=auth(platform),json={'version':expert['version'],'status':'APPROVED','reason':'虚构验收资料'})
                assert result.status_code==200
            (scratch/'browser-context.json').write_text(json.dumps({'schema':runtime.schema,'role_prefix':runtime.engine.url.username.rsplit('_',1)[0],'storage_root':str(runtime.storage_root),'thesis_id':draft['id'],'ranking_thesis_id':ranking['id'],'published_thesis_id':runtime.thesis_id,'task_id':runtime.task_id,'expert_ids':ids}))
        yield runtime
acceptance_server.acceptance_environment=with_materials
try:asyncio.run(acceptance_server.serve('published',8013))
except KeyboardInterrupt:pass
finally:password_file.unlink(missing_ok=True)
