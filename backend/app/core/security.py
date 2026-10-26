from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_access_token(
    *,
    user_id: UUID,
    role: str,
    tenant_id: UUID | None,
    auth_version: int,
    data_scope: dict[str, Any] | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "auth_version": auth_version,
        "data_scope": data_scope or {},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.jwt_access_ttl_seconds)).timestamp()),
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"],
                         options={"require": ["sub", "role", "auth_version", "iat", "exp"]})
    scope = payload.get("data_scope")
    if scope is not None and not isinstance(scope, dict):
        raise jwt.InvalidTokenError("Invalid data scope")
    if (scope or {}).get("purpose") == "download":
        raise jwt.InvalidTokenError("File grants are not access tokens")
    return payload


def new_refresh_token() -> str:
    return uuid4().hex + uuid4().hex


def create_download_token(*, user_id: UUID, role: str, tenant_id: UUID | None, file_id: UUID, auth_version: int) -> tuple[str, datetime]:
    now = int(datetime.now(timezone.utc).timestamp())
    expires = now + 300
    payload = {"sub": str(user_id), "role": role, "tenant_id": str(tenant_id) if tenant_id else None,
               "aud": "file-download", "purpose": "download", "file_id": str(file_id),
               "auth_version": auth_version, "iat": now, "exp": expires, "jti": str(uuid4())}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256"), datetime.fromtimestamp(expires, timezone.utc)


def decode_download_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], audience="file-download",
                         options={"require": ["sub", "role", "file_id", "purpose", "auth_version", "iat", "exp"]})
    if payload["purpose"] != "download":
        raise jwt.InvalidTokenError("Invalid file grant purpose")
    return payload
