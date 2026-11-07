"""Private school program catalogs. Published revisions and their provenance never change."""
import csv
import hashlib
import io
import json
import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.tenant.catalog_service import list_disciplines
from app.modules.tenant.models import BatchProgramBinding, SchoolProgramCatalog as Catalog, ThesisProgramChoice as Choice
from app.modules.tenant.service import current_student_eligibility, get_batch

HEADER = ['校内代码','校内名称','官方代码','状态']


class ImportBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    year: int = Field(strict=True,ge=1900,le=2199)
    source: str = Field(max_length=512)
    source_version: str = Field(max_length=80)
    csv: str = Field(max_length=512_000)


class PublishBody(ImportBody):
    fingerprint: str = Field(pattern='^[0-9a-f]{64}$')


class PinBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    catalog_id: UUID
    expected_version: int = Field(strict=True,ge=1)


class ProgramKey(BaseModel):
    model_config = ConfigDict(extra='forbid')
    catalog_id: UUID
    code: str = Field(min_length=1,max_length=40)


def invalid(message):
    return AppError('VALIDATION_FAILED',422,message)


def summary(row):
    return dict(id=str(row.id),year=row.year,revision=row.revision,source=row.source,source_version=row.source_version,
                count=len(row.entries),published_at=row.created_at.isoformat())


async def catalogs(session,actor):
    rows=await session.scalars(select(Catalog).where(Catalog.tenant_id==actor.tenant_id)
                               .order_by(Catalog.year.desc(),Catalog.revision.desc()))
    return [summary(row) for row in rows]


async def inspect(session,actor,body):
    last=await session.scalar(select(Catalog).where(Catalog.tenant_id==actor.tenant_id,Catalog.year==body.year)
                              .order_by(Catalog.revision.desc()).limit(1))
    previous=last.entries if last else {}
    entries=dict(previous)
    input_error = None
    if any('\x00' in value for value in (body.csv, body.source, body.source_version)):
        input_error = '目录和出处不能包含空字符，请检查 UTF-8 文件'
    elif len(body.csv.encode('utf-8')) > 512_000:
        input_error = 'CSV 不得超过 512 KB'
    if input_error:
        return dict(errors=[input_error],changes=[],fingerprint=None,
                    revision=(last.revision if last else 0)+1,retained=len(previous)),entries
    official={r['code']:r['name'] for r in await list_disciplines(session)}
    errors,changes,seen=[],[],set()
    source,edition=body.source.strip(),body.source_version.strip()
    if not source or not edition:
        errors.append('请填写校方正式出处和来源版本')
    reader=csv.reader(io.StringIO(body.csv.lstrip('\ufeff'),newline=''),strict=True)
    try:
        if next(reader,None)!=HEADER: errors.append('表头须为：'+','.join(HEADER))
        for row in reader:
            if not row: continue
            line=reader.line_num
            if len(changes)+len(errors)>=2000:
                errors.append('单次最多 2000 行'); break
            if len(row)!=4:
                errors.append(f'第 {line} 行：应有 4 列'); continue
            code,name,official_code,status=(v.strip() for v in row)
            if not re.fullmatch(r'[\w./-]{1,40}',code) or not 1<=len(name)<=128:
                errors.append(f'第 {line} 行：校码或名称无效'); continue
            if code in seen:
                errors.append(f'第 {line} 行：重复校码 {code}，请校方先确认'); continue
            seen.add(code)
            if official_code not in official or status not in ('启用','停用'):
                errors.append(f'第 {line} 行：官方代码不存在/未启用，或状态无效'); continue
            item=dict(name=name,official_code=official_code,official_name=official[official_code],
                      active=status=='启用',source=source,source_version=edition)
            old=previous.get(code)
            changes.append(dict(code=code,before=old,after=item,action='新增' if not old else '未变' if old==item else '变更'))
            entries[code]=item
    except csv.Error:
        errors.append(f'第 {reader.line_num} 行：CSV 格式错误')
    if not seen: errors.append('没有可导入的校内专业')
    if len(entries)>5000: errors.append('年度目录超过 5000 条')
    digest=hashlib.sha256(json.dumps([str(actor.id),str(actor.tenant_id),body.year,str(last.id) if last else None,
        source,edition,changes],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return dict(errors=errors,changes=changes,fingerprint=None if errors else digest,
                revision=(last.revision if last else 0)+1,retained=len(set(previous)-seen)),entries


async def publish(session,actor,body,request_id):
    for key in ('official-catalog-import',f'school-programs:{actor.tenant_id}:{body.year}'):
        await session.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))'),{'key':key})
    report,entries=await inspect(session,actor,body)
    if report['errors']: raise invalid(report['errors'][0])
    if report['fingerprint']!=body.fingerprint:
        raise AppError('VERSION_CONFLICT',409,'目录或预览内容已变化，请重新预览')
    row=Catalog(tenant_id=actor.tenant_id,year=body.year,revision=report['revision'],source=body.source.strip(),
                source_version=body.source_version.strip(),entries=entries,published_by=actor.id)
    session.add(row);await session.flush()
    await audit.record(session,user=actor,action='catalog.program-publish',object_type='catalog',object_id=str(row.id),
                       request_id=request_id,detail={'year':row.year,'revision':row.revision,'count':len(entries)})
    return summary(row)


