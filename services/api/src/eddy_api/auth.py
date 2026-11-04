"""Verification of the short-lived service tokens apps/web signs for every call (ADR-0008).

Only apps/web holds the private key. A token is an ES256 JWT with issuer `eddy-web`, audience
`eddy-api`, the caller's id as subject, a role claim, and a lifetime of 60 seconds. Each route
names the roles it accepts with `require_roles`; no route accepts a role it does not name
(ADR-0018).
"""

import base64
import binascii
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Literal, get_args

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from eddy_api.config import Settings, get_settings

# Keep in step with `roleSchema` in packages/schemas/src/index.ts.
Role = Literal["student", "parent", "admin", "system"]
ROLES: tuple[Role, ...] = get_args(Role)
ALGORITHM = "ES256"
# Tolerated clock difference between the web and api hosts.
CLOCK_LEEWAY_S = 5

logger = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)


class ServiceTokenConfigError(Exception):
    """The configured verification key is missing or unusable."""


class _Claims(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")

    sub: str = Field(min_length=1)
    role: Role
    iat: int
    exp: int


@dataclass(frozen=True)
class Caller:
    subject: str
    role: Role


@lru_cache(maxsize=4)
def load_public_key(public_key_b64: str) -> ec.EllipticCurvePublicKey:
    """Parse and check the verification key once. Only a P-256 public key is accepted."""
    if not public_key_b64:
        raise ServiceTokenConfigError("SERVICE_TOKEN_PUBLIC_KEY_B64 is not set (pnpm keys:dev).")
    try:
        key = load_pem_public_key(base64.b64decode(public_key_b64, validate=True))
    except (binascii.Error, ValueError) as exc:
        raise ServiceTokenConfigError(
            "SERVICE_TOKEN_PUBLIC_KEY_B64 is not a PEM public key."
        ) from exc
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ServiceTokenConfigError("SERVICE_TOKEN_PUBLIC_KEY_B64 must be a P-256 public key.")
    return key


def _unauthorised(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"}
    )


def verify_service_token(token: str, settings: Settings, now: float | None = None) -> Caller:
    try:
        key = load_public_key(settings.service_token_public_key_b64)
    except ServiceTokenConfigError as exc:
        logger.error("Service token verification unavailable: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service token verification is unavailable.",
        ) from exc

    try:
        decoded = jwt.decode(
            token,
            key,
            algorithms=[ALGORITHM],
            audience=settings.service_token_audience,
            issuer=settings.service_token_issuer,
            leeway=CLOCK_LEEWAY_S,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        claims = _Claims.model_validate(decoded)
    except (jwt.InvalidTokenError, ValidationError, TypeError, ValueError) as exc:
        raise _unauthorised("Invalid service token.") from exc

    max_lifetime = settings.service_token_max_lifetime_s
    current = time.time() if now is None else now
    if (
        claims.exp - claims.iat > max_lifetime
        or claims.exp > current + max_lifetime + CLOCK_LEEWAY_S
    ):
        raise _unauthorised("Service token lifetime is too long.")
    return Caller(subject=claims.sub, role=claims.role)


def require_roles(*allowed: Role) -> Callable[..., Caller]:
    """Dependency for a route that accepts only the named roles."""
    accepted = frozenset(allowed)

    def dependency(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
        settings: Annotated[Settings, Depends(get_settings)],
    ) -> Caller:
        if credentials is None:
            raise _unauthorised("Missing service token.")
        caller = verify_service_token(credentials.credentials, settings)
        if caller.role not in accepted:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail="This route does not accept your role."
            )
        return caller

    return dependency
