"""Frozen 0015 records for historical migration tests, independent of newer ORM fields."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.seed import seed_database
from tests.conftest import _test_url, isolated_runtime_roles


@asynccontextmanager
async def legacy_accepted_0015():
    with isolated_runtime_roles(revision='0015_rls_children') as roles:
        engine = create_async_engine(_test_url(), connect_args={'server_settings': {'search_path':roles.schema}})
        try:
            async with async_sessionmaker(engine)() as session:
                await seed_database(session)
                student = (await session.execute(text("""SELECT u.id, m.id AS member, m.tenant_id, e.review_batch_id
                    FROM users u JOIN tenant_user_memberships m ON m.user_id=u.id
                    JOIN student_eligibilities e ON e.student_membership_id=m.id
                    WHERE u.username='student.lin' LIMIT 1"""))).one()
                expert = await session.scalar(text("SELECT e.id FROM experts e JOIN users u ON e.user_id=u.id WHERE u.username='expert.zhou'"))
                ids = dict(thesis=uuid4(), version=uuid4(), round=uuid4(), task=uuid4(),
                           tenant=student.tenant_id, member=student.member, batch=student.review_batch_id,
                           expert=expert, user=student.id)
                await session.execute(text("""INSERT INTO theses
                    (id,tenant_id,student_membership_id,review_batch_id,stage,submission_source,version)
                    VALUES (:thesis,:tenant,:member,:batch,'UNDER_REVIEW','STUDENT',1)"""),ids)
                await session.execute(text("""INSERT INTO thesis_versions
                    (id,tenant_id,thesis_id,version_no,title,abstract,discipline_code,discipline_name,keywords,is_editable)
                    VALUES (:version,:tenant,:thesis,1,'Legacy anonymous','', '0812','计算机科学与技术','[]',false)"""),ids)
                await session.execute(text('UPDATE theses SET current_version_id=:version WHERE id=:thesis'),ids)
                for purpose in ('original','anonymous'):
                    values={**ids,'file':uuid4(),'link':uuid4(),'purpose':purpose}
                    await session.execute(text("""INSERT INTO file_objects
                        (id,tenant_id,thesis_id,upload_version_id,purpose,storage_key,original_filename,
                         content_type,size_bytes,sha256,scan_status,uploaded_by,completed_at)
                        VALUES (:file,:tenant,:thesis,:version,:purpose,:purpose,'legacy.pdf','application/pdf',0,'legacy','CLEAN',:user,now())"""), values)
                    await session.execute(text("""INSERT INTO thesis_version_files
                        (id,thesis_version_id,thesis_id,tenant_id,file_id,purpose)
                        VALUES (:link,:version,:thesis,:tenant,:file,:purpose)"""), values)
                await session.execute(text("""INSERT INTO review_rounds
                    (id,tenant_id,thesis_id,thesis_version_id,anonymous_title,round_no,status,discipline_code,discipline_name,version)
                    VALUES (:round,:tenant,:thesis,:version,'Legacy anonymous',1,'ACTIVE','0812','计算机科学与技术',1)"""),ids)
                await session.execute(text("""INSERT INTO expert_tasks (id,tenant_id,round_id,thesis_id,expert_id,status,invited_at,decided_at,version)
                    VALUES (:task,:tenant,:round,:thesis,:expert,'IN_REVIEW',now(),now(),1)"""),ids)
                await session.commit()
            yield SimpleNamespace(schema=roles.schema,task_id=str(ids['task']),thesis_id=str(ids['thesis']),roles=roles)
        finally:
            await engine.dispose()
