"""Parent links, the parent dashboard, download my data and erasure (ADR-0033)."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from eddy_api import jobs, mail
from eddy_api.config import Settings, get_settings
from eddy_api.db.models import (
    AuditLog,
    DataRequest,
    ParentLink,
    PendingSignup,
    SafeguardingEvent,
    StudentProfile,
    TutorSession,
    User,
)
from eddy_api.db.session import get_session
from eddy_api.main import create_app
from eddy_api.routes.accounts import get_link_limiter, get_signup_limiter
from eddy_api.tutor.ratelimit import MemoryLimiter

# The account tests' signing key and helpers (tests import each other with importlib).
from .test_accounts import (  # type: ignore[import-not-found]
    _PUBLIC_B64,
    VISITOR,
    as_student,
    auth,
    create_user,
    invite,
    sign_up,
    token,
)


@pytest.fixture
def api(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[TestClient, Session, list[tuple[str, str]]]]:
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(mail, "notify", lambda _s, to, subject, _b: sent.append((to, subject)))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64, eddy_environment="test"
    )
    app.dependency_overrides[get_session] = lambda: db_session
    limiter = MemoryLimiter(per_minute=100, per_day=1000)
    app.dependency_overrides[get_signup_limiter] = lambda: limiter
    app.dependency_overrides[get_link_limiter] = lambda: limiter
    with TestClient(app) as client:
        yield client, db_session, sent


def a_student(client: TestClient, session: Session) -> uuid.UUID:
    invite(session)
    sign_up(client)
    return uuid.UUID(str(create_user(client)["id"]))


def a_parent(client: TestClient, code: str, email: str = "parent@example.test") -> uuid.UUID:
    signup = client.post(
        "/v1/auth/parent-signups",
        json={"email": email, "code": code, "adult_confirmed": True, "visitor": VISITOR},
        headers=auth(),
    )
    assert signup.status_code == 204, signup.text
    return uuid.UUID(str(create_user(client, email)["id"]))


def as_parent(parent: uuid.UUID) -> dict[str, str]:
    headers: dict[str, str] = token(str(parent), "parent")
    return headers


def test_a_parent_signs_up_with_a_code_and_sees_nothing_until_accepted(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, sent = api
    student = a_student(client, session)
    made = client.post("/v1/me/parent-links/code", headers=as_student(student))
    assert made.status_code == 200
    code = made.json()["code"]
    assert len(code) == 10

    parent = a_parent(client, code.lower())
    assert session.get(User, parent).role == "parent"  # type: ignore[union-attr]
    assert session.get(StudentProfile, parent) is None
    assert session.scalar(select(func.count()).select_from(PendingSignup)) == 0

    children = client.get("/v1/parent/children", headers=as_parent(parent)).json()
    assert children[0]["status"] == "REQUESTED"
    assert children[0]["student_email"] is None
    link = children[0]["link_id"]
    early = client.get(f"/v1/parent/children/{link}", headers=as_parent(parent))
    assert early.status_code == 403

    mine = client.get("/v1/me/parent-links", headers=as_student(student)).json()
    assert mine["links"][0]["parent_email"] == "parent@example.test"
    assert client.get("/v1/me", headers=as_student(student)).json()["parent_visible"] is False

    accepted = client.post(f"/v1/me/parent-links/{link}/accept", headers=as_student(student))
    assert accepted.json()["links"][0]["status"] == "ACTIVE"
    assert ("parent@example.test", "Eddy: your link was accepted") in sent
    assert client.get("/v1/me", headers=as_student(student)).json()["parent_visible"] is True

    view = client.get(f"/v1/parent/children/{link}", headers=as_parent(parent))
    assert view.status_code == 200
    assert set(view.json()) == {
        "secured",
        "learning",
        "minutes_this_week",
        "recent",
        "reviews_due_this_week",
        "next_review",
    }
    views = session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.action == "parent.view_dashboard", AuditLog.target_id == str(student))
    )
    assert views == 1

    # The preview shows the student exactly that, and is not a parent view.
    preview = client.get("/v1/me/parent-view", headers=as_student(student))
    assert preview.json() == view.json()


def test_either_side_can_end_a_link_and_the_other_is_told(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, sent = api
    student = a_student(client, session)
    code = client.post("/v1/me/parent-links/code", headers=as_student(student)).json()["code"]
    parent = a_parent(client, code)
    link = client.get("/v1/parent/children", headers=as_parent(parent)).json()[0]["link_id"]
    client.post(f"/v1/me/parent-links/{link}/accept", headers=as_student(student))

    ended = client.post(f"/v1/parent/links/{link}/end", headers=as_parent(parent))
    assert ended.json() == []
    assert any(subject == "Eddy: a parent link has ended" for _, subject in sent)
    row = session.get(ParentLink, uuid.UUID(link))
    assert row is not None
    assert (row.status, row.ended_by) == ("ENDED", "PARENT")
    assert client.get(f"/v1/parent/children/{link}", headers=as_parent(parent)).status_code == 404

    # A new code: an existing parent adds it, and the student declines.
    code = client.post("/v1/me/parent-links/code", headers=as_student(student)).json()["code"]
    again = client.post("/v1/parent/links", json={"code": code}, headers=as_parent(parent))
    assert again.json()[0]["status"] == "REQUESTED"
    reused = client.post("/v1/parent/links", json={"code": code}, headers=as_parent(parent))
    assert reused.status_code == 404  # a code works once
    second = again.json()[0]["link_id"]
    declined = client.post(f"/v1/me/parent-links/{second}/end", headers=as_student(student))
    assert declined.json()["links"] == []


def test_a_student_cannot_use_parent_routes_or_another_students_links(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, _ = api
    student = a_student(client, session)
    assert client.get("/v1/parent/children", headers=as_student(student)).status_code == 403
    code = client.post("/v1/me/parent-links/code", headers=as_student(student)).json()["code"]
    parent = a_parent(client, code)
    link = client.get("/v1/parent/children", headers=as_parent(parent)).json()[0]["link_id"]
    other = User(email="other@example.test", role="student")
    session.add(other)
    session.flush()
    response = client.post(f"/v1/me/parent-links/{link}/accept", headers=as_student(other.id))
    assert response.status_code in (401, 404)


def test_a_wrong_or_old_code_does_not_sign_a_parent_up(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, _, _ = api
    response = client.post(
        "/v1/auth/parent-signups",
        json={
            "email": "p@example.test",
            "code": "ABCDEFGHJK",
            "adult_confirmed": True,
            "visitor": VISITOR,
        },
        headers=auth(),
    )
    assert response.status_code == 409


def test_download_my_data_holds_everything_and_records_the_request(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, _ = api
    student = a_student(client, session)
    viewed = client.get("/v1/me/export", headers=as_student(student))
    assert viewed.status_code == 200
    assert session.scalar(select(func.count()).select_from(DataRequest)) == 0  # viewing only
    data = client.get("/v1/me/export?download=true", headers=as_student(student))
    assert data.status_code == 200
    body = data.json()
    assert body["account"]["email"] == "sam@example.test"
    assert body["profile"]["birth_month"] is not None
    assert body["safety_records"] == "None."
    request = session.scalar(select(DataRequest).where(DataRequest.user_id == student))
    assert request is not None
    assert (request.kind, request.status) == ("EXPORT", "COMPLETED")


def test_erasure_deletes_an_account_without_safety_records(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, _ = api
    student = a_student(client, session)
    client.post(
        "/v1/me/data-requests",
        json={"kind": "DELETE", "confirm": True},
        headers=as_student(student),
    )
    assert jobs.erasures(session) == 1
    assert session.get(User, student) is None
    request = session.scalar(select(DataRequest).where(DataRequest.kind == "DELETE"))
    assert request is not None
    assert (request.status, request.user_id) == ("COMPLETED", None)


def test_erasure_waits_for_review_then_keeps_an_anonymous_anchor(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, _ = api
    student = a_student(client, session)
    lesson = TutorSession(student_id=student)
    session.add(lesson)
    session.flush()
    session.execute(
        text(
            "INSERT INTO checkpoints"
            " (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)"
            " VALUES (:t, '', 'c1', '{}', '{}')"
        ),
        {"t": str(lesson.id)},
    )
    event = SafeguardingEvent(
        student_id=student,
        tutor_session_id=lesson.id,
        category="test",
        severity="LOW",
        excerpt="x",
        action_taken="script shown",
    )
    session.add(event)
    session.flush()
    client.post(
        "/v1/me/data-requests",
        json={"kind": "DELETE", "confirm": True},
        headers=as_student(student),
    )
    # Unreviewed: the request waits, and nothing is erased.
    assert jobs.erasures(session, datetime.now(UTC)) == 0
    request = session.scalar(select(DataRequest).where(DataRequest.kind == "DELETE"))
    assert request is not None
    assert request.status == "IN_PROGRESS"
    assert session.get(StudentProfile, student) is not None

    event.reviewed_at = datetime.now(UTC)
    session.flush()
    assert jobs.erasures(session, datetime.now(UTC)) == 1
    user = session.get(User, student)
    assert user is not None
    assert user.email.endswith("@erased.invalid")
    assert session.get(StudentProfile, student) is None
    assert session.scalar(select(func.count()).select_from(SafeguardingEvent)) == 1
    assert session.scalar(text("SELECT count(*) FROM checkpoints")) == 0


def test_asking_to_delete_ends_parent_links_at_once(
    api: tuple[TestClient, Session, list[tuple[str, str]]],
) -> None:
    client, session, sent = api
    student = a_student(client, session)
    code = client.post("/v1/me/parent-links/code", headers=as_student(student)).json()["code"]
    parent = a_parent(client, code)
    link = client.get("/v1/parent/children", headers=as_parent(parent)).json()[0]["link_id"]
    client.post(f"/v1/me/parent-links/{link}/accept", headers=as_student(student))
    client.post(
        "/v1/me/data-requests",
        json={"kind": "DELETE", "confirm": True},
        headers=as_student(student),
    )
    assert client.get("/v1/parent/children", headers=as_parent(parent)).json() == []
    view = client.get(f"/v1/parent/children/{link}", headers=as_parent(parent))
    assert view.status_code == 404
    assert ("parent@example.test", "Eddy: a parent link has ended") in sent
