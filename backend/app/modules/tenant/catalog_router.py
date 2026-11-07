from fastapi import APIRouter, Depends, Request, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, require_roles
from app.shared.enums import RoleCode
from app.modules.tenant import catalog_service as service
from app.modules.tenant.models import InstitutionCatalog

router = APIRouter(prefix='/api/v1', tags=['official-catalogs'])
all_roles = require_roles(*list(RoleCode))
system = require_roles(RoleCode.SYSTEM_ADMIN)
school = require_roles(RoleCode.SCHOOL_REVIEWER)

class ApplyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')

class SettingsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    codes: list[str] = Field(max_length=500)
    expected_version: int = Field(strict=True,ge=0)

@router.get('/catalog/disciplines')
async def disciplines(request: Request, actor: CurrentUser=Depends(all_roles), session: AsyncSession=Depends(get_session)):
    return ok(await service.list_disciplines(session),request_id=request.state.request_id)

@router.get('/catalog/my-disciplines')
async def my_disciplines(request: Request, actor: CurrentUser=Depends(require_roles(RoleCode.STUDENT,RoleCode.SCHOOL_REVIEWER)), session: AsyncSession=Depends(get_session)):
    return ok(await service.list_disciplines(session,actor.tenant_id),request_id=request.state.request_id)

@router.get('/system/institutions')
async def institutions(request: Request, q: str=Query(default='',max_length=128), actor: CurrentUser=Depends(system), session: AsyncSession=Depends(get_session)):
    term = q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
    rows = (await session.scalars(select(InstitutionCatalog).where(InstitutionCatalog.is_active.is_(True),
        or_(InstitutionCatalog.code.ilike(f'%{term}%',escape='\\'),InstitutionCatalog.name.ilike(f'%{term}%',escape='\\')))
        .order_by(InstitutionCatalog.code).limit(100))).all()
    return ok([service.project(r,('code','name','province','city','level','kind','source_version')) for r in rows],request_id=request.state.request_id)

@router.post('/system/catalog-import:preview')
async def preview(request: Request, actor: CurrentUser=Depends(system), session: AsyncSession=Depends(get_session)):
    return ok(await service.preview(session),request_id=request.state.request_id)

@router.post('/system/catalog-import:apply')
async def apply(body: ApplyInput, request: Request, actor: CurrentUser=Depends(system), session: AsyncSession=Depends(get_session)):
    result = await service.apply_import(session,actor,body.fingerprint,request.state.request_id)
    await session.commit()
    return ok(result,request_id=request.state.request_id)

@router.get('/school-admin/discipline-settings')
async def settings(request: Request, actor: CurrentUser=Depends(school), session: AsyncSession=Depends(get_session)):
    return ok(await service.get_settings(session,actor.tenant_id),request_id=request.state.request_id)

@router.put('/school-admin/discipline-settings')
async def update_settings(body: SettingsInput, request: Request, actor: CurrentUser=Depends(school), session: AsyncSession=Depends(get_session)):
    result = await service.save_settings(session,actor,body.codes,body.expected_version,request.state.request_id)
    await session.commit()
    return ok(result,request_id=request.state.request_id)
