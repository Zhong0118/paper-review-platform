from typing import Any
from uuid import uuid4

from fastapi.responses import JSONResponse


def new_request_id() -> str:
    return str(uuid4())


def envelope(
    data: Any = None,
    *,
    code: str = "OK",
    message: str = "成功",
    request_id: str | None = None,
) -> dict[str, Any]:
    return {
        "request_id": request_id or new_request_id(),
        "code": code,
        "message": message,
        "data": {} if data is None else data,
    }


def ok(data: Any = None, request_id: str | None = None, message: str = "成功") -> dict[str, Any]:
    return envelope(data, request_id=request_id, message=message)


def error_response(
    *,
    code: str,
    message: str,
    http_status: int,
    request_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    payload = envelope(
        details or {},
        code=code,
        message=message,
        request_id=request_id,
    )
    return JSONResponse(status_code=http_status, content=payload)