async def binding(session,batch_id):
    return await session.scalar(select(BatchProgramBinding.catalog_id).where(BatchProgramBinding.batch_id==batch_id))


async def pin(session,actor,batch_id,body,request_id):
    batch=await get_batch(session,actor.tenant_id,batch_id,lock=True)
    row=await session.get(Catalog,body.catalog_id)
    if row is None or row.tenant_id!=actor.tenant_id: raise AppError('RESOURCE_NOT_FOUND',404,'目录不可见')
    if await binding(session,batch.id) or batch.status not in ('DRAFT','OPEN') or batch.version!=body.expected_version:
        raise AppError('VERSION_CONFLICT',409,'批次已绑定、已关闭或发生变化，请刷新')
    session.add(BatchProgramBinding(tenant_id=actor.tenant_id,batch_id=batch.id,catalog_id=row.id))
    batch.version+=1
    await audit.record(session,user=actor,action='batch.program-pin',object_type='batch',object_id=str(batch.id),
                       request_id=request_id,detail={'catalog_id':str(row.id)})
    await session.flush()


async def options(session,actor,thesis_id):
    if thesis_id:
        from app.modules.thesis.service import get_student_thesis
        thesis=await get_student_thesis(session,actor,thesis_id)
        batch=await get_batch(session,actor.tenant_id,thesis.review_batch_id)
    else:
        _,batch=await current_student_eligibility(session,actor.id,actor.tenant_id)
    catalog_id=await binding(session,batch.id)
    if not catalog_id: return {'catalog_id':None,'items':[]}
    catalog=await session.get(Catalog,catalog_id)
    allowed={r['code']:r['name'] for r in await list_disciplines(session,actor.tenant_id)}
    return {'catalog_id':str(catalog.id),'items':[dict(code=k,name=v['name'],official_code=v['official_code'],
            official_name=allowed[v['official_code']]) for k,v in sorted(catalog.entries.items())
            if v['active'] and v['official_code'] in allowed]}


async def resolve(session,batch_id,tenant_id,key,official_code,official_name,*,required):
    catalog_id=await binding(session,batch_id)
    if key is None:
        if catalog_id and required: raise invalid('该批次已绑定校内目录，请选择校内专业')
        if not official_code or not official_name: raise invalid('请选择官方学科')
        return official_code,official_name
    if catalog_id!=key.catalog_id: raise invalid('所选校内专业不属于本论文批次的目录版本')
    row=await session.get(Catalog,key.catalog_id)
    item=row.entries.get(key.code) if row and row.tenant_id==tenant_id else None
    allowed={r['code']:r['name'] for r in await list_disciplines(session,tenant_id)}
    canonical = allowed.get(item['official_code']) if item else None
    if (not item or not item['active'] or not canonical or
            (official_code is not None and official_code!=item['official_code']) or
            (official_name is not None and official_name!=canonical)):
        raise invalid('校内专业已停用、官方学科未开放或映射不匹配')
    return item['official_code'],canonical


async def choice(session,version_id):
    return await session.scalar(select(Choice).where(Choice.version_id==version_id))


async def display_choice(session,version_id):
    selected=await choice(session,version_id)
    if selected is None: return None
    row=await session.get(Catalog,selected.catalog_id)
    return dict(catalog_id=str(row.id),year=row.year,revision=row.revision,code=selected.code,name=row.entries[selected.code]['name'])


def store_choice(session,version,key):
    session.add(Choice(version_id=version.id,thesis_id=version.thesis_id,tenant_id=version.tenant_id,
                       catalog_id=key.catalog_id,code=key.code))
