"""Sign-up, the Auth.js adapter routes and the student's own account (ADR-0023, ADR-0032)."""

import base64
import hashlib
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from eddy_api.config import Settings, get_settings
from eddy_api.db.models import (
    AuditLog,
    ConcernReport,
    InviteCode,
    InviteRedemption,
    NoticeAcknowledgement,
    PendingSignup,
    StudentProfile,
    TutorSession,
    User,
)
from eddy_api.db.models import Session as SessionRow
from eddy_api.db.session import get_session
from eddy_api.main import create_app
from eddy_api.routes.accounts import (
    LINKS_PER_DAY,
    LINKS_PER_MINUTE,
    SIGNUPS_PER_DAY,
    SIGNUPS_PER_MINUTE,
    age_on,
    get_link_limiter,
    get_signup_limiter,
    normalise_invite,
)
from eddy_api.tutor.ratelimit import MemoryLimiter

_KEY = ec.generate_private_key(ec.SECP256R1())
_PUBLIC_B64 = base64.b64encode(
    _KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
).decode()


def token(subject: str, role: str) -> dict[str, str]:
    now = int(time.time())
    claims = {
        "iss": "eddy-web",
        "aud": "eddy-api",
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + 60,
    }
    return {"Authorization": f"Bearer {jwt.encode(claims, _KEY, algorithm='ES256')}"}


AUTH = token("system:auth", "system")
VISITOR = "a" * 64


def as_student(user_id: uuid.UUID) -> dict[str, str]:
    return token(str(user_id), "student")


@pytest.fixture
def api(db_session: Session) -> Iterator[tuple[TestClient, Session]]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64, eddy_environment="test"
    )
    app.dependency_overrides[get_session] = lambda: db_session
    limiter = MemoryLimiter(per_minute=SIGNUPS_PER_MINUTE, per_day=SIGNUPS_PER_DAY)
    app.dependency_overrides[get_signup_limiter] = lambda: limiter
    links = MemoryLimiter(per_minute=LINKS_PER_MINUTE, per_day=LINKS_PER_DAY)
    app.dependency_overrides[get_link_limiter] = lambda: links
    with TestClient(app) as client:
        yield client, db_session


def invite(session: Session, code: str = "BETA2026", **values: object) -> InviteCode:
    row = InviteCode(code=code, cohort="beta", max_uses=values.pop("max_uses", 5), **values)
    session.add(row)
    session.flush()
    return row


def thirteen_last_month() -> tuple[int, int]:
    """A birth month and year that make someone exactly 13 since last month."""
    today = date.today()
    month, year = today.month - 1, today.year - 13
    if month == 0:
        month, year = 12, year - 1
    return year, month


def sign_up(client: TestClient, email: str = "Sam@Example.test", code: str = "beta-2026") -> None:
    year, month = thirteen_last_month()
    response = client.post(
        "/v1/auth/signups",
        json={
            "email": email,
            "invite_code": code,
            "birth_year": year,
            "birth_month": month,
            "visitor": VISITOR,
        },
        headers=AUTH,
    )
    assert response.status_code == 204, response.text


def create_user(client: TestClient, email: str = "sam@example.test") -> dict[str, object]:
    response = client.post("/v1/auth/users", json={"email": email}, headers=AUTH)
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


def test_age_counts_the_birth_month_as_not_yet_reached() -> None:
    assert age_on(date(2026, 11, 11), 2013, 10) == 13
    assert age_on(date(2026, 11, 11), 2013, 11) == 12
    assert age_on(date(2026, 11, 11), 2013, 12) == 12
    assert age_on(date(2026, 1, 1), 2012, 12) == 13


def test_invite_codes_match_without_case_spaces_or_hyphens() -> None:
    assert normalise_invite(" beta-2026 ") == "BETA2026"


def test_an_invite_is_valid_until_used_up_or_expired(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session)
    invite(session, "USEDUP", max_uses=1, used_count=1)
    invite(session, "OLD", expires_at=datetime.now(UTC) - timedelta(days=1))

    def valid(code: str) -> bool:
        response = client.post(
            "/v1/auth/invites/check", json={"code": code, "visitor": VISITOR}, headers=AUTH
        )
        assert response.status_code == 200
        result: bool = response.json()["valid"]
        return result

    assert valid("beta 2026")
    assert not valid("USEDUP")
    assert not valid("OLD")
    assert not valid("NOPE")


def test_only_the_web_auth_caller_reaches_the_auth_routes(
    api: tuple[TestClient, Session],
) -> None:
    client, _ = api
    for headers in (token("system:hello-page", "system"), token(str(uuid.uuid4()), "student")):
        response = client.post(
            "/v1/auth/invites/check", json={"code": "X", "visitor": VISITOR}, headers=headers
        )
        assert response.status_code == 403


