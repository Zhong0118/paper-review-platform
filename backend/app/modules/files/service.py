from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import create_access_token
from app.modules.auth.deps import CurrentUser
from app.modules.files import storage
from app.modules.files.models import FileObject
from app.modules.thesis.models import Thesis, ThesisVersionFile
from app.shared.enums import FilePurpose, FileScanStatus, RoleCode

ALLOWED_TYPES = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def prepare_upload(
    session: AsyncSession,
    user: CurrentUser,
    *,
    thesis_id: UUID,
    purpose: str,
    filename: str,
    content_type: str,
) -> dict:
    if purpose not in {FilePurpose.ORIGINAL, FilePurpose.ANONYMOUS, FilePurpose.ATTACHMENT}:
        raise AppError("VALIDATION_FAILED", 422, "不支持的文件用途")
    if user.role != RoleCode.STUDENT or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    if thesis.stage != "DRAFT":
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许上传")
    file_id = uuid4()
    path = storage.storage_path(thesis.tenant_id, thesis.id, file_id, purpose)
    obj = FileObject(
        id=file_id,
        tenant_id=thesis.tenant_id,
        purpose=purpose,
        storage_key=str(path),
        original_filename=filename,
        content_type=content_type or "application/octet-stream",
        size_bytes=0,
        scan_status=FileScanStatus.PENDING,
        uploaded_by=user.id,
    )
    session.add(obj)
    await session.flush()
    return {"file_id": str(file_id), "upload_url": f"/api/v1/files/{file_id}/content", "purpose": purpose}


async def put_content(session: AsyncSession, user: CurrentUser, file_id: UUID, data: bytes) -> None:
    obj = await session.get(FileObject, file_id)
    if obj is None or obj.uploaded_by != user.id:
        raise _hidden()
    path = Path(obj.storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = storage.write_bytes(path, data)
    obj.size_bytes = len(data)
    obj.sha256 = digest
    await session.flush()


async def complete_upload(session: AsyncSession, user: CurrentUser, file_id: UUID) -> FileObject:
    obj = await session.get(FileObject, file_id)
    if obj is None or obj.uploaded_by != user.id:
        raise _hidden()
    path = Path(obj.storage_key)
    if not path.exists() or obj.size_bytes <= 0:
        raise AppError("FILE_NOT_READY", 409, "文件尚未上传完成")
    if obj.content_type not in ALLOWED_TYPES:
        raise AppError("VALIDATION_FAILED", 422, "不支持的文件类型")
    data = path.read_bytes()
    if data.startswith(b"%PDF") and b"/Encrypt" in data[:8192]:
        raise AppError("VALIDATION_FAILED", 422, "加密 PDF 不可用")
    obj.scan_status = FileScanStatus.CLEAN
    obj.completed_at = datetime.now(timezone.utc)
    await _bind_to_current_version(session, obj)
    await session.flush()
    return obj


async def _bind_to_current_version(session: AsyncSession, obj: FileObject) -> None:
    parts = Path(obj.storage_key).parts
    thesis_id = UUID(parts[-2])
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or thesis.current_version_id is None:
        raise AppError("VALIDATION_FAILED", 422, "论文草稿不存在")
    existing = (
        await session.execute(
            select(ThesisVersionFile).where(
                ThesisVersionFile.thesis_version_id == thesis.current_version_id,
                ThesisVersionFile.purpose == obj.purpose,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.file_id = obj.id
    else:
        session.add(
            ThesisVersionFile(
                thesis_version_id=thesis.current_version_id,
                file_id=obj.id,
                purpose=obj.purpose,
            )
        )


async def can_access_file(session: AsyncSession, user: CurrentUser, obj: FileObject) -> bool:
    if user.role == RoleCode.SYSTEM_ADMIN:
        return False
    if obj.purpose == FilePurpose.ORIGINAL:
        if user.role == RoleCode.STUDENT and obj.uploaded_by == user.id:
            return True
        if user.role == RoleCode.SCHOOL_REVIEWER and user.tenant_id == obj.tenant_id:
            return True
        return False
    if obj.purpose == FilePurpose.ANONYMOUS:
        if user.role == RoleCode.STUDENT and obj.uploaded_by == user.id:
            return True
        if user.role == RoleCode.SCHOOL_REVIEWER and user.tenant_id == obj.tenant_id:
            return True
        if user.role == RoleCode.PLATFORM_REVIEWER:
            return True
        if user.role == RoleCode.EXPERT:
            from app.modules.dispatch.models import ExpertTask, ReviewRound
            from app.modules.expert.models import Expert
            from app.modules.thesis.models import ThesisVersionFile
            from app.shared.enums import ExpertTaskStatus

            expert = (
                await session.execute(select(Expert).where(Expert.user_id == user.id))
            ).scalar_one_or_none()
            if expert is None:
                return False
            link = (
                await session.execute(
                    select(ThesisVersionFile).where(ThesisVersionFile.file_id == obj.id)
                )
            ).scalar_one_or_none()
            if link is None:
                return False
            round_ = (
                await session.execute(
                    select(ReviewRound).where(ReviewRound.thesis_version_id == link.thesis_version_id)
                )
            ).scalar_one_or_none()
            if round_ is None:
                return False
            task = (
                await session.execute(
                    select(ExpertTask).where(
                        ExpertTask.round_id == round_.id,
                        ExpertTask.expert_id == expert.id,
                        ExpertTask.status == ExpertTaskStatus.IN_REVIEW,
                    )
                )
            ).scalar_one_or_none()
            return task is not None
    return False


async def authorize_download(session: AsyncSession, user: CurrentUser, file_id: UUID) -> dict:
    obj = await session.get(FileObject, file_id)
    if obj is None or not await can_access_file(session, user, obj):
        raise _hidden()
    token = create_access_token(
        user_id=user.id,
        role=user.role,
        tenant_id=user.tenant_id,
        data_scope={"file_id": str(file_id), "purpose": "download"},
    )
    return {
        "url": f"/api/v1/files/{file_id}/content?token={token}",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    }


async def load_file_bytes(session: AsyncSession, user: CurrentUser, file_id: UUID) -> tuple[FileObject, bytes]:
    obj = await session.get(FileObject, file_id)
    if obj is None or not await can_access_file(session, user, obj):
        raise _hidden()
    return obj, Path(obj.storage_key).read_bytes()
