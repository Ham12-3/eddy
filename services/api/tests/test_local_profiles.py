"""Profiles on the computer (ADR-0036): the desktop app's stand-in for sign-up and sign-in."""

import base64
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api import jobs, privacy
from eddy_api.config import Settings, get_settings, tier_l_enabled
from eddy_api.db.models import AuditLog, StudentProfile, User
from eddy_api.db.session import get_session
from eddy_api.main import create_app
from eddy_api.routes.local import (
    PIN_FREE_TRIES,
    PIN_LONGEST_PAUSE,
    hash_pin,
    pin_matches,
    pin_pause,
)
from eddy_api.tutor.ratelimit import MemoryLimiter, RedisLimiter, limiter_for

_KEY = ec.generate_private_key(ec.SECP256R1())
_PUBLIC_B64 = base64.b64encode(
    _KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
).decode()
OLD_ENOUGH = datetime.now(UTC).year - 15
MAX_PROFILES = 4


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


def local() -> dict[str, str]:
    return token("system:local", "system")


def client_for(db_session: Session, *, local_mode: bool) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64,
        eddy_environment="test",
        eddy_local_mode=local_mode,
        local_profile_limit=MAX_PROFILES,
    )
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as client:
        yield client


@pytest.fixture
def desktop(db_session: Session) -> Iterator[TestClient]:
    yield from client_for(db_session, local_mode=True)


@pytest.fixture
def online(db_session: Session) -> Iterator[TestClient]:
    yield from client_for(db_session, local_mode=False)


def make(client: TestClient, name: str = "Sam", **extra: object) -> dict[str, object]:
    body = {"name": name, "birth_year": OLD_ENOUGH, "birth_month": 6, **extra}
    response = client.post("/v1/local/profiles", json=body, headers=local())
    assert response.status_code == 201, response.text
    created: dict[str, object] = response.json()
    return created


def test_the_routes_do_not_exist_outside_the_desktop_app(online: TestClient) -> None:
    assert online.get("/v1/local/profiles", headers=local()).status_code == 404
    body = {"name": "Sam", "birth_year": OLD_ENOUGH, "birth_month": 6}
    assert online.post("/v1/local/profiles", json=body, headers=local()).status_code == 404


@pytest.mark.parametrize(
    ("caller", "expected"),
    [
        (None, 401),
        (("system:auth", "system"), 403),
        (("3f0e4c0a-7b1d-4a55-9a43-0d3f6a8f2b11", "student"), 403),
        (("3f0e4c0a-7b1d-4a55-9a43-0d3f6a8f2b11", "admin"), 403),
    ],
)
def test_only_the_local_caller_is_accepted(
    desktop: TestClient, caller: tuple[str, str] | None, expected: int
) -> None:
    # The token is made here, not when the file is read: one made then expires in a slow run.
    headers = token(*caller) if caller else {}
    assert desktop.get("/v1/local/profiles", headers=headers).status_code == expected


def test_a_profile_is_a_student_account_that_works_everywhere(
    desktop: TestClient, db_session: Session
) -> None:
    created = make(desktop, "  Sam  ")
    assert created == {"id": created["id"], "name": "Sam", "has_pin": False}
    user = db_session.get(User, uuid.UUID(str(created["id"])))
    assert user is not None
    assert (user.role, user.name) == ("student", "Sam")
    # The placeholder address can never receive mail, and nothing was verified.
    assert user.email.endswith("@local.invalid")
    assert user.email_verified is None
    profile = db_session.get(StudentProfile, user.id)
    assert profile is not None
    assert (profile.birth_year, profile.birth_month, profile.pin_hash) == (OLD_ENOUGH, 6, None)
    actions = db_session.scalars(select(AuditLog.action).where(AuditLog.actor_id == user.id)).all()
    assert actions == ["account.create"]

    me = desktop.get("/v1/me", headers=token(str(user.id), "student"))
    assert me.status_code == 200
    assert me.json()["name"] == "Sam"
    assert me.json()["profile"]["setup_completed_at"] is None


def test_nothing_is_stored_for_anyone_under_13(desktop: TestClient, db_session: Session) -> None:
    before = db_session.scalars(select(User.id)).all()
    this_year = datetime.now(UTC).year
    body = {"name": "Kit", "birth_year": this_year - 12, "birth_month": 1}
    response = desktop.post("/v1/local/profiles", json=body, headers=local())
    assert response.status_code == 422
    assert db_session.scalars(select(User.id)).all() == before


