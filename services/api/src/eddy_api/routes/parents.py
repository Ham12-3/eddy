"""Parent links and the parent dashboard (SPEC.md section 4.4, ADR-0033).

A student makes a link code (shared as a link, or read out). A parent who uses it asks to see
the student's progress; the link stays REQUESTED until the student accepts. Either side can end
it, and the other is told by email. While a link is active the student always sees so, and can
preview exactly what the parent sees. Every parent view of a dashboard is written to the audit
log. A parent never sees messages, answers or safeguarding records.

Student routes: `/v1/me/parent-links`, `/v1/me/parent-links/code`,
`/v1/me/parent-links/{id}/accept`, `/v1/me/parent-links/{id}/end`, `/v1/me/parent-view`.
Parent routes: `/v1/parent/children`, `/v1/parent/links`, `/v1/parent/children/{id}`,
`/v1/parent/links/{id}/end`.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from eddy_api import audit, mail, parents
from eddy_api.auth import Caller, require_roles
from eddy_api.config import Settings, get_settings
from eddy_api.db.models import ParentLink, ParentLinkCode, User
from eddy_api.db.session import get_session
from eddy_api.routes.accounts import SignupLimiter
from eddy_api.students import Student

router = APIRouter(tags=["parents"])
DbSession = Annotated[Session, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]
LIVE = ("REQUESTED", "ACTIVE")


def current_parent(
    caller: Annotated[Caller, Depends(require_roles("parent"))],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    try:
        user_id = uuid.UUID(caller.subject)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown account.") from None
    user = session.get(User, user_id)
    if user is None or user.role != "parent" or user.deactivated_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown account.")
    return user


Parent = Annotated[User, Depends(current_parent)]


def _tell(settings: Settings, to: str | None, subject: str, body: str) -> None:
    if to:
        mail.notify(settings, to, subject, body)


# The student's side.


class LinkOut(BaseModel):
    id: uuid.UUID
    status: Literal["REQUESTED", "ACTIVE"]
    #: The parent's address, so the student knows who is asking.
    parent_email: str | None
    requested_at: datetime
    accepted_at: datetime | None


class StudentLinksOut(BaseModel):
    code_expires_at: datetime | None
    links: list[LinkOut]


@router.get("/v1/me/parent-links", operation_id="listMyParentLinks")
def my_links(student: Student, session: DbSession) -> StudentLinksOut:
    code = session.scalar(select(ParentLinkCode).where(ParentLinkCode.student_id == student.id))
    rows = session.scalars(
        select(ParentLink)
        .where(ParentLink.student_id == student.id, ParentLink.status.in_(LIVE))
        .order_by(ParentLink.created_at)
    ).all()
    now = datetime.now(UTC)
    return StudentLinksOut(
        code_expires_at=code.expires_at if code and code.expires_at > now else None,
        links=[
            LinkOut(
                id=row.id,
                status="ACTIVE" if row.status == "ACTIVE" else "REQUESTED",
                parent_email=parents.email_of(session, row.parent_user_id),
                requested_at=row.created_at,
                accepted_at=row.accepted_at,
            )
            for row in rows
        ],
    )


class CodeOut(BaseModel):
    code: str
    expires_at: datetime


@router.post("/v1/me/parent-links/code", operation_id="makeParentLinkCode")
def make_code(student: Student, session: DbSession) -> CodeOut:
    """A new code, shown once. It replaces any code the student made before."""
    session.execute(delete(ParentLinkCode).where(ParentLinkCode.student_id == student.id))
    code = parents.new_code()
    expires = datetime.now(UTC) + timedelta(days=parents.CODE_DAYS)
    session.add(
        ParentLinkCode(student_id=student.id, code_hash=parents.hash_code(code), expires_at=expires)
    )
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="parent_link.code",
        target_type="user",
        target_id=student.id,
    )
    session.commit()
    return CodeOut(code=code, expires_at=expires)


def _students_link(session: Session, student: User, link_id: uuid.UUID) -> ParentLink:
    row = session.scalar(
        select(ParentLink)
        .where(ParentLink.id == link_id, ParentLink.student_id == student.id)
        .with_for_update()
    )
    if row is None or row.status not in LIVE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such parent link.")
    return row


@router.post("/v1/me/parent-links/{link_id}/accept", operation_id="acceptParentLink")
def accept_link(
    link_id: uuid.UUID, student: Student, session: DbSession, settings: AppSettings
) -> StudentLinksOut:
    row = _students_link(session, student, link_id)
    if row.status == "REQUESTED":
        row.status = "ACTIVE"
        row.accepted_at = datetime.now(UTC)
        audit.record(
            session,
            actor_id=student.id,
            actor_role="student",
            action="parent_link.accept",
            target_type="parent_link",
            target_id=row.id,
        )
        session.commit()
        _tell(
            settings,
            parents.email_of(session, row.parent_user_id),
            "Eddy: your link was accepted",
            "Your child accepted your request. You can now see their progress in Eddy.\n",
        )
    return my_links(student, session)


@router.post("/v1/me/parent-links/{link_id}/end", operation_id="endParentLinkAsStudent")
def end_link_as_student(
    link_id: uuid.UUID, student: Student, session: DbSession, settings: AppSettings
) -> StudentLinksOut:
    """Decline a request, or end an active link. The parent is told."""
    row = _students_link(session, student, link_id)
    was_active = row.status == "ACTIVE"
    row.status = "ENDED"
    row.ended_by = "STUDENT"
    row.ended_at = datetime.now(UTC)
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="parent_link.end",
        target_type="parent_link",
        target_id=row.id,
    )
    session.commit()
    _tell(
        settings,
        parents.email_of(session, row.parent_user_id),
        "Eddy: a parent link has ended" if was_active else "Eddy: your request was declined",
        "The link to your child's progress in Eddy has ended. You can no longer see it.\n"
        if was_active
        else "Your request to see a child's progress in Eddy was declined.\n",
    )
    return my_links(student, session)


@router.get("/v1/me/parent-view", operation_id="previewParentView")
def parent_view(student: Student, session: DbSession) -> parents.Dashboard:
    """Exactly what a linked parent sees."""
    return parents.dashboard(session, student.id)


# The parent's side.


class ChildOut(BaseModel):
    link_id: uuid.UUID
    status: Literal["REQUESTED", "ACTIVE"]
    #: Shown only once the student has accepted.
    student_email: str | None
    since: datetime


@router.get("/v1/parent/children", operation_id="listChildren")
def children(parent: Parent, session: DbSession) -> list[ChildOut]:
    rows = session.scalars(
        select(ParentLink)
        .where(ParentLink.parent_user_id == parent.id, ParentLink.status.in_(LIVE))
        .order_by(ParentLink.created_at)
    ).all()
    return [
        ChildOut(
            link_id=row.id,
            status="ACTIVE" if row.status == "ACTIVE" else "REQUESTED",
            student_email=(
                parents.email_of(session, row.student_id) if row.status == "ACTIVE" else None
            ),
            since=row.accepted_at or row.created_at,
        )
        for row in rows
        if parents.email_of(session, row.student_id) is not None
    ]


class LinkCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)


@router.post("/v1/parent/links", operation_id="requestParentLink")
def request_link(
    body: LinkCodeIn,
    parent: Parent,
    session: DbSession,
    settings: AppSettings,
    limiter: SignupLimiter,
) -> list[ChildOut]:
    if not limiter.allow(f"parent-code:{parent.id}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many tries. Wait a minute and try again."
        )
    now = datetime.now(UTC)
    code = session.scalar(
        select(ParentLinkCode)
        .where(
            ParentLinkCode.code_hash == parents.hash_code(body.code),
            ParentLinkCode.expires_at > now,
        )
        .with_for_update()
    )
    if code is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="That code does not work. Ask for a new one."
        )
    student = code.student_id
    existing = session.scalar(
        select(ParentLink.id).where(
            ParentLink.student_id == student,
            ParentLink.parent_user_id == parent.id,
            ParentLink.status.in_(LIVE),
        )
    )
    session.delete(code)  # a code works once
    if existing is None:
        row = ParentLink(
            student_id=student, parent_user_id=parent.id, status="REQUESTED", requested_by="PARENT"
        )
        session.add(row)
        session.flush()
        audit.record(
            session,
            actor_id=parent.id,
            actor_role="parent",
            action="parent_link.request",
            target_type="parent_link",
            target_id=row.id,
        )
    session.commit()
    if existing is None:
        _tell(
            settings,
            parents.email_of(session, student),
            "Eddy: a parent asked to see your progress",
            "Someone used your link code to ask to see your progress in Eddy. Nothing is shared"
            " until you accept. Accept or decline in Settings, under Parent access.\n",
        )
    return children(parent, session)


def _parents_link(session: Session, parent: User, link_id: uuid.UUID) -> ParentLink:
    row = session.scalar(
        select(ParentLink).where(
            ParentLink.id == link_id,
            ParentLink.parent_user_id == parent.id,
            ParentLink.status.in_(LIVE),
        )
    )
    if row is None or parents.email_of(session, row.student_id) is None:
        # A student who asked to delete their account is gone from the parent's view at once.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such link.")
    return row


@router.get("/v1/parent/children/{link_id}", operation_id="getChildDashboard")
def child_dashboard(link_id: uuid.UUID, parent: Parent, session: DbSession) -> parents.Dashboard:
    row = _parents_link(session, parent, link_id)
    if row.status != "ACTIVE":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Your child has not accepted the link yet."
        )
    audit.record(
        session,
        actor_id=parent.id,
        actor_role="parent",
        action="parent.view_dashboard",
        target_type="user",
        target_id=row.student_id,
    )
    view = parents.dashboard(session, row.student_id)
    session.commit()
    return view


@router.post("/v1/parent/links/{link_id}/end", operation_id="endParentLinkAsParent")
def end_link_as_parent(
    link_id: uuid.UUID, parent: Parent, session: DbSession, settings: AppSettings
) -> list[ChildOut]:
    row = _parents_link(session, parent, link_id)
    was_active = row.status == "ACTIVE"
    row.status = "ENDED"
    row.ended_by = "PARENT"
    row.ended_at = datetime.now(UTC)
    audit.record(
        session,
        actor_id=parent.id,
        actor_role="parent",
        action="parent_link.end",
        target_type="parent_link",
        target_id=row.id,
    )
    session.commit()
    if was_active:
        _tell(
            settings,
            parents.email_of(session, row.student_id),
            "Eddy: a parent link has ended",
            "A parent ended their link to your progress in Eddy. They can no longer see it.\n",
        )
    return children(parent, session)
