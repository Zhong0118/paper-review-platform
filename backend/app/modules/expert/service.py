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
from app.modules.user.models import User, Role, UserRoleAssignment


async def views(session: AsyncSession, expert_id: UUID | None = None) -> list[dict]:
    stmt=select(Expert,User.username,User.display_name,User.status).join(User,User.id==Expert.user_id)
    if expert_id: stmt=stmt.where(Expert.id==expert_id)
    rows=(await session.execute(stmt.order_by(User.username))).all()
    conflicts=(await session.execute(select(ExpertConflict).order_by(ExpertConflict.kind,ExpertConflict.value))).scalars().all()
    return [ExpertView(id=e.id,user_id=e.user_id,username=username,display_name=name,account_status=status,
        unit=e.unit,title=e.title,discipline_codes=e.discipline_codes,qualification_status=e.qualification_status,
        service_status=e.service_status,version=e.version,
        conflicts=[{'kind':c.kind,'value':c.value} for c in conflicts if c.expert_id==e.id]).model_dump(mode='json')
        for e,username,name,status in rows]


async def validate_codes(session, codes):
    found=set((await session.execute(select(DisciplineCatalog.code).where(
        DisciplineCatalog.code.in_(codes),DisciplineCatalog.is_active.is_(True)))).scalars())
    if found!=set(codes): raise AppError('VALIDATION_FAILED',422,'学科必须选自启用目录')


async def create(session: AsyncSession, actor: CurrentUser, body: CreateExpertInput, request_id):
    await validate_codes(session,body.discipline_codes)
    role=(await session.execute(select(Role).where(Role.code=='expert'))).scalar_one()
    try:
        async with session.begin_nested():
            user=User(username=body.username,display_name=body.display_name,
                password_hash=hash_password(body.initial_password),status='ACTIVE',
                provisioned_by=actor.id,provisioned_tenant_id=None)
            session.add(user)
            await session.flush()
            expert=Expert(user_id=user.id,unit=body.unit,title=body.title,
                          discipline_codes=body.discipline_codes,qualification_status='PENDING')
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
        await validate_codes(session,body.discipline_codes)
        detail['changed_fields'] = [name for name in ('unit', 'title', 'discipline_codes')
                                    if getattr(expert, name) != getattr(body, name)]
        expert.unit,expert.title,expert.discipline_codes=body.unit,body.title,body.discipline_codes
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