def test_nothing_is_stored_for_someone_under_13(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session)
    today = date.today()
    response = client.post(
        "/v1/auth/signups",
        json={
            "email": "young@example.test",
            "invite_code": "BETA2026",
            "birth_year": today.year - 13,
            "birth_month": today.month,
            "visitor": VISITOR,
        },
        headers=AUTH,
    )
    assert response.status_code == 422
    assert session.scalar(select(func.count()).select_from(PendingSignup)) == 0


def test_a_used_up_invite_is_refused_at_sign_up(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session, "FULL", max_uses=1, used_count=1)
    year, month = thirteen_last_month()
    response = client.post(
        "/v1/auth/signups",
        json={
            "email": "sam@example.test",
            "invite_code": "FULL",
            "birth_year": year,
            "birth_month": month,
            "visitor": VISITOR,
        },
        headers=AUTH,
    )
    assert response.status_code == 409


def test_invite_guesses_are_slowed_per_visitor(api: tuple[TestClient, Session]) -> None:
    client, _ = api
    statuses = [
        client.post(
            "/v1/auth/invites/check", json={"code": f"GUESS{n}", "visitor": VISITOR}, headers=AUTH
        ).status_code
        for n in range(SIGNUPS_PER_MINUTE + 1)
    ]
    assert statuses[:-1] == [200] * SIGNUPS_PER_MINUTE
    assert statuses[-1] == 429
    other = client.post(
        "/v1/auth/invites/check", json={"code": "GUESS", "visitor": "b" * 64}, headers=AUTH
    )
    assert other.status_code == 200


def test_sign_up_makes_the_account_profile_and_redemption_in_one_go(
    api: tuple[TestClient, Session],
) -> None:
    client, session = api
    code = invite(session)
    sign_up(client)
    pending = session.scalar(select(PendingSignup))
    assert pending is not None
    assert pending.email == "sam@example.test"

    allowed = client.post("/v1/auth/may-sign-in", json={"email": "SAM@example.test"}, headers=AUTH)
    assert allowed.json() == {"allowed": True}

    user = create_user(client)
    assert user["role"] == "student"
    assert user["email"] == "sam@example.test"
    user_id = uuid.UUID(str(user["id"]))
    profile = session.get(StudentProfile, user_id)
    assert profile is not None
    assert profile.setup_completed_at is None
    assert (profile.birth_year, profile.birth_month) == thirteen_last_month()
    redemption = session.get(InviteRedemption, user_id)
    assert redemption is not None
    assert redemption.invite_code == "BETA2026"
    session.refresh(code)
    assert code.used_count == 1
    assert session.scalar(select(func.count()).select_from(PendingSignup)) == 0
    actions = session.scalars(select(AuditLog.action).where(AuditLog.actor_id == user_id)).all()
    assert "account.create" in actions


def test_no_account_is_made_without_a_pending_sign_up(api: tuple[TestClient, Session]) -> None:
    client, _ = api
    response = client.post("/v1/auth/users", json={"email": "who@example.test"}, headers=AUTH)
    assert response.status_code == 409
    allowed = client.post("/v1/auth/may-sign-in", json={"email": "who@example.test"}, headers=AUTH)
    assert allowed.json() == {"allowed": False}


def test_signing_up_again_with_an_existing_address_stores_nothing(
    api: tuple[TestClient, Session],
) -> None:
    client, session = api
    invite(session)
    sign_up(client)
    create_user(client)
    sign_up(client)
    assert session.scalar(select(func.count()).select_from(PendingSignup)) == 0


def test_the_invite_runs_out_between_sign_up_and_link(api: tuple[TestClient, Session]) -> None:
    client, session = api
    code = invite(session, max_uses=1)
    sign_up(client, "a@example.test")
    sign_up(client, "b@example.test")
    create_user(client, "a@example.test")
    response = client.post("/v1/auth/users", json={"email": "b@example.test"}, headers=AUTH)
    assert response.status_code == 409
    session.refresh(code)
    assert code.used_count == 1