@pytest.mark.parametrize(
    "change",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 25},
        {"name": "<b>Sam</b>"},
        {"name": "Sam\nSmith"},
        {"birth_month": 13},
        {"pin": "12"},
        {"pin": "12ab"},
        {"pin": "123456789"},
        {"email": "sam@example.com"},
    ],
)
def test_a_bad_profile_is_refused(desktop: TestClient, change: dict[str, object]) -> None:
    body = {"name": "Sam", "birth_year": OLD_ENOUGH, "birth_month": 6} | change
    assert desktop.post("/v1/local/profiles", json=body, headers=local()).status_code == 422


def test_names_are_unique_on_the_computer_whatever_their_case(desktop: TestClient) -> None:
    make(desktop, "Sam")
    body = {"name": "SAM", "birth_year": OLD_ENOUGH, "birth_month": 6}
    response = desktop.post("/v1/local/profiles", json=body, headers=local())
    assert response.status_code == 409
    assert response.json()["detail"] == "name_taken"


def test_the_picker_lists_active_profiles_in_the_order_they_were_made(
    desktop: TestClient, db_session: Session
) -> None:
    first = make(desktop, "Sam")
    second = make(desktop, "Ada", pin="2468")
    gone = make(desktop, "Lee")
    user = db_session.get(User, uuid.UUID(str(gone["id"])))
    assert user is not None
    user.deactivated_at = datetime.now(UTC)
    db_session.flush()
    listed = desktop.get("/v1/local/profiles", headers=local()).json()
    mine = [p for p in listed if p["id"] in {first["id"], second["id"], gone["id"]}]
    assert {(p["name"], p["has_pin"]) for p in mine} == {("Sam", False), ("Ada", True)}
    # A deleted profile's name is free again.
    make(desktop, "Lee")


def test_the_computer_holds_a_bounded_number_of_profiles(desktop: TestClient) -> None:
    already = len(desktop.get("/v1/local/profiles", headers=local()).json())
    for index in range(MAX_PROFILES - already):
        make(desktop, f"Student {index}")
    body = {"name": "One more", "birth_year": OLD_ENOUGH, "birth_month": 6}
    full = desktop.post("/v1/local/profiles", json=body, headers=local())
    assert full.status_code == 409
    assert full.json()["detail"] == "profiles_full"


def test_a_profile_without_a_pin_opens(desktop: TestClient, db_session: Session) -> None:
    created = make(desktop)
    opened = desktop.post(f"/v1/local/profiles/{created['id']}/open", json={}, headers=local())
    assert opened.status_code == 200
    assert opened.json() == {"id": created["id"], "role": "student"}
    actions = db_session.scalars(
        select(AuditLog.action).where(AuditLog.actor_id == uuid.UUID(str(created["id"])))
    ).all()
    assert sorted(actions) == ["account.create", "session.create"]


def test_a_pin_is_needed_when_one_is_set_and_only_its_hash_is_stored(
    desktop: TestClient, db_session: Session
) -> None:
    created = make(desktop, pin="2468")
    profile = db_session.get(StudentProfile, uuid.UUID(str(created["id"])))
    assert profile is not None
    assert profile.pin_hash is not None
    assert "2468" not in profile.pin_hash
    url = f"/v1/local/profiles/{created['id']}/open"
    assert desktop.post(url, json={}, headers=local()).status_code == 403
    wrong = desktop.post(url, json={"pin": "1111"}, headers=local())
    assert wrong.status_code == 403
    assert wrong.json()["detail"] == "That PIN is not right."
    assert desktop.post(url, json={"pin": "2468"}, headers=local()).status_code == 200


def test_opening_from_the_picker_and_right_pins_never_count_as_guesses(
    desktop: TestClient, db_session: Session
) -> None:
    created = make(desktop, pin="2468")
    url = f"/v1/local/profiles/{created['id']}/open"
    profile = db_session.get(StudentProfile, uuid.UUID(str(created["id"])))
    assert profile is not None
    # Nobody is locked out by clicks alone, and using a profile all day costs nothing.
    for _ in range(PIN_FREE_TRIES * 3):
        assert desktop.post(url, json={}, headers=local()).status_code == 403
        assert desktop.post(url, json={"pin": "2468"}, headers=local()).status_code == 200
    assert (profile.pin_failed_tries, profile.pin_locked_until) == (0, None)


