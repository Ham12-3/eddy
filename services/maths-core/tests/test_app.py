from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from eddy_maths_core.config import Settings, get_settings
from eddy_maths_core.main import create_app

SECRET = "test-service-token-that-is-long-enough-1234"


def _client(token: str) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(maths_core_service_token=token)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def client() -> Iterator[TestClient]:
    yield from _client(SECRET)


def test_health_reports_sympy(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["sympy_version"]


def test_hello_accepts_the_shared_token(client: TestClient) -> None:
    response = client.get("/v1/hello", headers={"X-Service-Token": SECRET})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "headers",
    # Raw UTF-8 bytes: what a client sending non-ASCII really puts on the wire.
    [{}, {b"X-Service-Token": b"wrong"}, {b"X-Service-Token": "café".encode()}],
    ids=["missing", "wrong", "non-ascii"],
)
def test_hello_rejects_a_bad_token(client: TestClient, headers: dict[bytes, bytes]) -> None:
    assert client.get("/v1/hello", headers=headers).status_code == 401


@pytest.mark.parametrize(
    "configured", ["", "short", "shared-random-token"], ids=["unset", "too-short", "placeholder"]
)
def test_hello_returns_503_without_a_strong_token(configured: str) -> None:
    for unconfigured in _client(configured):
        response = unconfigured.get("/v1/hello", headers={"X-Service-Token": configured or "x"})
        assert response.status_code == 503


def test_settings_do_not_print_the_token() -> None:
    assert SECRET not in repr(Settings(maths_core_service_token=SECRET))