def test_sessions_are_looked_up_by_hash_and_end_with_the_account(
    api: tuple[TestClient, Session],
) -> None:
    client, session = api
    invite(session)
    sign_up(client)
    user = create_user(client)
    digest = hashlib.sha256(b"session-token").hexdigest()
    expires = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    made = client.post(
        "/v1/auth/sessions",
        json={"session_token_hash": digest, "user_id": user["id"], "expires": expires},
        headers=AUTH,
    )
    assert made.status_code == 200, made.text

    found = client.post(
        "/v1/auth/sessions/lookup", json={"session_token_hash": digest}, headers=AUTH
    )
    assert found.json()["user"]["id"] == user["id"]

    later = (datetime.now(UTC) + timedelta(days=40)).isoformat()
    updated = client.patch(
        "/v1/auth/sessions", json={"session_token_hash": digest, "expires": later}, headers=AUTH
    )
    assert updated.status_code == 200

    row = session.get(User, uuid.UUID(str(user["id"])))
    assert row is not None
    row.deactivated_at = datetime.now(UTC)
    session.flush()
    gone = client.post(
        "/v1/auth/sessions/lookup", json={"session_token_hash": digest}, headers=AUTH
    )
    assert gone.json() is None

    client.post("/v1/auth/sessions/delete", json={"session_token_hash": digest}, headers=AUTH)
    assert session.scalar(select(func.count()).select_from(SessionRow)) == 0


def test_an_expired_session_is_not_found(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session)
    sign_up(client)
    user = create_user(client)
    digest = hashlib.sha256(b"old").hexdigest()
    session.add(
        SessionRow(
            session_token_hash=digest,
            user_id=uuid.UUID(str(user["id"])),
            expires=datetime.now(UTC) - timedelta(seconds=1),
        )
    )
    session.flush()
    found = client.post(
        "/v1/auth/sessions/lookup", json={"session_token_hash": digest}, headers=AUTH
    )
    assert found.json() is None


def test_a_sign_in_link_works_once_and_a_new_one_replaces_it(
    api: tuple[TestClient, Session],
) -> None:
    client, _ = api
    expires = (datetime.now(UTC) + timedelta(minutes=30)).isoformat()
    first = {"identifier": "Sam@example.test", "token": "a" * 64, "expires": expires}
    second = {"identifier": "sam@example.test", "token": "b" * 64, "expires": expires}
    assert client.post("/v1/auth/verification-tokens", json=first, headers=AUTH).status_code == 200
    assert client.post("/v1/auth/verification-tokens", json=second, headers=AUTH).status_code == 200

    use_first = client.post(
        "/v1/auth/verification-tokens/use",
        json={"identifier": "sam@example.test", "token": "a" * 64},
        headers=AUTH,
    )
    assert use_first.json() is None
    use = {"identifier": "sam@example.test", "token": "b" * 64}
    used = client.post("/v1/auth/verification-tokens/use", json=use, headers=AUTH)
    assert used.json()["token"] == "b" * 64
    again = client.post("/v1/auth/verification-tokens/use", json=use, headers=AUTH)
    assert again.json() is None


@pytest.fixture
def student(api: tuple[TestClient, Session]) -> uuid.UUID:
    client, session = api
    invite(session)
    sign_up(client)
    return uuid.UUID(str(create_user(client)["id"]))


def test_set_up_records_the_choices_and_marks_set_up_done(
    api: tuple[TestClient, Session], student: uuid.UUID
) -> None:
    client, _ = api
    me = client.get("/v1/me", headers=as_student(student))
    assert me.status_code == 200
    assert me.json()["profile"]["setup_completed_at"] is None
    assert me.json()["preferences"]["session_minutes"] == 25

    bad = client.put(
        "/v1/me/profile",
        json={"exam_series": "2027-summer", "target_grade": 9, "is_resitter": False},
        headers=as_student(student),
    )
    assert bad.status_code == 422
    done = client.put(
        "/v1/me/profile",
        json={"exam_series": "2027-summer", "target_grade": 4, "is_resitter": False},
        headers=as_student(student),
    )
    assert done.status_code == 200, done.text
    profile = done.json()["profile"]
    assert profile["board"] == "AQA"
    assert profile["tier"] == "FOUNDATION"
    assert profile["setup_completed_at"] is not None


def test_a_notice_acknowledgement_is_recorded_once_per_version(
    api: tuple[TestClient, Session], student: uuid.UUID
) -> None:
    client, session = api
    body = {"notice_key": "privacy", "version": "0.1.0"}
    for _ in range(2):
        response = client.post("/v1/me/notices", json=body, headers=as_student(student))
        assert response.status_code == 200
    assert [n["version"] for n in response.json()["notices"]] == ["0.1.0"]
    count = session.scalar(select(func.count()).select_from(NoticeAcknowledgement))
    assert count == 1


def test_preferences_are_checked(api: tuple[TestClient, Session], student: uuid.UUID) -> None:
    client, _ = api
    good = {"theme": "dark", "reading": "dyslexia", "narration_speed": 0.75}
    response = client.put("/v1/me/preferences", json=good, headers=as_student(student))
    assert response.status_code == 200
    assert response.json()["preferences"]["theme"] == "dark"
    for bad in ({"narration_speed": 2}, {"colour": "pink"}, {"session_minutes": 5}):
        response = client.put("/v1/me/preferences", json=bad, headers=as_student(student))
        assert response.status_code == 422


