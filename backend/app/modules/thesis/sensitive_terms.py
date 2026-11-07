"""School vocabulary and bound reports. Students receive matches, never the full vocabulary."""
import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic_core import PydanticCustomError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.exceptions import AppError
from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, get_current_user, require_roles
from app.modules.audit.service import record
from app.modules.files.models import FileObject
from app.modules.files.pdf import extract_pdf_pages, validated_bytes
from app.modules.thesis import detector
from app.modules.thesis.models import AnonymizationCheck, TenantSensitiveTerms, ThesisVersion, ThesisVersionFile
from app.modules.user.models import StudentEligibility
from app.shared.enums import RoleCode

router = APIRouter(prefix='/api/v1', tags=['sensitive-checks'])


class Term(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=2, max_length=64)
    severity: Literal['WARN', 'BLOCK'] = 'WARN'
    description: str = Field(default='', max_length=255)

    @field_validator('text')
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise PydanticCustomError('term_text', '词条需要2–64个字符，不允许空白或控制字符')
        return value


class TermsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=0)
    terms: list[Term] = Field(max_length=200)

    @field_validator('terms')
    @classmethod
    def unique(cls, value):
        if len({term.text for term in value}) != len(value):
            raise PydanticCustomError('duplicate_terms', '词条不能重复')
        return value


class CheckInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=1)
    file_id: UUID


async def terms_lock(session, tenant_id):
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {'key': 'sensitive-terms:'+str(tenant_id)})


@router.get('/school-admin/sensitive-terms')
async def get_terms(current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)), session: AsyncSession = Depends(get_session)):
    config = await session.scalar(select(TenantSensitiveTerms).where(TenantSensitiveTerms.tenant_id == current.tenant_id))
    return ok({'version': config.version if config else 0, 'terms': config.terms if config else []})


@router.put('/school-admin/sensitive-terms')
async def put_terms(body: TermsInput, current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)), session: AsyncSession = Depends(get_session)):
    await terms_lock(session, current.tenant_id)
    config = await session.scalar(select(TenantSensitiveTerms).where(TenantSensitiveTerms.tenant_id == current.tenant_id))
    version = config.version if config else 0
    if body.expected_version != version:
        raise AppError('VERSION_CONFLICT', 409, '词表已变化，请刷新后再保存')
    if config is None:
        config = TenantSensitiveTerms(tenant_id=current.tenant_id)
        session.add(config)
    config.terms = [term.model_dump() for term in body.terms]
    config.version = version + 1
    await record(session, user=current, action='update_sensitive_terms', object_type='tenant', object_id=str(current.tenant_id),
                 detail={'count': len(config.terms), 'version': config.version})
    result = {'version': config.version, 'terms': config.terms}
    await session.commit()
    return ok(result)


async def matched_terms(session, thesis_id, file_id, sources):
    encoded = json.dumps(sources, ensure_ascii=False)
    if len(sources) > 1005 or len(encoded.encode('utf-8')) > 15_000_000:
        raise AppError('VALIDATION_FAILED', 422, '可提取文字超过检测限制，请缩减材料后重试')
    data = await session.scalar(text('SELECT match_sensitive_terms(:thesis,:file,CAST(:sources AS jsonb))'),
        {'thesis': thesis_id, 'file': file_id, 'sources': encoded})
    if data is None:
        raise AppError('RESOURCE_NOT_FOUND', 404, '资源不存在或不可见')
    return data


async def anonymous_file(session, thesis):
    return (await session.execute(select(FileObject).join(ThesisVersionFile, ThesisVersionFile.file_id == FileObject.id)
        .where(ThesisVersionFile.thesis_version_id == thesis.current_version_id,
               ThesisVersionFile.purpose == 'anonymous', FileObject.thesis_id == thesis.id,
               FileObject.tenant_id == thesis.tenant_id, FileObject.completed_at.is_not(None)))).scalar_one_or_none()


def input_digest(version, eligibility):
    data = [version.title, version.abstract, version.keywords,
            eligibility.student_name, eligibility.student_no, eligibility.supervisor_name]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


async def original_eligibility(session, thesis):
    return await session.scalar(select(StudentEligibility).where(
        StudentEligibility.student_membership_id == thesis.student_membership_id,
        StudentEligibility.review_batch_id == thesis.review_batch_id))


