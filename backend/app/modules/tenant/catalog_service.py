import hashlib
import json
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.tenant.catalog_data import official_bundle
from app.modules.tenant.models import DisciplineCatalog, InstitutionCatalog, SchoolDisciplineSettings


def project(row, keys):
    return {key: getattr(row, key) for key in keys}


async def list_disciplines(session, tenant_id=None):
    rows = list((await session.scalars(select(DisciplineCatalog).where(
        DisciplineCatalog.tenant_id.is_(None), DisciplineCatalog.is_active.is_(True)).order_by(DisciplineCatalog.code))).all())
    if tenant_id:
        config = await session.scalar(select(SchoolDisciplineSettings).where(SchoolDisciplineSettings.tenant_id == tenant_id))
        if config is not None:
            rows = [row for row in rows if row.code in config.codes]
    return [project(row, ('code','name','category_code','category_name','kind','source_version')) for row in rows]


async def preview(session):
    bundle = official_bundle()
    state, counts = {}, {}
    for key, model in [('disciplines',DisciplineCatalog),('institutions',InstitutionCatalog)]:
        rows = list((await session.scalars(select(model).order_by(model.code))).all())
        if model is DisciplineCatalog and any(r.tenant_id is not None for r in rows):
            raise AppError('RESOURCE_CONFLICT',409,'已有学校专用目录，需先复核映射')
        fields = list(bundle[key][0]) + ['is_active']
        state[key] = [project(r, fields) for r in rows]
        by_code = {r['code']:r for r in state[key]}
        added = sum(r['code'] not in by_code for r in bundle[key])
        changed = sum(r['code'] in by_code and by_code[r['code']] != {**r,'is_active':True} for r in bundle[key])
        counts[key] = {'added':added,'changed':changed,'unchanged':len(bundle[key])-added-changed}
    digest = hashlib.sha256(json.dumps({'snapshot':bundle['snapshot'],'state':state},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {**counts,'fingerprint':digest,'sources':bundle['sources']}


async def apply_import(session, actor, fingerprint, request_id):
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('official-catalog-import',0))"))
    report = await preview(session)
    if report['fingerprint'] != fingerprint:
        raise AppError('VERSION_CONFLICT',409,'目录或预览已变化，请重新预览')
    bundle = official_bundle()
    for key, model in [('disciplines',DisciplineCatalog),('institutions',InstitutionCatalog)]:
        fields = list(bundle[key][0]) + ['is_active']
        for start in range(0,len(bundle[key]),300):
            values = [{**r,'id':uuid4(),'is_active':True} for r in bundle[key][start:start+300]]
            stmt = insert(model).values(values)
            await session.execute(stmt.on_conflict_do_update(index_elements=['code'],
                set_={k:getattr(stmt.excluded,k) for k in fields if k != 'code'}))
    await audit.record(session,user=actor,action='catalog.import',object_type='catalog',object_id=bundle['snapshot'],
                       request_id=request_id,detail={k:report[k] for k in ('fingerprint','disciplines','institutions')})
    await session.flush()
    return report


async def get_settings(session, tenant_id):
    row = await session.scalar(select(SchoolDisciplineSettings).where(SchoolDisciplineSettings.tenant_id == tenant_id))
    return {'configured':row is not None,'codes':row.codes if row else [],'version':row.version if row else 0}


async def save_settings(session, actor, codes, version, request_id):
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),{'key':f'school-disciplines:{actor.tenant_id}'})
    row = await session.scalar(select(SchoolDisciplineSettings).where(SchoolDisciplineSettings.tenant_id == actor.tenant_id)
                               .execution_options(populate_existing=True))
    if (row.version if row else 0) != version:
        raise AppError('VERSION_CONFLICT',409,'配置已变化，请刷新后重试')
    allowed = {r['code'] for r in await list_disciplines(session)}
    codes = sorted(set(codes))
    if not set(codes) <= allowed:
        raise AppError('VALIDATION_FAILED',422,'学科必须来自启用的官方目录')
    if row:
        row.codes, row.version = codes, row.version+1
    else:
        row = SchoolDisciplineSettings(tenant_id=actor.tenant_id,codes=codes,version=1)
        session.add(row)
    await audit.record(session,user=actor,action='catalog.school-disciplines',object_type='tenant',object_id=str(actor.tenant_id),
                       request_id=request_id,detail={'version':row.version,'codes':codes})
    await session.flush()
    return {'configured':True,'codes':codes,'version':row.version}


async def require_school_discipline(session, tenant_id, code):
    config = await session.scalar(select(SchoolDisciplineSettings).where(SchoolDisciplineSettings.tenant_id == tenant_id))
    if config is not None and code not in config.codes:
        raise AppError('VALIDATION_FAILED',422,'该学科未在本校开放，请联系学校审核员')
