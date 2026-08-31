from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import AppError
from app.core.response import error_response, new_request_id


def request_id_from(request: Request) -> str:
    return getattr(request.state, "request_id", None) or new_request_id()


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return error_response(
            code=exc.code,
            message=exc.message,
            http_status=exc.http_status,
            request_id=request_id_from(request),
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return error_response(
            code="VALIDATION_FAILED",
            message="请求校验失败",
            http_status=422,
            request_id=request_id_from(request),
            details={"errors": exc.errors()},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException):
        code = "RESOURCE_NOT_FOUND" if exc.status_code == 404 else "ACCESS_DENIED"
        if exc.status_code == 401:
            code = "AUTH_REQUIRED"
        return error_response(
            code=code,
            message=str(exc.detail) if exc.detail else "请求失败",
            http_status=exc.status_code,
            request_id=request_id_from(request),
        )