async def create_report(session, user, thesis, version, eligibility, anonymous, body):
    inspection = await run_in_threadpool(extract_pdf_pages, body)
    sources = detector.inspection_sources(version, anonymous, inspection)
    config = await matched_terms(session, thesis.id, anonymous.id, [source['text'] for source in sources])
    conclusion, findings, title_status = await run_in_threadpool(detector.detect_sensitive,
        version, eligibility, anonymous, body, inspection, config['terms'])
    report = AnonymizationCheck(thesis_version_id=version.id, auto_conclusion=conclusion, findings=findings,
        detector_version=detector.DETECTOR_VERSION, source_metadata={
            'thesis_version_id': str(version.id), 'file_id': str(anonymous.id), 'file_sha256': anonymous.sha256,
            'detector_version': detector.DETECTOR_VERSION, 'terms_version': config['version'],
            'input_sha256': input_digest(version, eligibility),
            'title_status': title_status, 'uncertain': inspection['uncertain'],
            'uncertain_pages': [p['page_number'] for p in inspection['pages'] if p['uncertain']],
            'page_count': len(inspection['pages']),
        })
    session.add(report)
    await session.flush()
    await record(session, user=user, action='sensitive_check', object_type='thesis', object_id=str(thesis.id),
        detail={'finding_count': len(findings), 'terms_version': config['version'], 'detector_version': detector.DETECTOR_VERSION})
    return report


async def is_stale(session, thesis, report):
    if report is None or not report.source_metadata or report.thesis_version_id != thesis.current_version_id:
        return True
    source = report.source_metadata
    version = await session.get(ThesisVersion, thesis.current_version_id)
    eligibility = await original_eligibility(session, thesis)
    if version is None or eligibility is None or source.get('input_sha256') != input_digest(version, eligibility):
        return True
    anonymous = await anonymous_file(session, thesis)
    if (anonymous is None or source.get('file_id') != str(anonymous.id)
            or source.get('file_sha256') != anonymous.sha256 or source.get('detector_version') != detector.DETECTOR_VERSION):
        return True
    config = await matched_terms(session, thesis.id, anonymous.id, [])
    return source.get('terms_version') != config['version']


def serialize_report(report, stale=False):
    return {'auto_conclusion': report.auto_conclusion if report else None,
            'manual_conclusion': report.manual_conclusion if report else None,
            'findings': report.findings if report else [],
            'source_metadata': report.source_metadata if report else None, 'stale': stale}


@router.post('/theses/{thesis_id}/sensitive-checks')
@router.post('/school-review/theses/{thesis_id}/sensitive-checks')
async def check_thesis(thesis_id: UUID, body: CheckInput, request: Request,
                       current: CurrentUser = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    from app.modules.thesis import service
    school_path = '/school-review/' in request.url.path
    if current.role == RoleCode.SCHOOL_REVIEWER:
        thesis = await service.get_school_thesis(session, current, thesis_id, for_update=True)
    elif current.role == RoleCode.STUDENT and not school_path:
        thesis = await service.get_student_thesis(session, current, thesis_id, for_update=True)
    else:
        raise service._hidden()
    if thesis.version != body.expected_version:
        raise AppError('VERSION_CONFLICT', 409, '论文已变化，请刷新后重新检测')
    if thesis.stage not in ('DRAFT', 'PREPARING') or (current.role == RoleCode.STUDENT and thesis.stage != 'DRAFT'):
        raise AppError('STATE_TRANSITION_DENIED', 409, '当前状态不允许重新检测')
    anonymous = await anonymous_file(session, thesis)
    if anonymous is None or anonymous.id != body.file_id:
        raise service._hidden()
    version = await session.get(ThesisVersion, thesis.current_version_id)
    eligibility = await original_eligibility(session, thesis)
    if eligibility is None:
        raise AppError('VALIDATION_FAILED', 422, '缺少论文原批次身份核验资料')
    raw = await run_in_threadpool(validated_bytes, anonymous)
    report = await create_report(session, current, thesis, version, eligibility, anonymous, raw)
    result = serialize_report(report)
    await session.commit()
    return ok(result)
