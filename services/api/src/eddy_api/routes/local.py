"""Profiles on this computer: the desktop app's stand-in for sign-up and sign-in (ADR-0036).

The desktop app has no email, no invites and no internet. A student makes a profile with a
nickname and their birth month and year, and opens it from a picker. These routes exist only
with `EDDY_LOCAL_MODE` set, and accept only the web's `system:local` caller; the browser never
reaches them.

- `GET /v1/local/profiles`: the profiles to choose from.
- `POST /v1/local/profiles`: make one. The age check is the same as online: nothing is stored
  for anyone under 13.
- `POST /v1/local/profiles/{id}/open`: open one, with its PIN if it has one.
- `GET /v1/local/parent-view` and `/v1/local/parent-view/{id}`: the profiles that share a
  progress summary with whoever is at the computer, and one profile's summary.
- `POST /v1/local/parent-view/{id}/stop`: stop one being shown. Anyone at the computer may.

A student's own routes, for an open profile: `GET` and `PUT /v1/local/me/parent-view` show
what would be shared and switch the sharing on or off.

A profile is an ordinary student account, so everything a student does works unchanged. Its
email is a placeholder that can never receive mail. The optional PIN keeps a brother or sister
out of a profile on a shared computer: it is a courtesy lock, not protection against someone
with the computer's own password. Only a salted scrypt hash of it is stored.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from eddy_api import audit, parents
from eddy_api.auth import Caller, require_roles
from eddy_api.config import Settings, get_settings
from eddy_api.db.models import AuditLog, NoticeAcknowledgement, StudentProfile, User
from eddy_api.db.session import get_session
from eddy_api.routes.accounts import MINIMUM_AGE, age_on
from eddy_api.routes.me import privacy_notice_version
from eddy_api.students import LOCAL_PROFILE_DOMAIN, Student, is_local_profile, profile_of

router = APIRouter(prefix="/v1/local", tags=["local"])
DbSession = Annotated[Session, Depends(get_session)]
LOCAL_SUBJECT = "system:local"
#: Wrong PINs in a row that cost nothing. After them each wrong PIN pauses the profile: 30
#: seconds, doubling each time, up to 15 minutes. The count is kept on the profile, so closing
#: Eddy does not reset it, and only a wrong PIN counts, so nobody is locked out by clicks alone.
PIN_FREE_TRIES = 5
PIN_FIRST_PAUSE = timedelta(seconds=30)
PIN_LONGEST_PAUSE = timedelta(minutes=15)
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
#: Why a profile could not be made. The web shows its own words for each (profiles/actions.ts).
NAME_TAKEN = "name_taken"
PROFILES_FULL = "profiles_full"
#: One profile is made at a time, so the limit and the unique names hold (an advisory lock key).
_CREATE_LOCK = 0x45444459


def _local(
    caller: Annotated[Caller, Depends(require_roles("system"))],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Caller:
    if not settings.eddy_local_mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    if caller.subject != LOCAL_SUBJECT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not the local caller.")
    return caller


Local = Annotated[Caller, Depends(_local)]
AppSettings = Annotated[Settings, Depends(get_settings)]


Pin = Annotated[str, Field(min_length=4, max_length=8, pattern=r"^[0-9]+$")]


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def pin_matches(pin: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
        expected = bytes.fromhex(digest)
        actual = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    except ValueError:
        return False
    return scheme == "scrypt" and hmac.compare_digest(actual, expected)


def pin_pause(failed: int) -> timedelta | None:
    """How long a profile pauses after its `failed`-th wrong PIN in a row."""
    if failed <= PIN_FREE_TRIES:
        return None
    doubled = PIN_FIRST_PAUSE * (1 << min(failed - PIN_FREE_TRIES - 1, 10))
    return min(doubled, PIN_LONGEST_PAUSE)


class LocalProfile(BaseModel):
    id: uuid.UUID
    name: str
    has_pin: bool


def _profiles(session: Session) -> list[LocalProfile]:
    rows = session.execute(
        select(User.id, User.name, StudentProfile.pin_hash)
        .join(StudentProfile, StudentProfile.user_id == User.id)
        .where(
            User.role == "student",
            User.deactivated_at.is_(None),
            User.email.endswith(LOCAL_PROFILE_DOMAIN, autoescape=True),
        )
        .order_by(User.created_at, User.id)
    ).all()
    return [
        LocalProfile(id=row.id, name=row.name or "Student", has_pin=row.pin_hash is not None)
        for row in rows
    ]


@router.get("/profiles", operation_id="listLocalProfiles")
def list_profiles(_: Local, session: DbSession) -> list[LocalProfile]:
    return _profiles(session)


class LocalProfileIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    #: A nickname for the picker. It is never sent to any model.
    name: str = Field(min_length=1, max_length=24, pattern=r"^[^\x00-\x1f\x7f<>]+$")
    birth_year: int = Field(ge=1900, le=2100)
    birth_month: int = Field(ge=1, le=12)
    pin: Pin | None = None


@router.post("/profiles", status_code=status.HTTP_201_CREATED, operation_id="createLocalProfile")
def create_profile(
    body: LocalProfileIn, _: Local, session: DbSession, settings: AppSettings
) -> LocalProfile:
    now = datetime.now(UTC)
    age = age_on(now.date(), body.birth_year, body.birth_month)
    if age < MINIMUM_AGE or age > 120:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Age check failed.")
    session.execute(select(func.pg_advisory_xact_lock(_CREATE_LOCK)))
    existing = _profiles(session)
    if len(existing) >= settings.local_profile_limit:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=PROFILES_FULL)
    if any(profile.name.casefold() == body.name.casefold() for profile in existing):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=NAME_TAKEN)
    user = User(
        # A placeholder that can never receive mail (students.py).
        email=f"profile-{uuid.uuid4().hex}{LOCAL_PROFILE_DOMAIN}",
        email_verified=None,
        name=body.name,
        role="student",
    )
    session.add(user)
    session.flush()
    session.add(
        StudentProfile(
            user_id=user.id,
            birth_year=body.birth_year,
            birth_month=body.birth_month,
            preferences={},
            pin_hash=hash_pin(body.pin) if body.pin else None,
        )
    )
    audit.record(
        session,
        actor_id=user.id,
        actor_role="student",
        action="account.create",
        target_type="user",
        target_id=user.id,
    )
    session.commit()
    return LocalProfile(id=user.id, name=body.name, has_pin=body.pin is not None)


def _check_pin(session: Session, user: User, profile: StudentProfile, pin: str | None) -> None:
    """Returns only when `pin` is the profile's PIN. The profile row must be locked.

    None given is not a guess and costs nothing. A wrong PIN counts, and after too many the
    profile pauses, wherever the PIN was asked for.
    """
    if profile.pin_hash is None:
        return
    if pin is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This profile needs its PIN.")
    now = datetime.now(UTC)
    if profile.pin_locked_until is not None and profile.pin_locked_until > now:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many wrong tries. Wait a while, then try again.",
        )
    if not pin_matches(pin, profile.pin_hash):
        profile.pin_failed_tries = min(profile.pin_failed_tries + 1, 1000)
        pause = pin_pause(profile.pin_failed_tries)
        if pause is not None:
            profile.pin_locked_until = now + pause
            audit.record(
                session,
                actor_id=None,
                actor_role="system",
                action="profile.pin_paused",
                target_type="user",
                target_id=user.id,
            )
        session.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="That PIN is not right.")
    profile.pin_failed_tries = 0
    profile.pin_locked_until = None


class OpenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: Pin | None = None


class OpenOut(BaseModel):
    id: uuid.UUID
    role: str


@router.post("/profiles/{profile_id}/open", operation_id="openLocalProfile")
def open_profile(profile_id: uuid.UUID, body: OpenIn, _: Local, session: DbSession) -> OpenOut:
    """Says the profile may be opened: the web then keeps it in a signed cookie."""
    user = session.get(User, profile_id)
    # Locked while the PIN is checked, so two tries at once are both counted.
    profile = session.scalar(
        select(StudentProfile).where(StudentProfile.user_id == profile_id).with_for_update()
    )
    if (
        user is None
        or profile is None
        or user.role != "student"
        or user.deactivated_at is not None
        or not is_local_profile(user)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such profile.")
    if profile.pin_hash is not None:
        _check_pin(session, user, profile, body.pin)
    audit.record(
        session,
        actor_id=user.id,
        actor_role="student",
        action="session.create",
        target_type="user",
        target_id=user.id,
    )
    session.commit()
    return OpenOut(id=user.id, role=user.role)


# A parent or carer on the same computer. The desktop app has no parent accounts and no email,
# so there is nobody to link to (routes/parents.py). A student who wants a parent or carer to
# see how they are doing switches a progress summary on in Settings; it can then be opened from
# the profile picker by whoever is at the computer, without the profile's PIN. It is the same
# summary a linked parent sees online: topics, lesson days, time and reviews, never an answer.

#: A look at a summary is written down once in this long, however often the page is opened.
VIEW_NOTED_EVERY = timedelta(minutes=10)
VIEWED = "parent_view.opened"
#: Why sharing could not be switched on. The web shows its own words (settings/actions.ts).
NOTICE_FIRST = "notice_first"


class SharedProfile(BaseModel):
    id: uuid.UUID
    name: str


@router.get("/parent-view", operation_id="listSharedProfiles")
def shared_profiles(_: Local, session: DbSession) -> list[SharedProfile]:
    """The profiles whose owners have switched the summary on."""
    rows = session.execute(
        select(User.id, User.name)
        .join(StudentProfile, StudentProfile.user_id == User.id)
        .where(
            User.role == "student",
            User.deactivated_at.is_(None),
            User.email.endswith(LOCAL_PROFILE_DOMAIN, autoescape=True),
            StudentProfile.parent_view_on.is_(True),
        )
        .order_by(User.created_at, User.id)
    ).all()
    return [SharedProfile(id=row.id, name=row.name or "Student") for row in rows]


def _shared(session: Session, profile_id: uuid.UUID) -> tuple[User, StudentProfile]:
    user = session.get(User, profile_id)
    profile = session.scalar(
        select(StudentProfile).where(StudentProfile.user_id == profile_id).with_for_update()
    )
    if (
        user is None
        or profile is None
        or user.role != "student"
        or user.deactivated_at is not None
        or not is_local_profile(user)
        or not profile.parent_view_on
    ):
        # One answer for "no such profile" and "not shared": a guess learns nothing.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such profile.")
    return user, profile


def _last_opened(session: Session, student: uuid.UUID) -> datetime | None:
    return session.scalar(
        select(func.max(AuditLog.created_at)).where(
            AuditLog.action == VIEWED, AuditLog.target_id == str(student)
        )
    )


class SharedProgress(BaseModel):
    name: str
    progress: parents.Dashboard


@router.get("/parent-view/{profile_id}", operation_id="getSharedProgress")
def shared_progress(profile_id: uuid.UUID, _: Local, session: DbSession) -> SharedProgress:
    user, _profile = _shared(session, profile_id)
    # A look is written down, with no actor: nobody is signed in. Opening the page again and
    # again adds no more lines, so the log cannot be filled by a held-down key.
    last = _last_opened(session, user.id)
    if last is None or datetime.now(UTC) - last >= VIEW_NOTED_EVERY:
        audit.record(
            session,
            actor_id=None,
            actor_role="system",
            action=VIEWED,
            target_type="user",
            target_id=user.id,
        )
    progress = parents.dashboard(session, user.id)
    session.commit()
    return SharedProgress(name=user.name or "Student", progress=progress)


@router.post("/parent-view/{profile_id}/stop", operation_id="stopSharedProgress")
def stop_shared_progress(profile_id: uuid.UUID, _: Local, session: DbSession) -> dict[str, bool]:
    """Stops a summary being shown. Anyone at the computer may: it only ever shows less.

    It is also the way out when a profile's PIN is forgotten and its own Settings cannot be
    reached. Only the student, in their open profile, can switch it on again.
    """
    user, profile = _shared(session, profile_id)
    profile.parent_view_on = False
    audit.record(
        session,
        actor_id=None,
        actor_role="system",
        action="parent_view.off",
        target_type="user",
        target_id=user.id,
    )
    session.commit()
    return {"on": False}


student_router = APIRouter(prefix="/v1/local/me", tags=["local"])


def _local_student(student: Student, settings: AppSettings) -> User:
    if not settings.eddy_local_mode or not is_local_profile(student):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    return student


LocalStudent = Annotated[User, Depends(_local_student)]


class SharingOut(BaseModel):
    on: bool
    #: Switching on asks for the profile's PIN, when it has one.
    pin_needed: bool
    #: When the summary was last opened from the profile list, if it ever was.
    last_opened_at: datetime | None
    #: Exactly what is shown, or would be, to whoever opens the summary.
    progress: parents.Dashboard


def _sharing(session: Session, student: User) -> SharingOut:
    profile = profile_of(session, student)
    return SharingOut(
        on=profile.parent_view_on,
        pin_needed=profile.pin_hash is not None,
        last_opened_at=_last_opened(session, student.id),
        progress=parents.dashboard(session, student.id),
    )


@student_router.get("/parent-view", operation_id="getMyLocalParentView")
def my_parent_view(student: LocalStudent, session: DbSession) -> SharingOut:
    return _sharing(session, student)


class SharingIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    on: bool
    #: Needed to switch on a profile that has a PIN. Never needed to switch off.
    pin: Pin | None = None


@student_router.put("/parent-view", operation_id="setMyLocalParentView")
def set_my_parent_view(
    body: SharingIn, student: LocalStudent, session: DbSession, settings: AppSettings
) -> SharingOut:
    profile = session.scalar(
        select(StudentProfile).where(StudentProfile.user_id == student.id).with_for_update()
    )
    if profile is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This account has no profile.")
    if profile.parent_view_on == body.on:
        return _sharing(session, student)
    if body.on:
        # The notice that describes the sharing is read first.
        read = session.scalar(
            select(NoticeAcknowledgement.user_id).where(
                NoticeAcknowledgement.user_id == student.id,
                NoticeAcknowledgement.notice_key == "privacy",
                NoticeAcknowledgement.version == privacy_notice_version(settings),
            )
        )
        if read is None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=NOTICE_FIRST)
        # A profile left open is not enough to make it open to everyone for good: switching on
        # asks for the PIN again. Switching off never does.
        _check_pin(session, student, profile, body.pin)
    profile.parent_view_on = body.on
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="parent_view.on" if body.on else "parent_view.off",
        target_type="user",
        target_id=student.id,
    )
    session.commit()
    return _sharing(session, student)
