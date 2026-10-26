import hashlib
import hmac
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.response import ok
from app.db.session import get_session
from app.modules.audit import service as audit
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.expert import service
from app.modules.expert.schema import CreateExpertInput, UpdateExpertInput, QualificationInput, ServiceStatusInput, ConflictsInput
from app.modules.tenant.models import Tenant, DisciplineCatalog
from app.shared.enums import RoleCode

router = APIRouter(prefix='/api/v1/platform-review', tags=['expert-management'])
platform = require_roles(RoleCode.PLATFORM_REVIEWER)


@router.get('/experts')
async def experts(request: Request, actor: CurrentUser = Depends(platform), session: AsyncSession = Depends(get_session)):
    return ok(await service.views(session), request_id=getattr(request.state,'request_id',None))


@router.get('/expert-options')
async def options(request: Request, actor: CurrentUser = Depends(platform), session: AsyncSession = Depends(get_session)):
    schools=(await session.execute(select(Tenant.id,Tenant.name,Tenant.status).order_by(Tenant.name))).all()
    disciplines=(await session.execute(select(DisciplineCatalog.code,DisciplineCatalog.name)
                                       .where(DisciplineCatalog.is_active.is_(True)).order_by(DisciplineCatalog.code))).all()
    return ok({'schools':[{'id':str(i),'name':n,'status':s} for i,n,s in schools],
               'disciplines':[{'code':c,'name':n} for c,n in disciplines]},request_id=getattr(request.state,'request_id',None))


@router.post('/experts',status_code=201)
async def create_expert(body: CreateExpertInput, request: Request,
                        actor: CurrentUser = Depends(platform), session: AsyncSession = Depends(get_session),
                        key: str = Header(alias='Idempotency-Key',min_length=1,max_length=128,pattern=r'.*\S.*')):
    payload=body.model_dump()
    payload['initial_password']=hmac.new(get_settings().jwt_secret.encode(),body.initial_password.encode(),hashlib.sha256).hexdigest()
    cached=await audit.replay(session,actor,key,'expert-create',payload)
    if cached is not None: return ok(cached,request_id=getattr(request.state,'request_id',None))
    data=await service.create(session,actor,body,getattr(request.state,'request_id',None))
    await audit.remember(session,actor,key,'expert-create',payload,data,201)
    await session.commit()
    return ok(data,request_id=getattr(request.state,'request_id',None))


async def change(expert_id,body,action,request,actor,session):
    data=await service.change(session,actor,expert_id,body,action,getattr(request.state,'request_id',None))
    await session.commit()
    return ok(data,request_id=getattr(request.state,'request_id',None))


@router.patch('/experts/{expert_id}')
async def update(expert_id: UUID,body: UpdateExpertInput,request: Request,
                 actor: CurrentUser=Depends(platform),session: AsyncSession=Depends(get_session)):
    return await change(expert_id,body,'profile',request,actor,session)


@router.post('/experts/{expert_id}:review-qualification')
async def qualification(expert_id: UUID,body: QualificationInput,request: Request,
                        actor: CurrentUser=Depends(platform),session: AsyncSession=Depends(get_session)):
    return await change(expert_id,body,'qualification',request,actor,session)


@router.post('/experts/{expert_id}:set-service-status')
async def status(expert_id: UUID,body: ServiceStatusInput,request: Request,
                 actor: CurrentUser=Depends(platform),session: AsyncSession=Depends(get_session)):
    return await change(expert_id,body,'status',request,actor,session)


@router.put('/experts/{expert_id}/conflicts')
async def conflicts(expert_id: UUID,body: ConflictsInput,request: Request,
                    actor: CurrentUser=Depends(platform),session: AsyncSession=Depends(get_session)):
    return await change(expert_id,body,'conflicts',request,actor,session)
