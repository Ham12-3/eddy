"""The cost dashboard (PLAN.md M10)."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from eddy_api.config import Settings, get_settings
from eddy_api.db.models import LlmCall, TutorSession, User
from eddy_api.db.session import get_session
from eddy_api.main import create_app

# The account tests' signing key and token helper (tests import each other with importlib).
from .test_accounts import _PUBLIC_B64, token  # type: ignore[import-not-found]


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64, eddy_environment="test"
    )
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client


def call(route: str, cost: float, latency: int = 1000) -> LlmCall:
    return LlmCall(
        route=route,
        model="test-model",
        prompt_id="tutor",
        prompt_version="1.0.0",
        input_tokens=100,
        output_tokens=50,
        latency_ms=latency,
        cost_estimate_gbp=cost,
    )


def test_costs_add_up_by_route_and_per_lesson(client: TestClient, db_session: Session) -> None:
    user = User(email="s@example.test", role="student")
    db_session.add(user)
    db_session.flush()
    db_session.add_all(
        [
            TutorSession(student_id=user.id),
            TutorSession(student_id=user.id),
            call("tutor.turn", 0.02, 3000),
            call("safety.input", 0.001),
            call("scene.generate", 0.03),
        ]
    )
    db_session.flush()
    response = client.get("/v1/admin/costs", headers=token(f"admin:{uuid.uuid4()}", "admin"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lessons"] == 2
    assert body["total_gbp"] == pytest.approx(0.051)
    assert body["per_lesson_gbp"] == pytest.approx(0.0105)
    assert body["by_route"][0]["route"] == "scene.generate"
    assert body["by_day"][0]["calls"] == 3


def test_only_admins_see_costs(client: TestClient) -> None:
    response = client.get("/v1/admin/costs", headers=token(str(uuid.uuid4()), "student"))
    assert response.status_code == 403
