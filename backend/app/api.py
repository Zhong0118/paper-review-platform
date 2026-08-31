from fastapi import APIRouter, Request

from app.core.response import ok

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request):
    return ok({"status": "ok"}, request_id=getattr(request.state, "request_id", None))


@router.get("/readyz")
async def readyz(request: Request):
    return ok(
        {"status": "not_migrated"},
        request_id=getattr(request.state, "request_id", None),
    )
