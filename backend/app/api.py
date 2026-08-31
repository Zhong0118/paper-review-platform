from fastapi import APIRouter, Request
from sqlalchemy import text

from app.core.response import ok
from app.db.session import engine
from app.modules.auth.router import me_router, router as auth_router
from app.modules.files.router import router as files_router
from app.modules.thesis.router import school_router, student_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(me_router)
router.include_router(files_router)
router.include_router(student_router)
router.include_router(school_router)


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