def test_wrong_pins_pause_the_profile_and_the_count_is_kept_on_it(
    desktop: TestClient, db_session: Session
) -> None:
    created = make(desktop, pin="2468")
    profile_id = uuid.UUID(str(created["id"]))
    url = f"/v1/local/profiles/{created['id']}/open"
    profile = db_session.get(StudentProfile, profile_id)
    assert profile is not None
    for _ in range(PIN_FREE_TRIES):
        assert desktop.post(url, json={"pin": "0000"}, headers=local()).status_code == 403
    assert (profile.pin_failed_tries, profile.pin_locked_until) == (PIN_FREE_TRIES, None)
    # One more and the profile pauses: even the right PIN waits. The count is a column, so
    # closing Eddy and opening it again does not give a fresh set of guesses.
    assert desktop.post(url, json={"pin": "0000"}, headers=local()).status_code == 403
    assert profile.pin_locked_until is not None
    paused = desktop.post(url, json={"pin": "2468"}, headers=local())
    assert paused.status_code == 429
    assert "Wait a while" in paused.json()["detail"]
    assert profile.pin_failed_tries == PIN_FREE_TRIES + 1
    paused_rows = db_session.scalars(
        select(AuditLog.action).where(AuditLog.target_id == str(profile_id))
    ).all()
    assert "profile.pin_paused" in paused_rows

    # Once the pause is over the right PIN opens it and clears the count.
    profile.pin_locked_until = datetime.now(UTC) - timedelta(seconds=1)
    db_session.flush()
    assert desktop.post(url, json={"pin": "2468"}, headers=local()).status_code == 200
    assert profile.pin_failed_tries == 0
    assert (
        db_session.scalar(
            select(StudentProfile.pin_locked_until).where(StudentProfile.user_id == profile_id)
        )
        is None
    )


def test_the_pause_grows_and_is_bounded() -> None:
    assert [pin_pause(n) for n in range(PIN_FREE_TRIES + 1)] == [None] * (PIN_FREE_TRIES + 1)
    first, second, third = (pin_pause(PIN_FREE_TRIES + n) for n in (1, 2, 3))
    assert first == timedelta(seconds=30)
    assert (second, third) == (timedelta(seconds=60), timedelta(seconds=120))
    assert pin_pause(1000) == PIN_LONGEST_PAUSE


def test_an_unknown_or_deleted_profile_does_not_open(
    desktop: TestClient, db_session: Session
) -> None:
    missing = desktop.post(f"/v1/local/profiles/{uuid.uuid4()}/open", json={}, headers=local())
    assert missing.status_code == 404
    created = make(desktop)
    user = db_session.get(User, uuid.UUID(str(created["id"])))
    assert user is not None
    user.deactivated_at = datetime.now(UTC)
    db_session.flush()
    gone = desktop.post(f"/v1/local/profiles/{created['id']}/open", json={}, headers=local())
    assert gone.status_code == 404


def test_an_account_made_by_email_is_never_a_profile(
    desktop: TestClient, db_session: Session
) -> None:
    user = User(email="someone@example.com", role="student", name="Mallory")
    db_session.add(user)
    db_session.flush()
    db_session.add(StudentProfile(user_id=user.id, birth_year=OLD_ENOUGH, birth_month=6))
    db_session.flush()
    listed = desktop.get("/v1/local/profiles", headers=local()).json()
    assert str(user.id) not in {profile["id"] for profile in listed}
    opened = desktop.post(f"/v1/local/profiles/{user.id}/open", json={}, headers=local())
    assert opened.status_code == 404


def test_pin_hashes_are_salted_and_checked_in_full() -> None:
    first, second = hash_pin("2468"), hash_pin("2468")
    assert first != second
    assert pin_matches("2468", first)
    assert pin_matches("2468", second)
    assert not pin_matches("2469", first)
    assert not pin_matches("2468", "not-a-hash")
    assert not pin_matches("2468", "md5$00$00")


def test_the_desktop_notice_has_its_own_version(desktop: TestClient, online: TestClient) -> None:
    created = make(desktop)
    student = token(str(created["id"]), "student")
    old = {"notice_key": "privacy", "version": "0.2.0"}
    new = {"notice_key": "privacy", "version": "0.6.0"}
    assert desktop.post("/v1/me/notices", json=old, headers=student).status_code == 422
    acked = desktop.post("/v1/me/notices", json=new, headers=student)
    assert [n["version"] for n in acked.json()["notices"]] == ["0.6.0"]
    assert online.post("/v1/me/notices", json=new, headers=student).status_code == 422


