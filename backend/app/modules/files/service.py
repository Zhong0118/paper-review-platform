from starlette.concurrency import run_in_threadpool
from app.modules.files.pdf import check_size, validated_bytes
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import create_download_token
from app.modules.auth import service as auth_service
from app.modules.auth.deps import CurrentUser
from app.modules.files import storage
from app.modules.files.models import FileObject
from app.modules.thesis.models import Thesis, ThesisVersion, ThesisVersionFile
from app.modules.user.models import TenantUserMembership
from app.shared.enums import FilePurpose, FileScanStatus, RoleCode

ALLOWED_TYPES = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def _lock_owned_thesis(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> Thesis:
    thesis = (await session.execute(
        select(Thesis).join(TenantUserMembership, TenantUserMembership.id == Thesis.student_membership_id)
        .where(Thesis.id == thesis_id, Thesis.tenant_id == user.tenant_id, Thesis.draft_abandoned_at.is_(None),
               TenantUserMembership.user_id == user.id)
        .with_for_update(of=Thesis).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if thesis is None or user.role != RoleCode.STUDENT:
        raise _hidden()
    return thesis


async def _require_editable(session: AsyncSession, thesis: Thesis, version_id: UUID | None) -> None:
    version = await session.get(ThesisVersion, version_id, populate_existing=True) if version_id else None
    if (thesis.stage != "DRAFT" or version is None or not version.is_editable
            or thesis.current_version_id != version_id or version.thesis_id != thesis.id):
        raise AppError("STATE_TRANSITION_DENIED", 409, "上传版本已不可编辑，请重新上传")


async def prepare_upload(
    session: AsyncSession,
    user: CurrentUser,
    *,
    thesis_id: UUID,
    purpose: str,
    filename: str,
    content_type: str,
) -> dict:
    if purpose not in {FilePurpose.ORIGINAL, FilePurpose.ANONYMOUS}:
        raise AppError("VALIDATION_FAILED", 422, "不支持的文件用途")
    if user.role != RoleCode.STUDENT or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await _lock_owned_thesis(session, user, thesis_id)
    await _require_editable(session, thesis, thesis.current_version_id)
    file_id = uuid4()
    path = storage.storage_path(thesis.tenant_id, thesis.id, file_id, purpose)
    obj = FileObject(
        id=file_id, tenant_id=thesis.tenant_id, thesis_id=thesis.id,
        upload_version_id=thesis.current_version_id,
        purpose=purpose, storage_key=str(path), original_filename=filename,
        content_type=content_type or "application/octet-stream", size_bytes=0,
        scan_status=FileScanStatus.PENDING, uploaded_by=user.id,
    )
    session.add(obj)
    await session.flush()
    return {"file_id": str(file_id), "upload_url": f"/api/v1/files/{file_id}/content", "purpose": purpose}


async def _lock_upload(session: AsyncSession, user: CurrentUser, file_id: UUID) -> tuple[FileObject, Thesis | None]:
    obj = await session.get(FileObject, file_id)
    if (obj is None or obj.uploaded_by != user.id or obj.tenant_id != user.tenant_id
            or user.role != RoleCode.STUDENT):
        raise _hidden()
    thesis = None
    if obj.upload_version_id:
        version = await session.get(ThesisVersion, obj.upload_version_id)
        if version is None:
            raise _hidden()
        thesis = await _lock_owned_thesis(session, user, version.thesis_id)
    # Always lock the thesis before the file, as submit/withdraw lock the thesis.
    obj = (await session.execute(select(FileObject).where(FileObject.id == file_id)
                                 .with_for_update().execution_options(populate_existing=True))).scalar_one()
    return obj, thesis


async def _require_pending(session: AsyncSession, obj: FileObject, thesis: Thesis | None) -> None:
    if obj.purpose == FilePurpose.ATTACHMENT:
        raise AppError("VALIDATION_FAILED", 422, "尚不支持附件上传")
    if obj.completed_at is not None or thesis is None:
        raise AppError("STATE_TRANSITION_DENIED", 409, "文件已锁定，请创建新的上传")
    await _require_editable(session, thesis, obj.upload_version_id)


async def put_content(session: AsyncSession, user: CurrentUser, file_id: UUID, data: bytes) -> None:
    obj, thesis = await _lock_upload(session, user, file_id)
    await _require_pending(session, obj, thesis)
    check_size(len(data))
    digest = storage.write_bytes(Path(obj.storage_key), data)
    obj.size_bytes = len(data)
    obj.sha256 = digest
    await session.flush()


async def complete_upload(session: AsyncSession, user: CurrentUser, file_id: UUID, *, bind: bool = True, parse_pdf: bool = True, expected_content_revision: str | None = None) -> FileObject:
    obj, thesis = await _lock_upload(session, user, file_id)
    if expected_content_revision is not None:
        from app.modules.thesis.service import require_content_revision
        if thesis is None:
            raise _hidden()
        await _require_editable(session, thesis, obj.upload_version_id)
        version = await session.get(ThesisVersion, obj.upload_version_id, populate_existing=True)
        await require_content_revision(session, version, expected_content_revision)
    if obj.completed_at is not None:
        return obj
    await _require_pending(session, obj, thesis)
    if bind and expected_content_revision is None:
        raise AppError("VALIDATION_FAILED", 422, "绑定文件必须提供论文内容版本")
    path = Path(obj.storage_key)
    if not path.exists() or obj.size_bytes <= 0:
        raise AppError("FILE_NOT_READY", 409, "文件尚未上传完成")
    if obj.content_type not in ALLOWED_TYPES:
        raise AppError("VALIDATION_FAILED", 422, "不支持的文件类型")
    await run_in_threadpool(validated_bytes, obj, parse_pdf=parse_pdf)
    obj.scan_status = FileScanStatus.CLEAN
    obj.completed_at = datetime.now(timezone.utc)
    if not bind:
        await session.flush()
        return obj
    existing = (await session.execute(select(ThesisVersionFile).where(
        ThesisVersionFile.thesis_version_id == obj.upload_version_id,
        ThesisVersionFile.purpose == obj.purpose,
    ))).scalar_one_or_none()
    if existing:
        existing.file_id = obj.id
    else:
        session.add(ThesisVersionFile(thesis_version_id=obj.upload_version_id,
                                     thesis_id=obj.thesis_id, tenant_id=obj.tenant_id,
                                     file_id=obj.id, purpose=obj.purpose))
    await session.flush()
    return obj


async def can_access_file(session: AsyncSession, user: CurrentUser, obj: FileObject) -> bool:
    if obj.completed_at is None or user.role == RoleCode.SYSTEM_ADMIN:
        return False
    if obj.thesis_id and user.role in (RoleCode.STUDENT, RoleCode.SCHOOL_REVIEWER, RoleCode.PLATFORM_REVIEWER):
        if await session.scalar(select(Thesis.id).where(
                Thesis.id == obj.thesis_id, Thesis.draft_abandoned_at.is_(None))) is None:
            return False
    bound = await session.scalar(select(ThesisVersionFile.id).where(ThesisVersionFile.file_id == obj.id).limit(1))
    if bound is None:
        from app.modules.files.transform_models import PdfTransformOperation
        ready = await session.scalar(select(PdfTransformOperation.id)
            .join(Thesis, Thesis.id == PdfTransformOperation.thesis_id)
            .join(ThesisVersion, ThesisVersion.id == Thesis.current_version_id)
            .where(PdfTransformOperation.new_file_id == obj.id, PdfTransformOperation.status == 'READY',
                   PdfTransformOperation.created_by == user.id, Thesis.stage == 'DRAFT', ThesisVersion.is_editable,
                   Thesis.current_version_id == PdfTransformOperation.source_version))
        return user.role == RoleCode.STUDENT and obj.uploaded_by == user.id and ready is not None
    if obj.purpose == FilePurpose.ORIGINAL:
        if user.role == RoleCode.STUDENT and obj.uploaded_by == user.id and obj.tenant_id == user.tenant_id:
            return True
        if user.role == RoleCode.SCHOOL_REVIEWER and user.tenant_id == obj.tenant_id:
            return True
        return False
    if obj.purpose == FilePurpose.ANONYMOUS:
        if user.role == RoleCode.STUDENT and obj.uploaded_by == user.id and obj.tenant_id == user.tenant_id:
            return True
        if user.role == RoleCode.SCHOOL_REVIEWER and user.tenant_id == obj.tenant_id:
            return True
        if user.role == RoleCode.PLATFORM_REVIEWER:
            return True
        if user.role == RoleCode.EXPERT:
            from app.modules.dispatch.models import ExpertTask, ReviewRound
            from app.modules.expert.models import Expert
            from app.shared.enums import ExpertTaskStatus, RoundStatus, ThesisStage

            task = (await session.execute(select(ExpertTask.id)
                .join(Expert, Expert.id == ExpertTask.expert_id)
                .join(ReviewRound, ReviewRound.id == ExpertTask.round_id)
                .join(Thesis, Thesis.id == ReviewRound.thesis_id)
                .join(ThesisVersionFile, ThesisVersionFile.thesis_version_id == ReviewRound.thesis_version_id)
                .where(Expert.user_id == user.id, ExpertTask.status == ExpertTaskStatus.IN_REVIEW,
                       ReviewRound.status == RoundStatus.ACTIVE, Thesis.stage == ThesisStage.UNDER_REVIEW,
                       Thesis.current_version_id == ReviewRound.thesis_version_id,
                       ThesisVersionFile.file_id == obj.id, ThesisVersionFile.purpose == FilePurpose.ANONYMOUS)
                .limit(1))).scalar_one_or_none()
            return task is not None
    return False


async def authorize_download(session: AsyncSession, user: CurrentUser, file_id: UUID) -> dict:
    identity = await auth_service.load_active_identity(
        session, user.id, token_role=user.role, token_tenant_id=user.tenant_id,
        token_auth_version=user.auth_version,
    )
    obj = await session.get(FileObject, file_id)
    if obj is None or not await can_access_file(session, user, obj):
        raise _hidden()
    token, expires = create_download_token(
        user_id=user.id,
        role=user.role,
        tenant_id=user.tenant_id,
        file_id=file_id,
        auth_version=identity.user.auth_version,
    )
    return {
        "url": f"/api/v1/files/{file_id}/content?token={token}",
        "expires_at": expires.isoformat(),
    }


async def load_file_bytes(session: AsyncSession, user: CurrentUser, file_id: UUID) -> tuple[FileObject, bytes]:
    obj = await session.get(FileObject, file_id)
    if obj is None or not await can_access_file(session, user, obj):
        raise _hidden()
    try:
        return obj, Path(obj.storage_key).read_bytes()
    except OSError as exc:
        raise _hidden() from exc
