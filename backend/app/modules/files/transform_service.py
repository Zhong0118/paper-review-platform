from pathlib import Path
from uuid import UUID

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.rls_context import VerifiedClaims, bind_candidate_identity
from app.modules.audit import service as audit
from app.modules.auth import service as auth_service
from app.modules.files import service as files, transform_runtime
from app.modules.files.models import FileObject
from app.modules.files.pdf import validated_bytes
from app.modules.files.transform_models import PdfTransformOperation
from app.modules.thesis.models import ThesisVersion, ThesisVersionFile
from app.modules.thesis.service import locked_content_revision, require_content_revision


def response(operation):
    return {'operation_id': str(operation.id), 'new_file_id': str(operation.new_file_id),
            'page_count': operation.page_count, 'source_version': str(operation.source_version), 'status': operation.status}


async def _snapshot(session, user, thesis_id, payload, *, output_id=None):
    thesis = await files._lock_owned_thesis(session, user, thesis_id)
    await files._require_editable(session, thesis, thesis.current_version_id)
    if thesis.version != payload['expected_version']:
        raise AppError('VERSION_CONFLICT', 409, '草稿状态已改变，请刷新后重试')
    ids = [UUID(s['file_id']) for s in payload['sources']]
    if len(set(ids)) != len(ids):
        raise AppError('VALIDATION_FAILED', 422, '来源文件不能重复')
    rows = (await session.scalars(select(FileObject).where(FileObject.id.in_(ids + ([output_id] if output_id else [])))
        .order_by(FileObject.id).with_for_update().execution_options(populate_existing=True))).all()
    if sum(row.size_bytes for row in rows if row.id in ids) > get_settings().max_upload_bytes:
        raise AppError('FILE_TOO_LARGE', 413, '来源文件合计超过大小限制')
    by_id = {row.id: row for row in rows}
    sources, inputs = [], []
    for source in payload['sources']:
        obj = by_id.get(UUID(source['file_id']))
        if (obj is None or obj.thesis_id != thesis.id or obj.uploaded_by != user.id
            or obj.tenant_id != user.tenant_id or obj.upload_version_id != thesis.current_version_id
            or obj.purpose != payload['purpose'] or obj.completed_at is None):
            raise files._hidden()
        if obj.content_type != 'application/pdf':
            raise AppError('VALIDATION_FAILED', 422, '仅支持PDF材料')
        inputs.append(await run_in_threadpool(validated_bytes, obj, parse_pdf=False))
        sources.append({**source, 'sha256': obj.sha256})
    if sum(map(len, inputs)) > get_settings().max_upload_bytes:
        raise AppError('FILE_TOO_LARGE', 413, '来源文件合计超过大小限制')
    bound = await session.scalar(select(ThesisVersionFile.file_id).where(
        ThesisVersionFile.thesis_version_id == thesis.current_version_id, ThesisVersionFile.purpose == payload['purpose']))
    snapshot = {**payload, 'source_version': str(thesis.current_version_id), 'sources': sources,
                'bound_file_id': str(bound) if bound else None}
    return thesis, snapshot, inputs


async def generate(session, user, thesis_id, payload, key):
    route = f'/theses/{thesis_id}/pdf-transforms'
    thesis, snapshot, inputs = await _snapshot(session, user, thesis_id, payload)
    replay = await audit.replay(session, user, key, route, payload, wait=False)
    if replay:
        return replay
    digest = audit.request_digest(route, snapshot)
    existing = await session.scalar(select(PdfTransformOperation).where(
        PdfTransformOperation.created_by == user.id, PdfTransformOperation.request_hash == digest))
    if existing:
        result = response(existing)
        await audit.remember(session, user, key, route, payload, result)
        return result
    # Release the thesis/file/advisory locks and DB connection before PDF computation.
    await session.commit()
    output, count = await run_in_threadpool(transform_runtime.convert, inputs, payload['operation'],
                                           [s['pages'] for s in payload['sources']], get_settings().max_upload_bytes)
    await bind_candidate_identity(session, VerifiedClaims(user.id, user.role, user.tenant_id, user.auth_version))
    await auth_service.load_active_identity(session, user.id, token_role=user.role,
        token_tenant_id=user.tenant_id, token_auth_version=user.auth_version)
    thesis, current, _ = await _snapshot(session, user, thesis_id, payload)
    if snapshot != current:
        raise AppError('VERSION_CONFLICT', 409, '转换期间材料已改变，请重新生成')
    replay = await audit.replay(session, user, key, route, payload, wait=False)
    if replay:
        return replay
    existing = await session.scalar(select(PdfTransformOperation).where(
        PdfTransformOperation.created_by == user.id, PdfTransformOperation.request_hash == digest))
    if existing:
        result = response(existing)
    else:
        prepared = await files.prepare_upload(session, user, thesis_id=thesis_id, purpose=payload['purpose'],
            filename=f"{payload['purpose']}-converted.pdf", content_type='application/pdf')
        file_id = UUID(str(prepared['file_id']))
        obj = await session.get(FileObject, file_id)
        try:
            await files.put_content(session, user, file_id, output)
            # The restricted worker has parsed and validated the product; still recheck stored hash/size here.
            await files.complete_upload(session, user, file_id, bind=False, parse_pdf=False)
            operation = PdfTransformOperation(thesis_id=thesis_id, tenant_id=user.tenant_id, created_by=user.id,
                source_version=thesis.current_version_id, expected_version=payload['expected_version'],
                purpose=payload['purpose'], operation=payload['operation'], sources=snapshot['sources'],
                request_hash=digest, bound_file_id=UUID(snapshot['bound_file_id']) if snapshot['bound_file_id'] else None,
                new_file_id=file_id, page_count=count, status='READY')
            session.add(operation)
            await session.flush()
            result = response(operation)
            await audit.record(session, user=user, action='PDF_TRANSFORM_GENERATED', object_type='pdf_transform',
                object_id=str(operation.id), detail={'new_file_id': str(file_id), 'page_count': count,
                    'sha256': obj.sha256, 'operation': payload['operation']})
        except Exception:
            # Only the UUID output allocated by this invocation is eligible for cleanup.
            Path(obj.storage_key).unlink(missing_ok=True)
            raise
    await audit.remember(session, user, key, route, payload, result)
    return result


