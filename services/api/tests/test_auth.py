import base64
import json
import re
import time
from collections.abc import Iterator
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from eddy_api.auth import Caller, require_roles
from eddy_api.config import Settings, get_settings
from eddy_api.main import create_app


def _keypair(curve: ec.EllipticCurve | None = None) -> tuple[bytes, bytes]:
    key = ec.generate_private_key(curve or ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private_pem, public_pem


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


@pytest.fixture(scope="module")
def keys() -> tuple[bytes, bytes]:
    return _keypair()


def _client(settings: Settings, app: FastAPI | None = None) -> Iterator[TestClient]:
    app = app or create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client


@pytest.fixture
def client(keys: tuple[bytes, bytes]) -> Iterator[TestClient]:
    yield from _client(Settings(service_token_public_key_b64=_b64(keys[1])))


def _token(private_pem: bytes, **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "eddy-web",
        "aud": "eddy-api",
        "sub": "user-123",
        "role": "student",
        "iat": now,
        "exp": now + 60,
    } | overrides
    return jwt.encode(claims, private_pem, algorithm="ES256")


def _b64url(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _get_hello(client: TestClient, token: str | None) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/v1/hello", headers=headers)


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_valid_token_is_accepted(client: TestClient, keys: tuple[bytes, bytes]) -> None:
    response = _get_hello(client, _token(keys[0]))
    assert response.status_code == 200
    assert response.json()["subject"] == "user-123"
    assert response.json()["role"] == "student"


def test_small_clock_skew_is_tolerated(client: TestClient, keys: tuple[bytes, bytes]) -> None:
    now = int(time.time())
    assert _get_hello(client, _token(keys[0], iat=now + 3, exp=now + 63)).status_code == 200


def test_missing_token_is_rejected(client: TestClient) -> None:
    assert _get_hello(client, None).status_code == 401


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-else"},
        {"iss": "not-eddy-web"},
        {"iat": int(time.time()) - 600, "exp": int(time.time()) - 540},
        {"exp": int(time.time()) + 3600},
        {"iat": int(time.time()) + 600, "exp": int(time.time()) + 660},
        {"role": "teacher"},
        {"role": ["student"]},
        {"sub": ""},
        {"exp": "soon"},
    ],
    ids=[
        "wrong-audience",
        "wrong-issuer",
        "expired",
        "lifetime-too-long",
        "issued-in-the-future",
        "unknown-role",
        "role-not-a-string",
        "empty-subject",
        "exp-not-a-number",
    ],
)
def test_bad_claims_are_rejected(
    client: TestClient, keys: tuple[bytes, bytes], overrides: dict[str, Any]
) -> None:
    assert _get_hello(client, _token(keys[0], **overrides)).status_code == 401


def test_token_signed_by_another_key_is_rejected(client: TestClient) -> None:
    other_private, _ = _keypair()
    assert _get_hello(client, _token(other_private)).status_code == 401


def test_unsigned_token_is_rejected(client: TestClient) -> None:
    now = int(time.time())
    claims = {"iss": "eddy-web", "aud": "eddy-api", "sub": "x", "role": "admin"}
    header = _b64url({"alg": "none", "typ": "JWT"})
    payload = _b64url(claims | {"iat": now, "exp": now + 60})
    assert _get_hello(client, f"{header}.{payload}.").status_code == 401


def test_hmac_token_is_rejected(client: TestClient) -> None:
    now = int(time.time())
    claims = {"iss": "eddy-web", "aud": "eddy-api", "sub": "x", "role": "admin"}
    forged = jwt.encode(claims | {"iat": now, "exp": now + 60}, "a" * 32, algorithm="HS256")
    assert _get_hello(client, forged).status_code == 401


@pytest.mark.parametrize(
    "configured_key",
    [
        "",
        "not base64 at all",
        _b64(b"-----BEGIN PUBLIC KEY-----\nnonsense\n-----END PUBLIC KEY-----\n"),
        _b64(_keypair()[0]),  # the private key by mistake
        _b64(_keypair(ec.SECP384R1())[1]),  # wrong curve
    ],
    ids=["unset", "not-base64", "not-a-key", "private-key", "p384-key"],
)
def test_misconfigured_key_returns_503(keys: tuple[bytes, bytes], configured_key: str) -> None:
    for misconfigured in _client(Settings(service_token_public_key_b64=configured_key)):
        assert _get_hello(misconfigured, _token(keys[0])).status_code == 503


def test_routes_only_accept_the_roles_they_name(keys: tuple[bytes, bytes]) -> None:
    app = FastAPI()

    @app.get("/admin-only")
    def admin_only(caller: Annotated[Caller, Depends(require_roles("admin"))]) -> str:
        return caller.subject

    for client in _client(Settings(service_token_public_key_b64=_b64(keys[1])), app):
        headers = {"Authorization": f"Bearer {_token(keys[0], role='student')}"}
        assert client.get("/admin-only", headers=headers).status_code == 403
        headers = {"Authorization": f"Bearer {_token(keys[0], role='admin')}"}
        assert client.get("/admin-only", headers=headers).status_code == 200


def test_settings_do_not_print_secrets() -> None:
    settings = Settings(maths_core_service_token="x" * 40)
    assert "x" * 40 not in repr(settings)
    assert "eddy:eddy@" not in repr(settings)


def test_every_v1_route_requires_a_token(client: TestClient) -> None:
    for route in create_app().routes:
        if isinstance(route, APIRoute) and route.path.startswith("/v1/"):
            path = re.sub(r"\{[^}]+\}", "x", route.path)
            for method in route.methods or ():
                assert client.request(method, path).status_code == 401, (method, route.path)