def test_my_data_names_the_profile_and_shows_no_placeholder_address(desktop: TestClient) -> None:
    created = make(desktop)
    student = token(str(created["id"]), "student")
    data = desktop.get("/v1/me/export", headers=student).json()
    assert data["account"]["name"] == "Sam"
    assert "email" not in data["account"]
    assert data["profile"]["pin_set"] is False


def test_an_online_export_is_unchanged(db_session: Session) -> None:
    user = User(email="someone@example.com", role="student")
    db_session.add(user)
    db_session.flush()
    db_session.add(StudentProfile(user_id=user.id, birth_year=OLD_ENOUGH, birth_month=6))
    db_session.flush()
    for local_flag in (False, True):
        # Even with the flag on, an account made by email is not treated as a profile.
        data = privacy.export(db_session, user.id, local=local_flag)
        assert data["account"]["email"] == "someone@example.com"
        assert "name" not in data["account"]
        assert "pin_set" not in data["profile"]


def test_the_desktop_app_has_no_sign_up_parents_or_concern_reports(
    desktop: TestClient, online: TestClient
) -> None:
    created = make(desktop)
    student = token(str(created["id"]), "student")
    web_auth = token("system:auth", "system")
    concern = {"category": "OTHER", "message": "hello"}
    calls = [
        ("POST", "/v1/auth/may-sign-in", web_auth, {"email": "someone@example.com"}),
        ("GET", "/v1/me/parent-links", student, None),
        ("POST", "/v1/me/parent-links/code", student, None),
        ("POST", "/v1/me/concerns", student, concern),
    ]
    for method, path, headers, body in calls:
        assert desktop.request(method, path, headers=headers, json=body).status_code == 404, path
        assert online.request(method, path, headers=headers, json=body).status_code != 404, path


def test_the_desktop_app_never_calls_claude_or_sends_an_alert(db_session: Session) -> None:
    settings = Settings(
        eddy_local_mode=True,
        eddy_environment="development",
        anthropic_api_key=SecretStr("sk-test"),
        anthropic_zdr_confirmed=True,
        safeguarding_alert_email="lead@example.com",
    )
    # A key and a confirmed ZDR would switch Claude on anywhere else.
    assert tier_l_enabled(settings) is False
    assert jobs.alerts(db_session, settings) == 0


def test_the_local_model_server_must_be_on_this_computer() -> None:
    assert Settings(local_llm_base_url="http://localhost:9000").local_llm_base_url
    with pytest.raises(ValueError, match="on this computer"):
        Settings(local_llm_base_url="http://models.example.com:8330")


def test_with_no_redis_limits_are_counted_in_this_process() -> None:
    assert isinstance(limiter_for("", 3, 10), MemoryLimiter)
    assert isinstance(limiter_for("redis://127.0.0.1:6390/0", 3, 10), RedisLimiter)
    limiter = limiter_for("", 2, 10)
    assert [limiter.allow("a"), limiter.allow("a"), limiter.allow("a")] == [True, True, False]


# A progress summary for a parent or carer at the same computer.

NOTICE = {"notice_key": "privacy", "version": "0.6.0"}
SHARE = "/v1/local/me/parent-view"


def sharer(client: TestClient, name: str = "Sam", **extra: object) -> tuple[str, dict[str, str]]:
    """A profile that has read the notice: its id, and its student headers."""
    created = make(client, name, **extra)
    student = token(str(created["id"]), "student")
    assert client.post("/v1/me/notices", json=NOTICE, headers=student).status_code == 200
    return str(created["id"]), student


def parent_actions(db_session: Session, profile_id: str) -> list[str]:
    actions = db_session.scalars(
        select(AuditLog.action).where(AuditLog.target_id == profile_id).order_by(AuditLog.id)
    ).all()
    return [action for action in actions if action.startswith("parent")]