def test_deleting_the_account_deactivates_it_and_signs_it_out_at_once(
    api: tuple[TestClient, Session], student: uuid.UUID
) -> None:
    client, session = api
    session.add(
        SessionRow(
            session_token_hash=hashlib.sha256(b"t").hexdigest(),
            user_id=student,
            expires=datetime.now(UTC) + timedelta(days=1),
        )
    )
    session.flush()
    unconfirmed = client.post(
        "/v1/me/data-requests", json={"kind": "DELETE"}, headers=as_student(student)
    )
    assert unconfirmed.status_code == 422
    response = client.post(
        "/v1/me/data-requests",
        json={"kind": "DELETE", "confirm": True},
        headers=as_student(student),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "RECEIVED"
    assert session.scalar(select(func.count()).select_from(SessionRow)) == 0
    assert client.get("/v1/me", headers=as_student(student)).status_code == 401


def test_an_export_request_is_not_duplicated(
    api: tuple[TestClient, Session], student: uuid.UUID
) -> None:
    client, _ = api
    first = client.post(
        "/v1/me/data-requests", json={"kind": "EXPORT"}, headers=as_student(student)
    )
    second = client.post(
        "/v1/me/data-requests", json={"kind": "EXPORT"}, headers=as_student(student)
    )
    assert first.json()["id"] == second.json()["id"]
    listed = client.get("/v1/me/data-requests", headers=as_student(student))
    assert len(listed.json()) == 1


def test_a_concern_links_only_the_students_own_lesson(
    api: tuple[TestClient, Session], student: uuid.UUID
) -> None:
    client, session = api
    other = User(email="other@example.test", role="student")
    session.add(other)
    session.flush()
    theirs = TutorSession(student_id=other.id)
    mine = TutorSession(student_id=student)
    session.add_all([theirs, mine])
    session.flush()
    for lesson, expected in ((theirs.id, None), (mine.id, mine.id)):
        response = client.post(
            "/v1/me/concerns",
            json={
                "category": "SAFETY",
                "message": "Someone is bothering me",
                "page": "/learn",
                "tutor_session_id": str(lesson),
            },
            headers=as_student(student),
        )
        assert response.status_code == 200, response.text
        row = session.get(ConcernReport, uuid.UUID(response.json()["id"]))
        assert row is not None
        assert row.tutor_session_id == expected


def test_a_concern_page_is_a_path_only(api: tuple[TestClient, Session], student: uuid.UUID) -> None:
    client, _ = api
    response = client.post(
        "/v1/me/concerns",
        json={"category": "OTHER", "message": "x", "page": "/learn?email=a@b.test"},
        headers=as_student(student),
    )
    assert response.status_code == 422


def test_a_parent_or_unknown_account_cannot_use_the_student_routes(
    api: tuple[TestClient, Session],
) -> None:
    client, _ = api
    assert client.get("/v1/me", headers=as_student(uuid.uuid4())).status_code == 401
    assert client.get("/v1/me", headers=token("not-a-uuid", "student")).status_code == 401
    assert client.get("/v1/me", headers=token(str(uuid.uuid4()), "parent")).status_code == 403


def test_sign_in_links_are_limited_per_address(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session)
    sign_up(client)
    body = {"email": "sam@example.test", "sending": True}
    answers = [
        client.post("/v1/auth/may-sign-in", json=body, headers=AUTH).json()["allowed"]
        for _ in range(LINKS_PER_MINUTE + 1)
    ]
    assert answers == [True] * LINKS_PER_MINUTE + [False]
    # A check that sends nothing is not counted.
    plain = client.post("/v1/auth/may-sign-in", json={"email": "sam@example.test"}, headers=AUTH)
    assert plain.json() == {"allowed": True}


def test_a_live_pending_sign_up_cannot_be_replaced(api: tuple[TestClient, Session]) -> None:
    client, session = api
    invite(session)
    sign_up(client)
    first = session.scalar(select(PendingSignup))
    assert first is not None
    born = (first.birth_year, first.birth_month)
    response = client.post(
        "/v1/auth/signups",
        json={
            "email": "sam@example.test",
            "invite_code": "BETA2026",
            "birth_year": 1990,
            "birth_month": 1,
            "visitor": VISITOR,
        },
        headers=AUTH,
    )
    assert response.status_code == 204
    session.refresh(first)
    assert (first.birth_year, first.birth_month) == born
