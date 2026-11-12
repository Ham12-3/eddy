"""The student's learning pages (SPEC.md sections 4.1 to 4.3).

- `POST /v1/diagnostic`: start the onboarding diagnostic, or resume the one in progress.
- `POST /v1/diagnostic/{id}/answer`: answer the current question, with confidence first.
- `GET /v1/me/plan`: today's plan, from the M4 planner.
- `GET /v1/me/progress`: every node's state for the progress map.

A student acts on their own diagnostic only. Answers are checked by maths-core; nothing is
evaluated here.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, JsonValue, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api import diagnostic
from eddy_api.db.models import CurriculumNode, DiagnosticSession, TutorSession
from eddy_api.db.session import get_session
from eddy_api.learner import planner
from eddy_api.routes.tutor import MAX_ANSWER_BYTES, MAX_ANSWER_DEPTH, Services, _depth
from eddy_api.scenes.services import SceneServiceError
from eddy_api.students import Student, profile_of
from eddy_api.tutor import learner_store

router = APIRouter(tags=["learning"])
DbSession = Annotated[Session, Depends(get_session)]

MapState = Literal["not-started", "learning", "secure", "needs-review"]
#: Rough minutes for each part of a session, for an honest estimate (SPEC.md section 4.2).
MINUTES_NEW_NODE = 15
MINUTES_A_REVIEW = 2
MINUTES_A_RECHECK = 3


class QuestionOut(BaseModel):
    number: int
    item_id: str
    node: str
    node_title: str
    stem: str
    command_word: str
    calculator: bool


class DiagnosticOut(BaseModel):
    id: uuid.UUID
    question: QuestionOut | None
    done: bool
    answered: int
    limit: int


def _out(session: Session, row: DiagnosticSession) -> DiagnosticOut:
    current = diagnostic.question(session, row)
    return DiagnosticOut(
        id=row.id,
        question=QuestionOut(**current.__dict__) if current else None,
        done=row.completed_at is not None,
        answered=len(row.state.get("asked", [])),
        limit=diagnostic.MAX_QUESTIONS,
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Eddy cannot check maths just now. Try again in a moment.",
    )


@router.post("/v1/diagnostic", operation_id="startDiagnostic")
def start_diagnostic(student: Student, session: DbSession, services: Services) -> DiagnosticOut:
    try:
        row = diagnostic.start_or_resume(session, services.maths_core, student.id)
    except SceneServiceError:
        session.rollback()
        raise _unavailable() from None
    session.commit()
    return _out(session, row)


class DiagnosticAnswerIn(BaseModel):
    item_id: uuid.UUID
    mathjson: JsonValue | None = None
    confidence: int = Field(ge=1, le=4)
    dont_know: bool = False

    @field_validator("mathjson")
    @classmethod
    def _small(cls, value: JsonValue | None) -> JsonValue | None:
        if value is None:
            return value
        if len(json.dumps(value)) > MAX_ANSWER_BYTES or _depth(value) > MAX_ANSWER_DEPTH:
            raise ValueError("That answer is too long.")
        return value


class RevealOut(BaseModel):
    correct: bool
    answer_latex: str
    #: The slip in student words ("A common slip: ..."), when the answer matched one.
    misconception: str | None
    next: DiagnosticOut


class UnreadableOut(BaseModel):
    detail: str


@router.post(
    "/v1/diagnostic/{diagnostic_id}/answer",
    operation_id="answerDiagnostic",
    responses={422: {"model": UnreadableOut}},
)
def answer_diagnostic(
    diagnostic_id: uuid.UUID,
    body: DiagnosticAnswerIn,
    student: Student,
    session: DbSession,
    services: Services,
) -> RevealOut:
    row = session.scalar(
        select(DiagnosticSession)
        .where(DiagnosticSession.id == diagnostic_id, DiagnosticSession.student_id == student.id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such diagnostic.")
    current = row.state.get("current")
    if row.completed_at is not None or not current or current["item_id"] != str(body.item_id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That question has been answered.")
    if body.mathjson is None and not body.dont_know:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Type an answer first.")
    try:
        reveal = diagnostic.answer(
            session,
            services.maths_core,
            row,
            mathjson=body.mathjson,
            confidence=body.confidence,
            dont_know=body.dont_know,
        )
    except diagnostic.UnreadableError as error:
        session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from None
    except SceneServiceError:
        session.rollback()
        raise _unavailable() from None
    session.commit()
    return RevealOut(
        correct=reveal.correct,
        answer_latex=reveal.answer_latex,
        misconception=reveal.misconception,
        next=_out(session, row),
    )


class NodeOut(BaseModel):
    code: str
    title: str
    strand: str
    state: MapState
    prerequisites: list[str]


class ProgressOut(BaseModel):
    nodes: list[NodeOut]
    secured: int


def _map_state(status_: str, due: bool) -> MapState:
    if status_ == "SECURE":
        return "needs-review" if due else "secure"
    if status_ == "NEEDS_REVIEW":
        return "needs-review"
    if status_ == "LEARNING":
        return "learning"
    return "not-started"


def _practisable(services: Services) -> set[str]:
    try:
        return {str(t["node"]) for t in services.maths_core.templates()}
    except SceneServiceError:
        raise _unavailable() from None


@router.get("/v1/me/progress", operation_id="getProgress")
def get_progress(student: Student, session: DbSession, services: Services) -> ProgressOut:
    practisable = _practisable(services)
    infos = [i for i in learner_store.node_infos(session, practisable) if i.practisable]
    codes = [i.code for i in infos]
    model = learner_store.student_model(session, student.id, codes)
    cards = learner_store.student_cards(session, student.id)
    titles = dict(
        session.execute(
            select(CurriculumNode.code, CurriculumNode.title).where(CurriculumNode.code.in_(codes))
        ).all()
    )
    now = datetime.now(UTC)
    nodes = []
    for info in sorted(infos, key=lambda i: (diagnostic.STRAND_ORDER.get(i.strand, 9), i.code)):
        state = model.get(info.code)
        card = cards.get(info.code)
        due = card is not None and card.due is not None and card.due <= now
        nodes.append(
            NodeOut(
                code=info.code,
                title=titles.get(info.code, info.code),
                strand=info.strand,
                state=_map_state(state.status if state else "UNSEEN", due),
                prerequisites=[code for code, _ in info.prerequisites if code in practisable],
            )
        )
    return ProgressOut(nodes=nodes, secured=sum(1 for n in nodes if n.state == "secure"))


class PlanOut(BaseModel):
    diagnostic_done: bool
    diagnostic_in_progress: bool
    node: str | None
    node_title: str | None
    reviews: list[str]
    recheck: str | None
    remediation: str | None
    minutes: int
    #: A lesson started and not finished, to carry on with.
    open_lesson: uuid.UUID | None
    session_minutes: int


@router.get("/v1/me/plan", operation_id="getPlan")
def get_plan(student: Student, session: DbSession, services: Services) -> PlanOut:
    profile = profile_of(session, student)
    practisable = _practisable(services)
    infos = learner_store.node_infos(session, practisable)
    codes = [i.code for i in infos if i.practisable]
    now = datetime.now(UTC)
    plan = planner.plan_session(
        infos,
        learner_store.student_model(session, student.id, codes),
        learner_store.student_cards(session, student.id),
        learner_store.student_tracks(session, student.id),
        now,
        target_grade=profile.target_grade or 4,
    )
    title = (
        session.scalar(select(CurriculumNode.title).where(CurriculumNode.code == plan.node))
        if plan.node
        else None
    )
    in_progress = session.scalar(
        select(DiagnosticSession.id).where(
            DiagnosticSession.student_id == student.id, DiagnosticSession.completed_at.is_(None)
        )
    )
    open_lesson = session.scalar(
        select(TutorSession.id)
        .where(TutorSession.student_id == student.id, TutorSession.ended_at.is_(None))
        .order_by(TutorSession.started_at.desc())
    )
    minutes = (
        (MINUTES_NEW_NODE if plan.node else 0)
        + MINUTES_A_REVIEW * len(plan.reviews)
        + (MINUTES_A_RECHECK if plan.recheck else 0)
    )
    preferences = profile.preferences or {}
    return PlanOut(
        diagnostic_done=profile.diagnostic_completed_at is not None,
        diagnostic_in_progress=in_progress is not None,
        node=plan.node,
        node_title=title,
        reviews=list(plan.reviews),
        recheck=plan.recheck,
        remediation=plan.remediation,
        minutes=minutes,
        open_lesson=open_lesson,
        session_minutes=int(preferences.get("session_minutes", 25)),
    )
