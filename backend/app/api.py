from fastapi import APIRouter, Request
from sqlalchemy import text

from app.core.response import ok
from app.db.session import engine
from app.modules.auth.router import me_router, router as auth_router
from app.modules.files.router import router as files_router
from app.modules.dispatch.router import expert_router, platform_router, task_router
from app.modules.thesis.router import school_router, student_router
from app.modules.tenant.router import school_admin_router, system_router
from app.modules.user.router import school_member_router

from app.modules.expert.router import router as expert_management_router

from app.modules.tenant.catalog_router import router as catalog_router

from app.modules.review.correction_router import router as correction_router
from app.modules.statistics.dashboard_router import router as dashboard_router

from app.modules.thesis.sensitive_terms import router as sensitive_router

from app.modules.files.transform_router import router as transform_router

router = APIRouter()
router.include_router(transform_router)
router.include_router(sensitive_router)
router.include_router(dashboard_router)
router.include_router(correction_router)
router.include_router(catalog_router)
router.include_router(expert_management_router)
router.include_router(auth_router)
router.include_router(me_router)
router.include_router(files_router)
router.include_router(student_router)
router.include_router(school_router)
router.include_router(platform_router)
router.include_router(expert_router)
router.include_router(task_router)
router.include_router(system_router)
router.include_router(school_admin_router)
router.include_router(school_member_router)


@router.get("/healthz")
async def healthz(request: Request):
    return ok({"status": "ok"}, request_id=getattr(request.state, "request_id", None))


@router.get("/readyz")
async def readyz(request: Request):
    request_id = getattr(request.state, "request_id", None)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            version = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one_or_none()
        if not version:
            return ok({"status": "not_migrated"}, request_id=request_id)
        return ok({"status": "ready", "alembic": version}, request_id=request_id)
    except Exception:
        return ok({"status": "not_migrated"}, request_id=request_id)
