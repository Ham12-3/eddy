"""Sign-up and the Auth.js adapter (ADR-0008, ADR-0023, ADR-0032).

apps/web is the only caller: these routes accept the `system` role with the subject
`system:auth` only. The browser never reaches them.

Sign-up runs invite code, then the age check, then the email address (ADR-0032):

- `POST /v1/auth/invites/check` says whether an invite code can still be used.
- `POST /v1/auth/signups` records someone who passed the age check and asked for a link: their
  email, birth month and year, and invite. Nothing is stored for anyone under 13, and this
  route refuses them too.
- `POST /v1/auth/may-sign-in` says whether a link may be sent: to an active account, or to a
  pending sign-up. Web shows the same page either way, so an address cannot be probed.

The adapter routes map Auth.js's calls onto our tables. Session tokens arrive already hashed
(SHA-256, by the web adapter), so a raw session token never reaches this service. A user is
created only from a pending sign-up, in one transaction that redeems the invite, makes the
profile, deletes the pending row and writes the audit log.
"""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import ColumnElement, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from eddy_api import audit, mail, parents
from eddy_api.auth import Caller, require_roles
from eddy_api.config import get_settings
from eddy_api.db.models import (
    InviteCode,
    InviteRedemption,
    ParentLink,
    ParentLinkCode,
    PendingSignup,
    StudentProfile,
    User,
    VerificationToken,
)
from eddy_api.db.models import Session as SessionRow
from eddy_api.db.session import get_session
from eddy_api.tutor.ratelimit import Limiter, RedisLimiter

router = APIRouter(prefix="/v1/auth", tags=["auth"])
DbSession = Annotated[Session, Depends(get_session)]
AUTH_SUBJECT = "system:auth"
MINIMUM_AGE = 13
PENDING_FOR = timedelta(hours=24)


#: Invite checks and sign-ups per visitor: invite codes are short, so guessing must be slow.
SIGNUPS_PER_MINUTE = 10
SIGNUPS_PER_DAY = 60


#: Sign-in links per address: nobody can flood an inbox or probe addresses at scale.
LINKS_PER_MINUTE = 3
LINKS_PER_DAY = 10


@lru_cache
def get_signup_limiter() -> Limiter:
    settings = get_settings()
    scale = settings.signup_limit_scale
    return RedisLimiter.from_url(
        settings.redis_url, SIGNUPS_PER_MINUTE * scale, SIGNUPS_PER_DAY * scale
    )


@lru_cache
def get_link_limiter() -> Limiter:
    return RedisLimiter.from_url(get_settings().redis_url, LINKS_PER_MINUTE, LINKS_PER_DAY)


SignupLimiter = Annotated[Limiter, Depends(get_signup_limiter)]
LinkLimiter = Annotated[Limiter, Depends(get_link_limiter)]

