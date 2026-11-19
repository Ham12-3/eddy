"""What a linked parent sees (SPEC.md section 4.4, ADR-0033).

Progress only: topics secured, time spent this week, recent activity, upcoming reviews. Never
the tutor's messages, the student's answers or anything about safeguarding. The student sees
exactly this in their "what my parent sees" preview.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, date, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from eddy_api.db.models import (
    Attempt,
    CurriculumNode,
    MasteryState,
    ParentLink,
    ReviewCard,
    TutorSession,
    User,
)

#: Letters and digits that cannot be confused when read aloud or copied from a screen.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10
CODE_DAYS = 7


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def normalise_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def hash_code(code: str) -> str:
    return hashlib.sha256(normalise_code(code).encode()).hexdigest()


class Activity(BaseModel):
    #: A date only: a parent does not learn when, in the day, the student was online.
    day: date
    kind: str
    minutes: int
    questions: int


class Dashboard(BaseModel):
    secured: list[str]
    learning: list[str]
    minutes_this_week: int
    recent: list[Activity]
    reviews_due_this_week: int
    next_review: date | None


def dashboard(session: Session, student: uuid.UUID, now: datetime | None = None) -> Dashboard:
    now = now or datetime.now(UTC)
    week = now - timedelta(days=7)
    states = session.execute(
        select(CurriculumNode.title, MasteryState.status)
        .join(CurriculumNode, CurriculumNode.id == MasteryState.node_id)
        .where(MasteryState.student_id == student)
        .order_by(CurriculumNode.code)
    ).all()
    milliseconds = session.scalar(
        select(func.coalesce(func.sum(Attempt.time_ms), 0)).where(
            Attempt.student_id == student, Attempt.created_at >= week
        )
    )
    recent: list[Activity] = []
    lessons = session.scalars(
        select(TutorSession)
        .where(TutorSession.student_id == student)
        .order_by(TutorSession.started_at.desc())
        .limit(5)
    ).all()
    for lesson in lessons:
        answered = session.scalar(
            select(func.count()).select_from(Attempt).where(Attempt.session_id == lesson.id)
        )
        end = lesson.ended_at or lesson.started_at
        recent.append(
            Activity(
                day=lesson.started_at.date(),
                kind="lesson",
                minutes=max(0, int((end - lesson.started_at).total_seconds() // 60)),
                questions=int(answered or 0),
            )
        )
    soon = now + timedelta(days=7)
    due = session.scalars(
        select(ReviewCard.due_at)
        .where(ReviewCard.student_id == student, ReviewCard.due_at.is_not(None))
        .order_by(ReviewCard.due_at)
    ).all()
    upcoming = [d for d in due if d is not None and d <= soon]
    return Dashboard(
        secured=[title for title, status in states if status == "SECURE"],
        learning=[title for title, status in states if status in ("LEARNING", "NEEDS_REVIEW")],
        minutes_this_week=int((milliseconds or 0) // 60000),
        recent=recent,
        reviews_due_this_week=len(upcoming),
        next_review=next((d.date() for d in due if d is not None and d >= now), None),
    )


def end_links(session: Session, student: uuid.UUID) -> list[str]:
    """End every live link of a student who asked to delete their account. Returns the
    addresses of the parents whose links were active, to tell them."""
    told: list[str] = []
    now = datetime.now(UTC)
    for row in session.scalars(
        select(ParentLink).where(
            ParentLink.student_id == student, ParentLink.status.in_(("REQUESTED", "ACTIVE"))
        )
    ):
        if row.status == "ACTIVE":
            email = email_of(session, row.parent_user_id)
            if email:
                told.append(email)
        row.status = "ENDED"
        row.ended_by = "STUDENT"
        row.ended_at = now
    return told


def active_link(session: Session, student: uuid.UUID) -> bool:
    return (
        session.scalar(
            select(ParentLink.id).where(
                ParentLink.student_id == student, ParentLink.status == "ACTIVE"
            )
        )
        is not None
    )


def email_of(session: Session, user_id: uuid.UUID) -> str | None:
    user = session.get(User, user_id)
    return user.email if user is not None and user.deactivated_at is None else None
