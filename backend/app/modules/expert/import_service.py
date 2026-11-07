"""Bounded CSV import of existing profiles; never fetches source URLs."""
import csv
from collections import Counter
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import StringIO
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select

from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.expert.import_models import ExpertImportPreview
from app.modules.expert.models import Expert
from app.modules.expert.schema import ProfileFields
from app.modules.expert.service import PROFILE_FIELDS, provinces
from app.modules.tenant.models import DisciplineCatalog
from app.modules.user.models import User

COLUMNS = ('username',*PROFILE_FIELDS)
MAX_BYTES = 1024*1024


def utcnow():
    return datetime.now(timezone.utc)


def parse_csv(raw):
    if len(raw)>MAX_BYTES:
        raise AppError('VALIDATION_FAILED',422,'CSV不得超过1 MiB')
    try:
        reader=csv.reader(StringIO(raw.decode('utf-8-sig'),newline=''),strict=True)
        if tuple(next(reader,()))!=COLUMNS:
            raise ValueError('CSV列必须与模板完全一致')
        rows=[]
        for values in reader:
            if len(values)!=len(COLUMNS): raise ValueError('CSV列数量与模板不一致')
            rows.append(dict(zip(COLUMNS,values)))
            if len(rows)>500: raise ValueError('每次最多导入500行')
        if not rows: raise ValueError('CSV至少包含一行专家资料')
        return rows
    except (UnicodeDecodeError,csv.Error,ValueError):
        raise AppError('VALIDATION_FAILED',422,'CSV须为UTF-8，列与模板一致，包含1–500行且格式完整') from None


def profile(row):
    if any(value.lstrip().startswith(('=','+','@')) for value in row.values()):
        raise ValueError('单元格不能以 =、+、@ 开头')
    fields={name:row[name].strip() for name in PROFILE_FIELDS}
    for name in ('doctoral_supervisor','masters_supervisor'):
        if fields[name] not in ('true','false',''): raise ValueError('导师资格只能填写true、false或留空')
        fields[name]={'true':True,'false':False,'':None}[fields[name]]
    for name in ('discipline_codes','research_directions','keywords'):
        fields[name]=fields[name].split(';') if fields[name] else []
    return ProfileFields(**fields)


async def preview(session,actor,raw):
    rows=parse_csv(raw)
    # Read once; only exact existing usernames can be targeted. No account creation.
    names=Counter(row['username'] for row in rows)
    experts={username:(expert,status) for expert,username,status in (await session.execute(
        select(Expert,User.username,User.status).join(User,User.id==Expert.user_id)
        .where(User.username.in_([name for name in names if '\x00' not in name])))).all()}
    codes=set((await session.scalars(select(DisciplineCatalog.code).where(DisciplineCatalog.is_active.is_(True)))).all())
    allowed_provinces=set(provinces())
    changes=[]
    errors=[]
    for number,row in enumerate(rows,2):
        try:
            if '\x00' in row['username']: raise ValueError('用户名不能包含空字符')
            if names[row['username']]>1: raise ValueError('同一用户名在文件中重复出现')
            if row['username'] not in experts: raise ValueError('用户名未精确匹配已有专家')
            body=profile(row)
            if not set(body.discipline_codes)<=codes: raise ValueError('学科须选自启用目录')
            if body.province_name is not None and body.province_name not in allowed_provinces:
                raise ValueError('省份须选自官方院校目录')
            expert,account_status=experts[row['username']]
            changes.append({'expert_id':str(expert.id),'username':row['username'],'version':expert.version,
                'qualification_status':expert.qualification_status,'service_status':expert.service_status,
                'account_status':account_status,
                'diff':{name:{'before':getattr(expert,name),'after':getattr(body,name)}
                        for name in PROFILE_FIELDS if getattr(expert,name)!=getattr(body,name)}})
        except ValidationError as exc:
            # Do not echo rejected values (a misplaced password/identity column may contain secrets).
            errors.append({'row':number,'message':'字段格式无效：'+', '.join(str(e['loc'][0]) for e in exc.errors())})
        except ValueError as exc:
            errors.append({'row':number,'message':str(exc)})
    pending=ExpertImportPreview(actor_id=actor.id,expires_at=utcnow()+timedelta(minutes=10),
        payload_hash=sha256(raw).hexdigest(),canonical_changes=changes,status='INVALID' if errors else 'READY')
    session.add(pending)
    await session.flush()
    return {'preview_id':str(pending.id),'expires_at':pending.expires_at.isoformat(),
            'changes':[{key:c[key] for key in ('expert_id','username','version','diff')} for c in changes],
            'errors':errors}


async def apply(session,actor,preview_id,request_id):
    pending=(await session.execute(select(ExpertImportPreview).where(ExpertImportPreview.id==preview_id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if pending is None: raise AppError('RESOURCE_NOT_FOUND',404,'资源不存在或不可见')
    if pending.status=='INVALID' or pending.expires_at<=utcnow():
        raise AppError('VERSION_CONFLICT',409,'预览有错误或已过期，请重新上传')
    count=sum(bool(c['diff']) for c in pending.canonical_changes)
    if pending.status=='APPLIED': return {'preview_id':str(preview_id),'updated_count':count}
    ids=sorted(UUID(c['expert_id']) for c in pending.canonical_changes)
    locked=(await session.scalars(select(Expert).where(Expert.id.in_(ids)).order_by(Expert.id)
        .with_for_update().execution_options(populate_existing=True))).all()
    experts={str(e.id):e for e in locked}
    statuses=dict((await session.execute(select(User.id,User.status).where(User.id.in_([e.user_id for e in locked])))).all())
    # Validate every row before any mutation. Expert version guards qualifications and conflicts too.
    for c in pending.canonical_changes:
        e=experts.get(c['expert_id'])
        if e is None or e.version!=c['version'] or e.qualification_status!=c['qualification_status'] or e.service_status!=c['service_status'] or statuses.get(e.user_id)!=c['account_status']:
            raise AppError('VERSION_CONFLICT',409,'专家档案或资格已变更，整批未更新，请重新预览')
    now=utcnow()
    for c in pending.canonical_changes:
        if not c['diff']: continue
        e=experts[c['expert_id']]
        for field,values in c['diff'].items(): setattr(e,field,values['after'])
        e.version+=1
        e.source_checked_at=now
        await audit.record(session,user=actor,action='expert.import',object_type='expert',object_id=str(e.id),
            request_id=request_id,detail={'preview_id':str(preview_id),'changed_fields':sorted(c['diff']),'version':e.version})
    pending.status='APPLIED'
    await session.flush()
    return {'preview_id':str(preview_id),'updated_count':count}
