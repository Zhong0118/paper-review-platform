from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import hash_password
from app.modules.audit import service as audit
from app.modules.auth.deps import CurrentUser
from app.modules.expert.models import Expert, ExpertConflict
from app.modules.expert.schema import ExpertView, CreateExpertInput
from app.modules.tenant.models import DisciplineCatalog, Tenant
from app.modules.tenant.catalog_data import official_bundle
from app.modules.user.models import User, Role, UserRoleAssignment


PROFILE_FIELDS = ('unit','title','discipline_codes','province_name','doctoral_supervisor',
                  'masters_supervisor','research_directions','keywords','source_url','source_note')


def provinces():
    return sorted({item['province'] for item in official_bundle()['institutions']})


async def validate_profile(session, body):
    await validate_codes(session,body.discipline_codes)
    if body.province_name is not None and body.province_name not in provinces():
        raise AppError('VALIDATION_FAILED',422,'省份必须选自官方院校目录')


async def views(session: AsyncSession, expert_id: UUID | None = None, **filters) -> list[dict]:
    stmt=select(Expert,User.username,User.display_name,User.status).join(User,User.id==Expert.user_id)
    if expert_id: stmt=stmt.where(Expert.id==expert_id)
    for name,value in filters.items():
        if value is None: continue
        if '\x00' in value: raise AppError('VALIDATION_FAILED',422,'筛选条件不能包含空字符')
        if name in ('doctoral_supervisor','masters_supervisor'):
            stmt=stmt.where(getattr(Expert,name).is_(None if value=='unknown' else value=='true'))
        elif name in ('keyword','research_direction','discipline_code'):
            field={'keyword':'keywords','research_direction':'research_directions','discipline_code':'discipline_codes'}[name]
            stmt=stmt.where(getattr(Expert,field).contains([value]))
        else: stmt=stmt.where(getattr(Expert,name)==value)
    rows=(await session.execute(stmt.order_by(User.username))).all()
    conflicts=(await session.execute(select(ExpertConflict).order_by(ExpertConflict.kind,ExpertConflict.value))).scalars().all()
    return [ExpertView(id=e.id,user_id=e.user_id,username=username,display_name=name,account_status=status,
        **{name:getattr(e,name) for name in PROFILE_FIELDS},source_checked_at=e.source_checked_at,qualification_status=e.qualification_status,
        service_status=e.service_status,version=e.version,
        conflicts=[{'kind':c.kind,'value':c.value} for c in conflicts if c.expert_id==e.id]).model_dump(mode='json')
        for e,username,name,status in rows]


async def validate_codes(session, codes):
    found=set((await session.execute(select(DisciplineCatalog.code).where(
        DisciplineCatalog.code.in_(codes),DisciplineCatalog.is_active.is_(True)))).scalars())
    if found!=set(codes): raise AppError('VALIDATION_FAILED',422,'学科必须选自启用目录')


async def create(session: AsyncSession, actor: CurrentUser, body: CreateExpertInput, request_id):
    await validate_profile(session,body)
    role=(await session.execute(select(Role).where(Role.code=='expert'))).scalar_one()
    try:
        async with session.begin_nested():
            user=User(username=body.username,display_name=body.display_name,
                password_hash=hash_password(body.initial_password),status='ACTIVE',
                provisioned_by=actor.id,provisioned_tenant_id=None)
            session.add(user)
            await session.flush()
            expert=Expert(user_id=user.id,**{name:getattr(body,name) for name in PROFILE_FIELDS},
                          source_checked_at=datetime.now(timezone.utc),qualification_status='PENDING')
            session.add(expert)
            await session.flush()
            session.add(UserRoleAssignment(user_id=user.id,tenant_id=None,role_id=role.id,data_scope={}))
            await session.flush()
    except IntegrityError as exc:
        if getattr(exc.orig,'sqlstate',None)=='23505':
            raise AppError('RESOURCE_CONFLICT',409,'登录名已存在') from None
        raise
    await audit.record(session,user=actor,action='expert.create',object_type='expert',object_id=str(expert.id),request_id=request_id)
    return (await views(session,expert.id))[0]


async def change(session,actor,expert_id,body,action,request_id):
    expert=(await session.execute(select(Expert).where(Expert.id==expert_id).with_for_update()
                                  .execution_options(populate_existing=True))).scalar_one_or_none()
    if expert is None: raise AppError('RESOURCE_NOT_FOUND',404,'资源不存在或不可见')
    if body.version!=expert.version: raise AppError('VERSION_CONFLICT',409,'数据已变更，请刷新后重试')
    detail = {}
    if action=='profile':
        await validate_profile(session,body)
        fields=[name for name in PROFILE_FIELDS if name in body.model_fields_set]
        detail['changed_fields'] = [name for name in fields if getattr(expert,name)!=getattr(body,name)]
        for name in fields: setattr(expert,name,getattr(body,name))
        if detail['changed_fields']: expert.source_checked_at=datetime.now(timezone.utc)
    elif action in {'qualification', 'status'}:
        field = 'qualification_status' if action == 'qualification' else 'service_status'
        detail.update(before=getattr(expert, field), after=body.status, reason_provided=bool(body.reason.strip()))
        setattr(expert, field, body.status)
    else:
        pairs=sorted({(item.kind,item.value) for item in body.items})
        school_ids={UUID(value) for kind,value in pairs if kind=='TENANT_ID'}
        found=set((await session.execute(select(Tenant.id).where(Tenant.id.in_(school_ids)))).scalars()) if school_ids else set()
        if found!=school_ids: raise AppError('VALIDATION_FAILED',422,'回避学校不存在')
        previous = set((await session.execute(select(ExpertConflict.kind, ExpertConflict.value)
                       .where(ExpertConflict.expert_id == expert.id))).all())
        current = set(pairs)
        detail['conflicts'] = {
            kind: {label: sum(item[0] == kind for item in values)
                   for label, values in (('before', previous), ('after', current),
                                         ('added', current - previous), ('removed', previous - current))}
            for kind in ('TENANT_ID', 'SUPERVISOR_NAME')
        }
        await session.execute(delete(ExpertConflict).where(ExpertConflict.expert_id==expert.id))
        session.add_all([ExpertConflict(expert_id=expert.id,kind=kind,value=value) for kind,value in pairs])
    expert.version+=1
    detail['version'] = expert.version
    await audit.record(session,user=actor,action='expert.'+action,object_type='expert',object_id=str(expert.id),
                       request_id=request_id,detail=detail)
    await session.flush()
    return (await views(session,expert.id))[0]
