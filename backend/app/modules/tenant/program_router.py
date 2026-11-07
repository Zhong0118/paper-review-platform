from uuid import UUID
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.core.response import ok
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.tenant import programs as service

router=APIRouter(prefix='/api/v1',tags=['school-programs'])
school=require_roles('school_reviewer')
student=require_roles('student')


@router.get('/school-admin/program-catalogs')
async def catalogs(actor: CurrentUser=Depends(school),session: AsyncSession=Depends(get_session)):
    return ok(await service.catalogs(session,actor))


@router.post('/school-admin/program-catalogs:preview')
async def preview(body:service.ImportBody,actor: CurrentUser=Depends(school),session: AsyncSession=Depends(get_session)):
    report,_=await service.inspect(session,actor,body)
    return ok(report)


@router.post('/school-admin/program-catalogs:publish')
async def publish(body:service.PublishBody,request:Request,actor: CurrentUser=Depends(school),session: AsyncSession=Depends(get_session)):
    row=await service.publish(session,actor,body,request.state.request_id)
    await session.commit()
    return ok(row)


@router.put('/school-admin/batches/{batch_id}/program-catalog')
async def pin(batch_id:UUID,body:service.PinBody,request:Request,actor: CurrentUser=Depends(school),session: AsyncSession=Depends(get_session)):
    await service.pin(session,actor,batch_id,body,request.state.request_id)
    await session.commit()
    return ok({})


@router.get('/catalog/student-programs')
async def options(thesis_id:UUID|None=None,actor: CurrentUser=Depends(student),session: AsyncSession=Depends(get_session)):
    return ok(await service.options(session,actor,thesis_id))