def test_nothing_is_shared_until_the_student_switches_it_on(
    desktop: TestClient, db_session: Session
) -> None:
    profile_id, student = sharer(desktop)
    assert desktop.get("/v1/local/parent-view", headers=local()).json() == []
    path = f"/v1/local/parent-view/{profile_id}"
    assert desktop.get(path, headers=local()).status_code == 404
    mine = desktop.get(SHARE, headers=student).json()
    assert (mine["on"], mine["pin_needed"], mine["last_opened_at"]) == (False, False, None)
    assert desktop.get("/v1/me", headers=student).json()["parent_visible"] is False

    on = desktop.put(SHARE, json={"on": True}, headers=student)
    assert on.status_code == 200, on.text
    assert on.json()["on"] is True
    # Whoever is at the computer can now open it from the picker.
    listed = desktop.get("/v1/local/parent-view", headers=local()).json()
    assert listed == [{"id": profile_id, "name": "Sam"}]
    shared = desktop.get(path, headers=local())
    assert shared.status_code == 200, shared.text
    assert shared.json()["name"] == "Sam"
    # The summary is what the student is shown, and it holds no answer and no PIN.
    assert shared.json()["progress"] == mine["progress"]
    assert set(shared.json()["progress"]) == {
        "secured",
        "learning",
        "minutes_this_week",
        "recent",
        "reviews_due_this_week",
        "next_review",
    }
    # The student is always told that it is on, and when it was last opened.
    assert desktop.get("/v1/me", headers=student).json()["parent_visible"] is True
    assert desktop.get(SHARE, headers=student).json()["last_opened_at"] is not None
    exported = desktop.get("/v1/me/export", headers=student).json()
    assert exported["profile"]["progress_shared_on_this_computer"] is True

    # Saying the same thing twice changes nothing and writes nothing.
    assert desktop.put(SHARE, json={"on": True}, headers=student).json()["on"] is True
    off = desktop.put(SHARE, json={"on": False}, headers=student)
    assert off.json()["on"] is False
    assert desktop.get("/v1/local/parent-view", headers=local()).json() == []
    assert desktop.get(path, headers=local()).status_code == 404
    assert parent_actions(db_session, profile_id) == [
        "parent_view.on",
        "parent_view.opened",
        "parent_view.off",
    ]


def test_looking_again_and_again_is_written_down_once(
    desktop: TestClient, db_session: Session
) -> None:
    profile_id, student = sharer(desktop)
    desktop.put(SHARE, json={"on": True}, headers=student)
    path = f"/v1/local/parent-view/{profile_id}"
    for _ in range(5):
        assert desktop.get(path, headers=local()).status_code == 200
    assert parent_actions(db_session, profile_id).count("parent_view.opened") == 1


def test_switching_on_asks_for_the_pin_and_switching_off_never_does(
    desktop: TestClient, db_session: Session
) -> None:
    profile_id, student = sharer(desktop, pin="2468")
    assert desktop.get(SHARE, headers=student).json()["pin_needed"] is True
    # A profile left open is not enough: no PIN is not a guess, a wrong one is.
    assert desktop.put(SHARE, json={"on": True}, headers=student).status_code == 403
    assert desktop.put(SHARE, json={"on": True, "pin": "0000"}, headers=student).status_code == 403
    profile = db_session.get(StudentProfile, uuid.UUID(profile_id))
    assert profile is not None
    db_session.refresh(profile)
    assert (profile.parent_view_on, profile.pin_failed_tries) == (False, 1)
    on = desktop.put(SHARE, json={"on": True, "pin": "2468"}, headers=student)
    assert on.status_code == 200, on.text
    db_session.refresh(profile)
    assert (profile.parent_view_on, profile.pin_failed_tries) == (True, 0)
    # The summary itself needs no PIN: that is what the student agreed to.
    assert desktop.get(f"/v1/local/parent-view/{profile_id}", headers=local()).status_code == 200
    assert desktop.put(SHARE, json={"on": False}, headers=student).json()["on"] is False


def test_wrong_pins_for_sharing_pause_the_profile_like_any_other(desktop: TestClient) -> None:
    _, student = sharer(desktop, pin="2468")
    for _ in range(PIN_FREE_TRIES + 1):
        assert (
            desktop.put(SHARE, json={"on": True, "pin": "0000"}, headers=student).status_code == 403
        )
    # Paused: even the right PIN waits.
    assert desktop.put(SHARE, json={"on": True, "pin": "2468"}, headers=student).status_code == 429


def test_the_notice_is_read_before_anything_is_shared(desktop: TestClient) -> None:
    created = make(desktop)
    student = token(str(created["id"]), "student")
    refused = desktop.put(SHARE, json={"on": True}, headers=student)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "notice_first"
    assert desktop.get(SHARE, headers=student).json()["on"] is False


