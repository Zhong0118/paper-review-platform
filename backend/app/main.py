from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import router as root_router
from app.core.config import get_settings
from app.core.logging import install_access_log_redaction
from app.core.exception_handlers import register_exception_handlers
from app.core.response import new_request_id
from app.lifespan import lifespan


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-Id") or new_request_id()
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        return response


def create_app() -> FastAPI:
    install_access_log_redaction()
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)
    app.include_router(root_router)
    return app


app = create_app()
