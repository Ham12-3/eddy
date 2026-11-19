"""The signed-in student's own account (SPEC.md sections 4.1 and 4.5).

- `GET /v1/me`: the account, profile, preferences and acknowledged notices.
- `POST /v1/me/notices`: record that a notice version was read and acknowledged.
- `PUT /v1/me/profile`: set-up (board, tier, exam series, target grade, resitting).
- `PUT /v1/me/preferences`: accessibility and session preferences.
- `GET` and `POST /v1/me/data-requests`: download my data, delete my account. Deleting
  deactivates the account at once and signs it out everywhere; the export and the erasure
  itself are jobs (PLAN.md M9), completed within 30 days.
- `POST /v1/me/concerns`: report a concern.

Only birth month and year are held, never a school, address or phone number. Every change is
written to the audit log by its action name, never its content.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from eddy_api import audit
from eddy_api.db.models import (
    ConcernReport,
    DataRequest,
    NoticeAcknowledgement,
    StudentProfile,
    TutorSession,
)
from eddy_api.db.models import Session as SessionRow
from eddy_api.db.session import get_session
from eddy_api.students import Student, profile_of

router = APIRouter(prefix="/v1/me", tags=["me"])
DbSession = Annotated[Session, Depends(get_session)]
NARRATION_SPEEDS = (0.75, 1.0, 1.25)
CONCERNS_PER_DAY = 10


class Preferences(BaseModel):
    """Children's Code defaults for everyone; each is the student's own choice."""

    model_config = ConfigDict(extra="forbid")

    theme: Literal["system", "light", "dark"] = "system"
    reading: Literal["standard", "dyslexia"] = "standard"
    motion: Literal["system", "reduce"] = "system"
    #: Scenes show captions with no voice.
    captions_only: bool = False
    narration_speed: float = 1.0
    #: When the gentle "good place to stop" note appears (SPEC.md section 4.2).
    session_minutes: int = Field(default=25, ge=10, le=60)

    @field_validator("narration_speed")
    @classmethod
    def _speed(cls, value: float) -> float:
        if value not in NARRATION_SPEEDS:
            raise ValueError("narration speed must be 0.75, 1 or 1.25")
        return value


class NoticeOut(BaseModel):
    notice_key: str
    version: str
    acknowledged_at: datetime


class ProfileOut(BaseModel):
    birth_year: int
    birth_month: int
    board: str | None
    tier: str | None
    exam_series: str | None
    target_grade: int | None
    is_resitter: bool
    setup_completed_at: datetime | None
    diagnostic_completed_at: datetime | None


class MeOut(BaseModel):
    id: uuid.UUID
    role: str
    profile: ProfileOut
    preferences: Preferences
    notices: list[NoticeOut]


def _preferences(profile: StudentProfile) -> Preferences:
    try:
        return Preferences.model_validate(profile.preferences or {})
    except ValueError:
        # Stored preferences from an older shape: fall back to the defaults.
        return Preferences()


def _me(session: Session, student: Student) -> MeOut:
    profile = profile_of(session, student)
    notices = session.scalars(
        select(NoticeAcknowledgement)
        .where(NoticeAcknowledgement.user_id == student.id)
        .order_by(NoticeAcknowledgement.acknowledged_at)
    ).all()
    return MeOut(
        id=student.id,
        role=student.role,
        profile=ProfileOut(
            birth_year=profile.birth_year,
            birth_month=profile.birth_month,
            board=profile.board,
            tier=profile.tier,
            exam_series=profile.exam_series,
            target_grade=profile.target_grade,
            is_resitter=profile.is_resitter,
            setup_completed_at=profile.setup_completed_at,
            diagnostic_completed_at=profile.diagnostic_completed_at,
        ),
        preferences=_preferences(profile),
        notices=[
            NoticeOut(notice_key=n.notice_key, version=n.version, acknowledged_at=n.acknowledged_at)
            for n in notices
        ],
    )


@router.get("", operation_id="getMe")
def get_me(student: Student, session: DbSession) -> MeOut:
    return _me(session, student)


#: The privacy notice version shown now. Keep in step with PRIVACY_NOTICE_VERSION in
#: apps/web/src/lib/notices.ts: only the current version can be acknowledged.
PRIVACY_NOTICE_VERSION = "0.1.0"


class NoticeIn(BaseModel):
    notice_key: Literal["privacy"]
    version: Literal["0.1.0"]


@router.post("/notices", operation_id="acknowledgeNotice")
def acknowledge_notice(body: NoticeIn, student: Student, session: DbSession) -> MeOut:
    session.execute(
        insert(NoticeAcknowledgement)
        .values(user_id=student.id, notice_key=body.notice_key, version=body.version)
        .on_conflict_do_nothing()
    )
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="notice.acknowledge",
        target_type="notice",
        target_id=f"{body.notice_key}@{body.version}",
    )
    session.commit()
    return _me(session, student)


class SetupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    board: Literal["AQA", "EDEXCEL", "OCR"] = "AQA"
    #: Higher is "coming later" (SPEC.md section 4.1).
    tier: Literal["FOUNDATION"] = "FOUNDATION"
    exam_series: str = Field(max_length=32, pattern=r"^20\d{2}-(summer|november)$")
    target_grade: Literal[4, 5]
    is_resitter: bool


@router.put("/profile", operation_id="setUpProfile")
def set_up_profile(body: SetupIn, student: Student, session: DbSession) -> MeOut:
    profile = profile_of(session, student)
    profile.board = body.board
    profile.tier = body.tier
    profile.exam_series = body.exam_series
    profile.target_grade = body.target_grade
    profile.is_resitter = body.is_resitter
    if profile.setup_completed_at is None:
        profile.setup_completed_at = datetime.now(UTC)
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="profile.set_up",
        target_type="user",
        target_id=student.id,
    )
    session.commit()
    return _me(session, student)


@router.put("/preferences", operation_id="setPreferences")
def set_preferences(body: Preferences, student: Student, session: DbSession) -> MeOut:
    profile = profile_of(session, student)
    profile.preferences = body.model_dump()
    session.commit()
    return _me(session, student)


class DataRequestIn(BaseModel):
    kind: Literal["EXPORT", "DELETE"]
    #: Deleting needs this set: the page asks the student to confirm first.
    confirm: bool = False


class DataRequestOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    requested_at: datetime
    completed_at: datetime | None


def _request_out(row: DataRequest) -> DataRequestOut:
    return DataRequestOut(
        id=row.id,
        kind=row.kind,
        status=row.status,
        requested_at=row.requested_at,
        completed_at=row.completed_at,
    )


@router.get("/data-requests", operation_id="listDataRequests")
def list_data_requests(student: Student, session: DbSession) -> list[DataRequestOut]:
    rows = session.scalars(
        select(DataRequest)
        .where(DataRequest.user_id == student.id)
        .order_by(DataRequest.requested_at.desc())
    ).all()
    return [_request_out(row) for row in rows]


@router.post("/data-requests", operation_id="createDataRequest")
def create_data_request(
    body: DataRequestIn, student: Student, session: DbSession
) -> DataRequestOut:
    if body.kind == "DELETE" and not body.confirm:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Confirm that you want to delete."
        )
    open_request = session.scalar(
        select(DataRequest).where(
            DataRequest.user_id == student.id,
            DataRequest.kind == body.kind,
            DataRequest.status.in_(("RECEIVED", "IN_PROGRESS")),
        )
    )
    row = open_request or DataRequest(user_id=student.id, kind=body.kind, status="RECEIVED")
    if open_request is None:
        session.add(row)
    if body.kind == "DELETE":
        # Deactivated now, signed out everywhere; the erasure job completes within 30 days.
        student.deactivated_at = datetime.now(UTC)
        session.execute(delete(SessionRow).where(SessionRow.user_id == student.id))
    session.flush()
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="account.delete_request" if body.kind == "DELETE" else "data.export_request",
        target_type="data_request",
        target_id=row.id,
    )
    session.commit()
    return _request_out(row)


class ConcernIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    category: Literal["SAFETY", "CONTENT", "PRIVACY", "OTHER"]
    message: str = Field(min_length=1, max_length=2000)
    #: The page it was reported from: a path only, never a query string.
    page: str | None = Field(default=None, max_length=200, pattern=r"^/[A-Za-z0-9/_-]*$")
    tutor_session_id: uuid.UUID | None = None


class ConcernOut(BaseModel):
    id: uuid.UUID
    created_at: datetime


@router.post("/concerns", operation_id="reportConcern")
def report_concern(body: ConcernIn, student: Student, session: DbSession) -> ConcernOut:
    since = datetime.now(UTC) - timedelta(days=1)
    recent = session.scalar(
        select(func.count())
        .select_from(ConcernReport)
        .where(ConcernReport.user_id == student.id, ConcernReport.created_at >= since)
    )
    if (recent or 0) >= CONCERNS_PER_DAY:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You have sent a lot of reports today. If you are in danger, call 999.",
        )
    lesson = None
    if body.tutor_session_id is not None:
        owned = session.scalar(
            select(TutorSession.id).where(
                TutorSession.id == body.tutor_session_id, TutorSession.student_id == student.id
            )
        )
        lesson = owned  # someone else's lesson is quietly not linked
    row = ConcernReport(
        user_id=student.id,
        category=body.category,
        message=body.message,
        page=body.page,
        tutor_session_id=lesson,
    )
    session.add(row)
    session.flush()
    audit.record(
        session,
        actor_id=student.id,
        actor_role="student",
        action="concern.report",
        target_type="concern_report",
        target_id=row.id,
    )
    session.commit()
    return ConcernOut(id=row.id, created_at=row.created_at)