#: A visitor, as web identifies them: a keyed hash of their address, never the address itself.
Visitor = Annotated[str, Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")]


def _limit(limiter: Limiter, visitor: str) -> None:
    if not limiter.allow(f"signup:{visitor}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many tries. Wait a minute and try again."
        )


def _web_auth(caller: Annotated[Caller, Depends(require_roles("system"))]) -> Caller:
    """Only the web's auth code may call these routes, not any other system caller."""
    if caller.subject != AUTH_SUBJECT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not the auth caller.")
    return caller


WebAuth = Annotated[Caller, Depends(_web_auth)]

Email = Annotated[str, Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
TokenHash = Annotated[str, Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")]


def normalise_invite(code: str) -> str:
    """Invite codes are matched without case, spaces or hyphens."""
    return "".join(ch for ch in code.upper() if ch.isalnum())


def normalise_email(email: str) -> str:
    return email.strip().lower()


def age_on(today: date, birth_year: int, birth_month: int) -> int:
    """Whole years, counting the birth month itself as not yet reached: with no day of birth,
    someone is treated as 13 only from the month after they turn 13."""
    age = today.year - birth_year
    if today.month <= birth_month:
        age -= 1
    return age


def _usable(code: str, now: datetime) -> ColumnElement[bool]:
    return (
        (InviteCode.code == code)
        & (InviteCode.used_count < InviteCode.max_uses)
        & or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now)
    )


class InviteIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    visitor: Visitor


class InviteOut(BaseModel):
    valid: bool


@router.post("/invites/check", operation_id="checkInvite")
def check_invite(
    body: InviteIn, _: WebAuth, session: DbSession, limiter: SignupLimiter
) -> InviteOut:
    _limit(limiter, body.visitor)
    code = normalise_invite(body.code)
    now = datetime.now(UTC)
    found = session.scalar(select(InviteCode.code).where(_usable(code, now)))
    return InviteOut(valid=found is not None)


class SignupIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: Email
    invite_code: str = Field(min_length=1, max_length=64)
    birth_year: int = Field(ge=1900, le=2100)
    birth_month: int = Field(ge=1, le=12)
    visitor: Visitor


@router.post("/signups", status_code=status.HTTP_204_NO_CONTENT, operation_id="createSignup")
def create_signup(
    body: SignupIn, _: WebAuth, session: DbSession, limiter: SignupLimiter
) -> Response:
    """Record a pending sign-up. Silent (204) when the address already has an account, so the
    page that follows cannot reveal it; the link then simply signs them in."""
    _limit(limiter, body.visitor)
    now = datetime.now(UTC)
    age = age_on(now.date(), body.birth_year, body.birth_month)
    if age < MINIMUM_AGE or age > 120:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Age check failed.")
    code = normalise_invite(body.invite_code)
    if session.scalar(select(InviteCode.code).where(_usable(code, now))) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That invite code cannot be used.")
    email = normalise_email(body.email)
    if session.scalar(select(User.id).where(func.lower(User.email) == email)) is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    existing = session.scalar(select(PendingSignup).where(func.lower(PendingSignup.email) == email))
    if existing is not None and existing.expires_at > now:
        # Someone else cannot replace a live sign-up with their own invite or birth date.
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    session.execute(delete(PendingSignup).where(func.lower(PendingSignup.email) == email))
    session.add(
        PendingSignup(
            email=email,
            invite_code=code,
            birth_year=body.birth_year,
            birth_month=body.birth_month,
            expires_at=now + PENDING_FOR,
        )
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class EmailIn(BaseModel):
    email: Email


class MaySignInIn(EmailIn):
    #: Set when a link is about to be sent: counts against the per-address limit.
    sending: bool = False


class MaySignInOut(BaseModel):
    allowed: bool


@router.post("/may-sign-in", operation_id="maySignIn")
def may_sign_in(
    body: MaySignInIn, _: WebAuth, session: DbSession, limiter: LinkLimiter
) -> MaySignInOut:
    email = normalise_email(body.email)
    if body.sending:
        key = hashlib.sha256(f"link:{email}".encode()).hexdigest()
        if not limiter.allow(f"link:{key}"):
            return MaySignInOut(allowed=False)
    now = datetime.now(UTC)
    active = session.scalar(
        select(User.id).where(func.lower(User.email) == email, User.deactivated_at.is_(None))
    )
    pending = session.scalar(
        select(PendingSignup.id).where(
            func.lower(PendingSignup.email) == email, PendingSignup.expires_at > now
        )
    )
    return MaySignInOut(allowed=active is not None or pending is not None)


class AdapterUser(BaseModel):
    """The user as Auth.js sees it, plus the role the web signs into service tokens."""

    id: uuid.UUID
    email: str
    email_verified: datetime | None
    name: str | None
    role: str


def _adapter_user(user: User) -> AdapterUser:
    return AdapterUser(
        id=user.id,
        email=user.email,
        email_verified=user.email_verified,
        name=user.name,
        role=user.role,
    )


class CreateUserIn(BaseModel):
    email: Email
    email_verified: datetime | None = None


@router.post("/users", operation_id="createUser")
def create_user(body: CreateUserIn, _: WebAuth, session: DbSession) -> AdapterUser:
    """Make the account from its pending sign-up: the only way an account is made."""
    email = normalise_email(body.email)
    now = datetime.now(UTC)
    pending = session.scalar(
        select(PendingSignup)
        .where(func.lower(PendingSignup.email) == email, PendingSignup.expires_at > now)
        .with_for_update()
    )
    if pending is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No sign-up is waiting.")
    if pending.role == "parent":
        return _create_parent(session, pending, email, body.email_verified or now, now)
    if pending.invite_code is None or pending.birth_year is None or pending.birth_month is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No sign-up is waiting.")
    redeemed = session.scalar(
        update(InviteCode)
        .where(_usable(pending.invite_code, now))
        .values(used_count=InviteCode.used_count + 1)
        .returning(InviteCode.code)
    )
    if redeemed is None:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That invite code is used up.")
    user = User(email=email, email_verified=body.email_verified or now, role="student")
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That account exists.") from None
    session.add(
        StudentProfile(
            user_id=user.id,
            birth_year=pending.birth_year,
            birth_month=pending.birth_month,
            preferences={},
        )
    )
    session.add(InviteRedemption(user_id=user.id, invite_code=redeemed))
    session.delete(pending)
    audit.record(
        session,
        actor_id=user.id,
        actor_role="student",
        action="account.create",
        target_type="user",
        target_id=user.id,
    )
    session.commit()
    return _adapter_user(user)


def _create_parent(
    session: Session, pending: PendingSignup, email: str, verified: datetime, now: datetime
) -> AdapterUser:
    """A parent's account, with a REQUESTED link to the child whose code they used. The code
    works once; nothing is shared until the child accepts (ADR-0033)."""
    code = session.scalar(
        select(ParentLinkCode)
        .where(ParentLinkCode.id == pending.link_code_id, ParentLinkCode.expires_at > now)
        .with_for_update()
    )
    if code is None:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That link code has expired.")
    user = User(email=email, email_verified=verified, role="parent")
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That account exists.") from None
    link = ParentLink(
        student_id=code.student_id,
        parent_user_id=user.id,
        status="REQUESTED",
        requested_by="PARENT",
    )
    session.add(link)
    session.flush()
    audit.record(
        session,
        actor_id=user.id,
        actor_role="parent",
        action="parent_link.request",
        target_type="parent_link",
        target_id=link.id,
    )
    session.delete(pending)
    session.flush()  # before the code, whose deletion would cascade to the pending row
    session.delete(code)
    audit.record(
        session,
        actor_id=user.id,
        actor_role="parent",
        action="account.create",
        target_type="user",
        target_id=user.id,
    )
    student = code.student_id
    session.commit()
    student_email = parents.email_of(session, student)
    if student_email:
        mail.notify(
            get_settings(),
            student_email,
            "Eddy: a parent asked to see your progress",
            "Someone used your link code to ask to see your progress in Eddy. Nothing is shared"
            " until you accept. Accept or decline in Settings, under Parent access.\n",
        )
    return _adapter_user(user)


class ParentSignupIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: Email
    code: str = Field(min_length=4, max_length=32)
    #: The parent confirms they are the student's parent or carer and an adult.
    adult_confirmed: Literal[True]
    visitor: Visitor


@router.post(
    "/parent-signups", status_code=status.HTTP_204_NO_CONTENT, operation_id="createParentSignup"
)
def create_parent_signup(
    body: ParentSignupIn, _: WebAuth, session: DbSession, limiter: SignupLimiter
) -> Response:
    """A parent asks for a sign-up link with their child's code. Silent (204) for an address that
    already has an account or a live sign-up: such a parent signs in and enters the code."""
    _limit(limiter, body.visitor)
    now = datetime.now(UTC)
    code = session.scalar(
        select(ParentLinkCode).where(
            ParentLinkCode.code_hash == parents.hash_code(body.code),
            ParentLinkCode.expires_at > now,
        )
    )
    if code is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That code does not work.")
    email = normalise_email(body.email)
    if session.scalar(select(User.id).where(func.lower(User.email) == email)) is not None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    existing = session.scalar(select(PendingSignup).where(func.lower(PendingSignup.email) == email))
    if existing is not None and existing.expires_at > now:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    session.execute(delete(PendingSignup).where(func.lower(PendingSignup.email) == email))
    session.add(
        PendingSignup(
            email=email, role="parent", link_code_id=code.id, expires_at=now + PENDING_FOR
        )
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _active(session: Session, user_id: uuid.UUID) -> User | None:
    user = session.get(User, user_id)
    return user if user is not None and user.deactivated_at is None else None


@router.get("/users/{user_id}", operation_id="getUser")
def get_user(user_id: uuid.UUID, _: WebAuth, session: DbSession) -> AdapterUser | None:
    user = _active(session, user_id)
    return _adapter_user(user) if user else None


@router.post("/users/lookup", operation_id="getUserByEmail")
def get_user_by_email(body: EmailIn, _: WebAuth, session: DbSession) -> AdapterUser | None:
    """By POST, so an address never sits in a URL or an access log."""
    email = normalise_email(body.email)
    user = session.scalar(
        select(User).where(func.lower(User.email) == email, User.deactivated_at.is_(None))
    )
    return _adapter_user(user) if user else None


class UpdateUserIn(BaseModel):
    email_verified: datetime | None = None


@router.patch("/users/{user_id}", operation_id="updateUser")
def update_user(
    user_id: uuid.UUID, body: UpdateUserIn, _: WebAuth, session: DbSession
) -> AdapterUser:
    user = _active(session, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such user.")
    if body.email_verified is not None:
        user.email_verified = body.email_verified
    session.commit()
    return _adapter_user(user)


class SessionIn(BaseModel):
    session_token_hash: TokenHash
    user_id: uuid.UUID
    expires: datetime


class SessionOut(BaseModel):
    session_token_hash: str
    user_id: uuid.UUID
    expires: datetime


class SessionAndUser(BaseModel):
    session: SessionOut
    user: AdapterUser


def _session_out(row: SessionRow) -> SessionOut:
    return SessionOut(
        session_token_hash=row.session_token_hash, user_id=row.user_id, expires=row.expires
    )


@router.post("/sessions", operation_id="createSession")
def create_session(body: SessionIn, _: WebAuth, session: DbSession) -> SessionOut:
    user = _active(session, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such user.")
    row = SessionRow(
        session_token_hash=body.session_token_hash, user_id=body.user_id, expires=body.expires
    )
    session.add(row)
    audit.record(
        session,
        actor_id=body.user_id,
        actor_role=user.role,
        action="session.create",
        target_type="user",
        target_id=body.user_id,
    )
    session.commit()
    return _session_out(row)


class TokenHashIn(BaseModel):
    session_token_hash: TokenHash


@router.post("/sessions/lookup", operation_id="getSessionAndUser")
def get_session_and_user(
    body: TokenHashIn, _: WebAuth, session: DbSession
) -> SessionAndUser | None:
    """A live session of an active account, or nothing: a deactivated account is signed out
    everywhere at once."""
    now = datetime.now(UTC)
    row = session.scalar(
        select(SessionRow).where(
            SessionRow.session_token_hash == body.session_token_hash, SessionRow.expires > now
        )
    )
    if row is None:
        return None
    user = _active(session, row.user_id)
    if user is None:
        return None
    return SessionAndUser(session=_session_out(row), user=_adapter_user(user))


class UpdateSessionIn(BaseModel):
    session_token_hash: TokenHash
    expires: datetime


@router.patch("/sessions", operation_id="updateSession")
def update_session(body: UpdateSessionIn, _: WebAuth, session: DbSession) -> SessionOut | None:
    row = session.scalar(
        select(SessionRow).where(SessionRow.session_token_hash == body.session_token_hash)
    )
    if row is None:
        return None
    row.expires = body.expires
    session.commit()
    return _session_out(row)


@router.post(
    "/sessions/delete", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteSession"
)
def delete_session(body: TokenHashIn, _: WebAuth, session: DbSession) -> Response:
    session.execute(
        delete(SessionRow).where(SessionRow.session_token_hash == body.session_token_hash)
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class VerificationIn(BaseModel):
    identifier: Email
    token: str = Field(min_length=16, max_length=255)
    expires: datetime | None = None

    @field_validator("identifier")
    @classmethod
    def _lower(cls, value: str) -> str:
        return normalise_email(value)


class VerificationOut(BaseModel):
    identifier: str
    token: str
    expires: datetime


@router.post("/verification-tokens", operation_id="createVerificationToken")
def create_verification_token(
    body: VerificationIn, _: WebAuth, session: DbSession
) -> VerificationOut:
    if body.expires is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="expires is required.")
    # One live link per address: a new request replaces the old one.
    session.execute(
        delete(VerificationToken).where(VerificationToken.identifier == body.identifier)
    )
    session.add(
        VerificationToken(identifier=body.identifier, token=body.token, expires=body.expires)
    )
    session.commit()
    return VerificationOut(identifier=body.identifier, token=body.token, expires=body.expires)


@router.post("/verification-tokens/use", operation_id="useVerificationToken")
def use_verification_token(
    body: VerificationIn, _: WebAuth, session: DbSession
) -> VerificationOut | None:
    """Delete and return the token: a link works once."""
    row = session.execute(
        delete(VerificationToken)
        .where(
            VerificationToken.identifier == body.identifier,
            VerificationToken.token == body.token,
        )
        .returning(VerificationToken.identifier, VerificationToken.token, VerificationToken.expires)
    ).first()
    session.commit()
    if row is None:
        return None
    return VerificationOut(identifier=row.identifier, token=row.token, expires=row.expires)