async def finish(session, user, operation_id, expected_version, *, cancel=False, expected_content_revision=None):
    operation = await session.get(PdfTransformOperation, operation_id)
    if operation is None:
        raise files._hidden()
    thesis = await files._lock_owned_thesis(session, user, operation.thesis_id)
    # The thesis lock serializes apply/cancel and competing file uploads.
    await session.refresh(operation)
    target = 'CANCELLED' if cancel else 'APPLIED'
    if not cancel:
        if expected_content_revision is None:
            raise AppError('VALIDATION_FAILED', 422, '应用转换必须提供论文内容版本')
        await files._require_editable(session, thesis, operation.source_version)
        if expected_version != operation.expected_version or thesis.version != expected_version:
            raise AppError('VERSION_CONFLICT', 409, '草稿版本不匹配')
        version = await session.get(ThesisVersion, operation.source_version, populate_existing=True)
    if operation.status == target:
        if cancel:
            return response(operation)
        bound = await session.scalar(select(ThesisVersionFile.file_id).where(
            ThesisVersionFile.thesis_version_id == version.id, ThesisVersionFile.purpose == operation.purpose))
        current = await locked_content_revision(session, version)
        if bound != operation.new_file_id or (current != expected_content_revision and
                await locked_content_revision(session, version, prior_binding=(operation.purpose, operation.bound_file_id))
                != expected_content_revision):
            raise AppError('VERSION_CONFLICT', 409, '应用后论文内容或材料已改变')
        return {**response(operation), 'content_revision': current}
    if operation.status != 'READY':
        raise AppError('VERSION_CONFLICT', 409, '该转换已处理')
    if not cancel:
        await require_content_revision(session, version, expected_content_revision)
        payload = {'expected_version': expected_version, 'purpose': operation.purpose,
                   'sources': [{'file_id': s['file_id'], 'pages': s['pages']} for s in operation.sources]}
        _, snapshot, _ = await _snapshot(session, user, thesis.id, payload, output_id=operation.new_file_id)
        if (snapshot['sources'] != operation.sources or snapshot['source_version'] != str(operation.source_version)
            or snapshot['bound_file_id'] != (str(operation.bound_file_id) if operation.bound_file_id else None)):
            raise AppError('VERSION_CONFLICT', 409, '来源材料已改变，请重新生成')
        output = await session.scalar(select(FileObject).where(FileObject.id == operation.new_file_id)
            .with_for_update().execution_options(populate_existing=True))
        if output is None:
            raise files._hidden()
        await run_in_threadpool(validated_bytes, output, parse_pdf=False)
        link = await session.scalar(select(ThesisVersionFile).where(
            ThesisVersionFile.thesis_version_id == operation.source_version, ThesisVersionFile.purpose == operation.purpose))
        if link:
            link.file_id = output.id
        else:
            session.add(ThesisVersionFile(thesis_version_id=operation.source_version, thesis_id=thesis.id,
                tenant_id=user.tenant_id, file_id=output.id, purpose=operation.purpose))
    operation.status = target
    await audit.record(session, user=user, action='PDF_TRANSFORM_' + target, object_type='pdf_transform',
        object_id=str(operation.id), detail={'new_file_id': str(operation.new_file_id)})
    await session.flush()
    return response(operation) if cancel else {**response(operation), 'content_revision': await locked_content_revision(session, version)}
