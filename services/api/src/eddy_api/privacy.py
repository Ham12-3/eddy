"""Data rights (SPEC.md section 4.5, ADR-0033): download my data, and erasure.

`export` builds everything Eddy holds about a student as JSON, which the web shows as a readable
page and offers as a file. It is built when asked for, not stored, so no second copy of the
data waits anywhere. Safety records are left out of the download: whether and how to share
them is for the safeguarding lead, and the download says how to ask.

`erase` completes a deletion request. Without a safety record the account row is deleted and
everything about the student goes with it (the foreign keys cascade). With one, the safety
record must stay until the DPIA sets its retention (ADR-0024), so everything else is deleted
and the account row is kept only as an anonymous anchor: its email replaced, its name removed.
Data request records, concern reports and LLM cost records keep no link to the person.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from eddy_api.db.models import (
    Account,
    Attempt,
    ConcernReport,
    CurriculumNode,
    DataRequest,
    DiagnosticSession,
    InviteRedemption,
    Item,
    LlmCall,
    MasteryState,
    Misconception,
    MisconceptionState,
    NoticeAcknowledgement,
    ParentLink,
    ParentLinkCode,
    ReviewCard,
    SafeguardingEvent,
    SceneInstance,
    SceneRequest,
    StudentProfile,
    TutorMessage,
    TutorSession,
    User,
    VerificationToken,
)
from eddy_api.db.models import Session as SessionRow


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def export(session: Session, user_id: uuid.UUID) -> dict[str, Any]:
    user = session.get(User, user_id)
    if user is None:
        raise LookupError(user_id)
    profile = session.get(StudentProfile, user_id)
    nodes = dict(session.execute(select(CurriculumNode.id, CurriculumNode.code)).all())
    attempts = session.execute(
        select(Attempt, Item.stem_markdown)
        .join(Item, Item.id == Attempt.item_id)
        .where(Attempt.student_id == user_id)
        .order_by(Attempt.created_at)
    ).all()
    lessons = session.scalars(
        select(TutorSession)
        .where(TutorSession.student_id == user_id)
        .order_by(TutorSession.started_at)
    ).all()
    messages = session.scalars(
        select(TutorMessage)
        .where(TutorMessage.session_id.in_([lesson.id for lesson in lessons]))
        .order_by(TutorMessage.created_at)
    ).all()
    tracks = session.execute(
        select(MisconceptionState, Misconception.code, Misconception.student_facing_description)
        .join(Misconception, Misconception.id == MisconceptionState.misconception_id)
        .where(MisconceptionState.student_id == user_id)
    ).all()
    safety = session.scalar(
        select(func.count())
        .select_from(SafeguardingEvent)
        .where(SafeguardingEvent.student_id == user_id)
    )
    return {
        "about": "Everything Eddy holds about you, as of the time below.",
        "created_at": datetime.now(UTC).isoformat(),
        "account": {
            "email": user.email,
            "role": user.role,
            "joined": _iso(user.created_at),
        },
        "profile": None
        if profile is None
        else {
            "birth_month": profile.birth_month,
            "birth_year": profile.birth_year,
            "board": profile.board,
            "tier": profile.tier,
            "exam_series": profile.exam_series,
            "target_grade": profile.target_grade,
            "resitting": profile.is_resitter,
            "preferences": profile.preferences,
        },
        "notices_acknowledged": [
            {"notice": n.notice_key, "version": n.version, "at": _iso(n.acknowledged_at)}
            for n in session.scalars(
                select(NoticeAcknowledgement).where(NoticeAcknowledgement.user_id == user_id)
            )
        ],
        "answers": [
            {
                "at": _iso(row.created_at),
                "question": stem,
                "your_answer": row.response_mathjson,
                "correct": row.correct,
                "how_sure": row.confidence_self_report,
                "hints_used": row.hints_used,
                "seconds": round(row.time_ms / 1000),
                "first_questions": row.is_diagnostic,
            }
            for row, stem in attempts
        ],
        "what_eddy_thinks_you_know": [
            {
                "topic": nodes.get(row.node_id),
                "state": row.status,
                "estimate": round(row.p_mastery, 2),
            }
            for row in session.scalars(
                select(MasteryState).where(MasteryState.student_id == user_id)
            )
        ],
        "slips_noticed": [
            {"code": code, "described_as": text, "state": row.status} for row, code, text in tracks
        ],
        "reviews": [
            {"topic": nodes.get(row.node_id) if row.node_id else None, "due": _iso(row.due_at)}
            for row in session.scalars(select(ReviewCard).where(ReviewCard.student_id == user_id))
        ],
        "lessons": [
            {
                "started": _iso(lesson.started_at),
                "ended": _iso(lesson.ended_at),
                "messages": [
                    {
                        "from": message.role.lower(),
                        "at": _iso(message.created_at),
                        "text": message.content
                        if message.content is not None
                        else "(deleted after 90 days)",
                    }
                    for message in messages
                    if message.session_id == lesson.id
                ],
            }
            for lesson in lessons
        ],
        "concerns_you_reported": [
            {"at": _iso(row.created_at), "about": row.category, "message": row.message}
            for row in session.scalars(
                select(ConcernReport).where(ConcernReport.user_id == user_id)
            )
        ],
        "parent_links": [
            {"status": row.status, "since": _iso(row.accepted_at or row.created_at)}
            for row in session.scalars(
                select(ParentLink).where(
                    (ParentLink.student_id == user_id) | (ParentLink.parent_user_id == user_id)
                )
            )
        ],
        "data_requests": [
            {"kind": row.kind, "status": row.status, "at": _iso(row.requested_at)}
            for row in session.scalars(select(DataRequest).where(DataRequest.user_id == user_id))
        ],
        "invite": [
            {"code": row.invite_code, "at": _iso(row.redeemed_at)}
            for row in session.scalars(
                select(InviteRedemption).where(InviteRedemption.user_id == user_id)
            )
        ],
        "explanations_watched": [
            {
                "at": _iso(row.created_at),
                "seconds_watched": round(row.watched_ms / 1000),
                "finished": row.completed,
                "replays": row.replays,
            }
            for row in session.scalars(
                select(SceneInstance).where(SceneInstance.student_id == user_id)
            )
        ],
        "first_questions": [
            {
                "started": _iso(row.started_at),
                "finished": _iso(row.completed_at),
                "questions": len(row.state.get("asked", [])),
            }
            for row in session.scalars(
                select(DiagnosticSession).where(DiagnosticSession.student_id == user_id)
            )
        ],
        "signed_in_on": [
            {"until": _iso(row.expires)}
            for row in session.scalars(select(SessionRow).where(SessionRow.user_id == user_id))
        ],
        "safety_records": (
            f"{safety} safety record(s) are not in this download. Use Report a concern to ask"
            " for them."
            if safety
            else "None."
        ),
    }


class AwaitingReviewError(Exception):
    """A safety record about this person waits for the safeguarding lead: erasure waits too."""


def awaiting_review(session: Session, user_id: uuid.UUID) -> bool:
    """An unreviewed safeguarding event or SAFETY concern (ADR-0033)."""
    event = session.scalar(
        select(SafeguardingEvent.id).where(
            SafeguardingEvent.student_id == user_id, SafeguardingEvent.reviewed_at.is_(None)
        )
    )
    concern = session.scalar(
        select(ConcernReport.id).where(
            ConcernReport.user_id == user_id,
            ConcernReport.category == "SAFETY",
            ConcernReport.reviewed_at.is_(None),
        )
    )
    return event is not None or concern is not None


def erase(session: Session, user_id: uuid.UUID) -> str:
    """Erase an account; returns "deleted" or "anonymised". The caller commits.

    Raises AwaitingReviewError while a safety record waits for review: deleting the lesson it
    came from, or the way to reach the student, could cost a child their help.
    """
    user = session.get(User, user_id)
    if user is None:
        return "deleted"
    if awaiting_review(session, user_id):
        raise AwaitingReviewError(str(user_id))
    safety = session.scalar(
        select(func.count())
        .select_from(SafeguardingEvent)
        .where(SafeguardingEvent.student_id == user_id)
    ) or session.scalar(
        select(func.count())
        .select_from(ConcernReport)
        .where(ConcernReport.user_id == user_id, ConcernReport.category == "SAFETY")
    )
    # LangGraph's checkpoints have no foreign key to their lesson: delete them by thread id.
    lessons = [
        str(lesson)
        for lesson in session.scalars(
            select(TutorSession.id).where(TutorSession.student_id == user_id)
        )
    ]
    if lessons:
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            session.execute(
                text(f"DELETE FROM {table} WHERE thread_id = ANY(:ids)"),  # noqa: S608 (fixed names)
                {"ids": lessons},
            )
    # A concern's words are personal data; only SAFETY concerns stay, as safety records.
    session.execute(
        delete(ConcernReport).where(
            ConcernReport.user_id == user_id, ConcernReport.category != "SAFETY"
        )
    )
    session.execute(delete(VerificationToken).where(VerificationToken.identifier == user.email))
    session.execute(update(LlmCall).where(LlmCall.student_id == user_id).values(student_id=None))
    if not safety:
        session.delete(user)
        session.flush()
        return "deleted"
    # The order matters: scene rows point at attempts, attempts at lessons.
    for model, column in (
        (SceneInstance, SceneInstance.student_id),
        (SceneRequest, SceneRequest.student_id),
        (Attempt, Attempt.student_id),
        (TutorSession, TutorSession.student_id),
        (DiagnosticSession, DiagnosticSession.student_id),
        (ReviewCard, ReviewCard.student_id),
        (MisconceptionState, MisconceptionState.student_id),
        (MasteryState, MasteryState.student_id),
        (StudentProfile, StudentProfile.user_id),
        (NoticeAcknowledgement, NoticeAcknowledgement.user_id),
        (InviteRedemption, InviteRedemption.user_id),
        (ParentLinkCode, ParentLinkCode.student_id),
        (SessionRow, SessionRow.user_id),
        (Account, Account.user_id),
    ):
        session.execute(delete(model).where(column == user_id))
    session.execute(
        delete(ParentLink).where(
            (ParentLink.student_id == user_id) | (ParentLink.parent_user_id == user_id)
        )
    )
    session.execute(update(DataRequest).where(DataRequest.user_id == user_id).values(user_id=None))
    user.email = f"erased-{user.id}@erased.invalid"
    user.name = None
    user.email_verified = None
    user.deactivated_at = user.deactivated_at or datetime.now(UTC)
    session.flush()
    return "anonymised"