def test_anyone_at_the_computer_can_stop_a_summary_being_shown(
    desktop: TestClient, db_session: Session
) -> None:
    # The way out when a PIN is forgotten: the profile's own Settings cannot be reached.
    profile_id, student = sharer(desktop, pin="2468")
    desktop.put(SHARE, json={"on": True, "pin": "2468"}, headers=student)
    stop = f"/v1/local/parent-view/{profile_id}/stop"
    assert desktop.post(stop, headers=student).status_code == 403
    stopped = desktop.post(stop, headers=local())
    assert stopped.status_code == 200, stopped.text
    assert desktop.get("/v1/local/parent-view", headers=local()).json() == []
    assert desktop.get(f"/v1/local/parent-view/{profile_id}", headers=local()).status_code == 404
    assert desktop.get(SHARE, headers=student).json()["on"] is False
    # Nothing to stop any more, and nothing can be switched on from there.
    assert desktop.post(stop, headers=local()).status_code == 404
    assert parent_actions(db_session, profile_id) == ["parent_view.on", "parent_view.off"]


def test_only_the_student_switches_sharing_on_and_only_the_picker_reads_it(
    desktop: TestClient,
) -> None:
    profile_id, student = sharer(desktop)
    other = make(desktop, name="Alex")
    desktop.put(SHARE, json={"on": True}, headers=student)
    # The picker's caller cannot switch it on, and a student cannot read another's summary.
    assert desktop.put(SHARE, json={"on": True}, headers=local()).status_code == 403
    path = f"/v1/local/parent-view/{profile_id}"
    assert desktop.get(path, headers=token(str(other["id"]), "student")).status_code == 403
    assert desktop.get("/v1/local/parent-view", headers={}).status_code == 401
    for body in ({"on": "maybe"}, {"on": "true"}, {"on": 1}, {"on": True, "profile": other["id"]}):
        assert desktop.put(SHARE, json=body, headers=student).status_code == 422, body


def test_a_deleted_profile_is_no_longer_shared(desktop: TestClient) -> None:
    profile_id, student = sharer(desktop)
    desktop.put(SHARE, json={"on": True}, headers=student)
    deleted = desktop.post(
        "/v1/me/data-requests", json={"kind": "DELETE", "confirm": True}, headers=student
    )
    assert deleted.status_code in (200, 201), deleted.text
    assert desktop.get("/v1/local/parent-view", headers=local()).json() == []
    assert desktop.get(f"/v1/local/parent-view/{profile_id}", headers=local()).status_code == 404


def test_an_account_made_by_email_is_never_shared(desktop: TestClient, db_session: Session) -> None:
    user = User(email="someone@example.com", role="student")
    db_session.add(user)
    db_session.flush()
    db_session.add(
        StudentProfile(
            user_id=user.id,
            birth_year=OLD_ENOUGH,
            birth_month=6,
            preferences={},
            parent_view_on=True,
        )
    )
    db_session.commit()
    student = token(str(user.id), "student")
    assert desktop.get("/v1/local/parent-view", headers=local()).json() == []
    assert desktop.get(f"/v1/local/parent-view/{user.id}", headers=local()).status_code == 404
    assert desktop.post(f"/v1/local/parent-view/{user.id}/stop", headers=local()).status_code == 404
    assert desktop.get(SHARE, headers=student).status_code == 404
    # Its own pages say nothing of sharing either.
    assert desktop.get("/v1/me", headers=student).json()["parent_visible"] is False
    exported = desktop.get("/v1/me/export", headers=student).json()
    assert "progress_shared_on_this_computer" not in exported["profile"]


def test_sharing_on_a_computer_does_not_exist_online(
    desktop: TestClient, online: TestClient
) -> None:
    profile_id, student = sharer(desktop)
    desktop.put(SHARE, json={"on": True}, headers=student)
    assert online.get("/v1/local/parent-view", headers=local()).status_code == 404
    assert online.get(f"/v1/local/parent-view/{profile_id}", headers=local()).status_code == 404
    assert (
        online.post(f"/v1/local/parent-view/{profile_id}/stop", headers=local()).status_code == 404
    )
    assert online.get(SHARE, headers=student).status_code == 404
    assert online.put(SHARE, json={"on": True}, headers=student).status_code == 404
