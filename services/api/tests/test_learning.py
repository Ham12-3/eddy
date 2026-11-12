"""The onboarding diagnostic, today's plan and the progress map (SPEC.md sections 4.1 to 4.3)."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from eddy_api.db.models import Attempt, MisconceptionState, StudentProfile, User
from eddy_api.diagnostic import MAX_QUESTIONS
from eddy_api.seed.curriculum import load
from eddy_api.seed.upsert import seed

# The tutor tests' fake maths-core and token helpers (tests import each other with importlib).
from .test_tutor import (  # type: ignore[import-not-found]
    ANSWER,
    ROOT,
    WRONG,
    FakeItems,
    client_for,
    token,
)


@pytest.fixture
def seeded(db_session: Session) -> Session:
    seed(db_session, load(ROOT / "curriculum"))
    return db_session


@pytest.fixture
def api(seeded: Session) -> Iterator[tuple[TestClient, Session, uuid.UUID]]:
    user = User(email=f"{uuid.uuid4().hex}@example.test", role="student")
    seeded.add(user)
    seeded.flush()
    seeded.add(
        StudentProfile(
            user_id=user.id,
            birth_year=2011,
            birth_month=3,
            board="AQA",
            tier="FOUNDATION",
            target_grade=4,
            setup_completed_at=datetime.now(UTC),
            preferences={},
        )
    )
    seeded.flush()
    with client_for(seeded, items=FakeItems()) as client:
        yield client, seeded, user.id


def test_the_diagnostic_asks_checks_and_finishes(
    api: tuple[TestClient, Session, uuid.UUID],
) -> None:
    client, session, learner = api
    headers = token(str(learner))
    started = client.post("/v1/diagnostic", headers=headers)
    assert started.status_code == 200, started.text
    body = started.json()
    question = body["question"]
    assert question["node"] == "N1"
    assert question["number"] == 1
    assert "answer" not in str(question).lower()

    # Resuming returns the same question.
    again = client.post("/v1/diagnostic", headers=headers).json()
    assert again["id"] == body["id"]
    assert again["question"]["item_id"] == question["item_id"]

    unreadable = client.post(
        f"/v1/diagnostic/{body['id']}/answer",
        json={"item_id": question["item_id"], "mathjson": "x?", "confidence": 2},
        headers=headers,
    )
    assert unreadable.status_code == 422

    wrong = client.post(
        f"/v1/diagnostic/{body['id']}/answer",
        json={"item_id": question["item_id"], "mathjson": WRONG, "confidence": 4},
        headers=headers,
    )
    assert wrong.status_code == 200, wrong.text
    reveal = wrong.json()
    assert reveal["correct"] is False
    assert reveal["misconception"]
    # Only N1 has templates in the fake, so one question and the diagnostic is done.
    assert reveal["next"]["done"] is True
    track = session.scalar(select(MisconceptionState))
    assert track is not None
    assert track.status == "SUSPECTED"
    attempt = session.scalar(select(Attempt))
    assert attempt is not None
    assert attempt.is_diagnostic
    assert attempt.confidence_self_report == 4
    profile = session.get(StudentProfile, learner)
    assert profile is not None
    assert profile.diagnostic_completed_at is not None

    # Coming back after finishing shows it done, and never starts a second diagnostic.
    back = client.post("/v1/diagnostic", headers=headers).json()
    assert back["id"] == body["id"]
    assert back["done"] is True

    repeat = client.post(
        f"/v1/diagnostic/{body['id']}/answer",
        json={"item_id": question["item_id"], "mathjson": ANSWER, "confidence": 4},
        headers=headers,
    )
    assert repeat.status_code == 409


def test_i_do_not_know_counts_as_wrong_with_no_slip(
    api: tuple[TestClient, Session, uuid.UUID],
) -> None:
    client, session, learner = api
    headers = token(str(learner))
    body = client.post("/v1/diagnostic", headers=headers).json()
    response = client.post(
        f"/v1/diagnostic/{body['id']}/answer",
        json={"item_id": body["question"]["item_id"], "dont_know": True, "confidence": 1},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["misconception"] is None
    assert session.scalar(select(func.count()).select_from(MisconceptionState)) == 0


def test_another_student_cannot_answer_my_diagnostic(
    api: tuple[TestClient, Session, uuid.UUID],
) -> None:
    client, session, learner = api
    body = client.post("/v1/diagnostic", headers=token(str(learner))).json()
    other = User(email="other@example.test", role="student")
    session.add(other)
    session.flush()
    response = client.post(
        f"/v1/diagnostic/{body['id']}/answer",
        json={"item_id": body["question"]["item_id"], "mathjson": ANSWER, "confidence": 3},
        headers=token(str(other.id)),
    )
    assert response.status_code == 404


def test_plan_and_progress(api: tuple[TestClient, Session, uuid.UUID]) -> None:
    client, _, learner = api
    headers = token(str(learner))
    plan = client.get("/v1/me/plan", headers=headers)
    assert plan.status_code == 200, plan.text
    assert plan.json()["diagnostic_done"] is False
    assert plan.json()["node"] == "N1"
    assert plan.json()["minutes"] > 0
    progress = client.get("/v1/me/progress", headers=headers)
    assert progress.status_code == 200
    nodes = progress.json()["nodes"]
    assert [n["code"] for n in nodes] == ["N1"]
    assert nodes[0]["state"] == "not-started"


def test_the_diagnostic_stops_at_its_limit() -> None:
    assert 15 <= MAX_QUESTIONS <= 24
