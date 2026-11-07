from dataclasses import dataclass
from uuid import UUID

from jwt import InvalidTokenError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token, decode_download_token
from app.shared.enums import RoleCode


@dataclass(frozen=True)
class VerifiedClaims:
    user_id: UUID
    role: str
    tenant_id: UUID | None
    auth_version: int


def _claims_from_verified_payload(payload: dict) -> VerifiedClaims:
    try:
        role = payload["role"]
        tenant_raw = payload["tenant_id"]
        auth_version = payload["auth_version"]
        if (not isinstance(role, str) or role not in RoleCode._value2member_map_
                or tenant_raw is not None and not isinstance(tenant_raw, str)
                or type(auth_version) is not int or auth_version < 1):
            raise ValueError("invalid identity claims")
        return VerifiedClaims(UUID(payload["sub"]), role,
                              UUID(tenant_raw) if tenant_raw is not None else None,
                              auth_version)
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Invalid identity claims") from exc


def verified_access_claims(token: str) -> VerifiedClaims:
    return _claims_from_verified_payload(decode_access_token(token))


def verified_download_claims(token: str) -> tuple[VerifiedClaims, UUID]:
    payload = decode_download_token(token)
    claims = _claims_from_verified_payload(payload)
    try:
        return claims, UUID(payload["file_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Invalid file grant") from exc


async def bind_candidate_identity(session: AsyncSession, claims: VerifiedClaims) -> None:
    if not isinstance(claims, VerifiedClaims):
        raise TypeError("verified claims required")
    await session.execute(text("""
        SELECT set_config('app.user_id', :user_id, true),
               set_config('app.role', :role, true),
               set_config('app.tenant_id', :tenant_id, true)
    """), {"user_id": str(claims.user_id), "role": claims.role,
           "tenant_id": str(claims.tenant_id) if claims.tenant_id else ""})
