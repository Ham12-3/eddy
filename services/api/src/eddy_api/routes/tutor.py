"""The tutor (SPEC.md sections 7.1 and 9, ADR-0031): start a lesson, send input, read where it is.

- `POST /v1/tutor/sessions` starts a lesson (Loop 1) and returns what to show first.
- `POST /v1/tutor/sessions/{id}/input` resumes it with the student's input: continue, an answer
  (MathJSON), a confidence rating, a message, a request for help, a watched scene, or pause.
- `GET /v1/tutor/sessions/{id}` says where the lesson is.

Students act on their own lessons only, one input at a time per lesson. A message is stored in
`tutor_message` first and reaches the graph by its id, so free text never enters a checkpoint.
The graph's checkpointer runs inside the request's transaction: a turn commits or rolls back as
one. Every input counts against the per-student rate limit, except a message the safeguarding
tripwires catch. Tutor messages are not streamed: they pass every check before the student sees
them. Until Eddy's safeguarding lead approves the script, the tutor runs only in development and
test.
"""

import json
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, status
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from psycopg import Connection as PgConnection
from pydantic import BaseModel, Field, JsonValue, field_validator
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from eddy_api.auth import Caller, require_roles
from eddy_api.config import Settings, development, get_settings, tier_l_enabled
from eddy_api.db.models import CurriculumNode, LlmCall, SafeguardingEvent, TutorSession
from eddy_api.db.models import TutorMessage as TutorMessageRow
from eddy_api.db.session import get_session, session_factory
from eddy_api.llm.client import LlmClient
from eddy_api.llm.records import llm_recorder
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient, SceneServiceError
from eddy_api.tutor import safeguarding
from eddy_api.tutor.graph import Deps, build
from eddy_api.tutor.ratelimit import Limiter, RedisLimiter

router = APIRouter(prefix="/v1/tutor", tags=["tutor"])
DbSession = Annotated[Session, Depends(get_session)]
student_or_system = require_roles("student", "system")
StudentOrSystem = Annotated[Caller, Depends(student_or_system)]
AppSettings = Annotated[Settings, Depends(get_settings)]

MAX_ANSWER_BYTES = 4096
MAX_ANSWER_DEPTH = 24
TUTOR_ROUTES = ("tutor.turn", "safety.input", "safety.output")
TURN_WAIT_S = 15


@dataclass(frozen=True)
class TutorServices:
    maths_core: MathsCoreClient
    scene_check: SceneCheckClient | None
    llm: LlmClient | None
    limiter: Limiter
    #: Tutor turns this process runs at once (each holds a database connection).
    slots: threading.BoundedSemaphore


@lru_cache
def get_tutor_services() -> TutorServices:
    settings = get_settings()
    llm = None
    # The tutor sends student text to Claude: the same ZDR gate as Tier L scenes.
    if tier_l_enabled(settings):
        llm = LlmClient.from_key(
            settings.anthropic_api_key.get_secret_value(), recorder=llm_recorder(session_factory())
        )
    return TutorServices(
        maths_core=MathsCoreClient.from_settings(settings),
        scene_check=SceneCheckClient.from_settings(settings),
        llm=llm,
        limiter=RedisLimiter.from_url(
            settings.redis_url, settings.tutor_messages_per_minute, settings.tutor_messages_per_day
        ),
        slots=threading.BoundedSemaphore(settings.tutor_concurrent_turns),
    )


Services = Annotated[TutorServices, Depends(get_tutor_services)]


class TransactionSaver(PostgresSaver):
    """LangGraph's Postgres checkpointer on a connection SQLAlchemy owns, inside its transaction.
    Pipeline mode is off: it needs an idle connection, and this one is mid-transaction; writes
    then run in savepoints of the request's transaction."""

    def __init__(self, conn: "PgConnection[dict[str, Any]]") -> None:
        super().__init__(conn)
        self.supports_pipeline = False


def graph_for(session: Session) -> Any:
    """The lesson graph with its checkpointer on this request's own connection and transaction,
    so checkpoints commit or roll back with everything else the turn writes."""
    raw = cast("PgConnection[dict[str, Any]]", session.connection().connection.driver_connection)
    return build(TransactionSaver(raw))


def _depth(value: Any, level: int = 1) -> int:
    if isinstance(value, list):
        return max((_depth(v, level + 1) for v in value), default=level)
    if isinstance(value, dict):
        return max((_depth(v, level + 1) for v in value.values()), default=level)
    return level


class StartIn(BaseModel):
    #: For a system caller: the student the lesson is for.
    student_id: uuid.UUID | None = None
    #: A node to practise (its code, "N1"); left out, the planner chooses.
    node: str | None = Field(default=None, max_length=8, pattern=r"^[A-Z]{1,3}\d{1,3}$")


class InputIn(BaseModel):
    kind: Literal["continue", "answer", "confidence", "message", "help", "watched", "pause"]
    mathjson: JsonValue | None = None
    value: int | None = Field(default=None, ge=1, le=4)
    text: str | None = Field(default=None, max_length=1000)

    @field_validator("mathjson")
    @classmethod
    def _small(cls, value: JsonValue | None) -> JsonValue | None:
        if value is None:
            return value
        if len(json.dumps(value)) > MAX_ANSWER_BYTES or _depth(value) > MAX_ANSWER_DEPTH:
            raise ValueError("That answer is too long.")
        return value


class LessonOut(BaseModel):
    session_id: uuid.UUID
    state: str
    ended: str | None
    #: What the lesson is waiting for now ("answer", "message", ...); empty once it has ended.
    waiting_for: list[str]
    #: What to show now: tutor messages, items, scenes, the confidence question, the
    #: safeguarding script, the end. Never an item's answer.
    outbox: list[dict[str, JsonValue]]


def _owned(caller: Caller, student_id: uuid.UUID) -> bool:
    return caller.role == "system" or str(student_id) == caller.subject


def within_budget(session: Session, student: uuid.UUID, settings: Settings) -> bool:
    """The tutor's Claude spend over 24 hours, for this student and for everyone, is under its
    caps (ADR-0031). Past either, the tutor is templated."""
    since = datetime.now(UTC) - timedelta(days=1)
    spent = select(func.coalesce(func.sum(LlmCall.cost_estimate_gbp), 0)).where(
        LlmCall.created_at >= since, LlmCall.route.in_(TUTOR_ROUTES)
    )
    if float(session.scalar(spent) or 0) >= settings.tutor_daily_budget_gbp:
        return False
    mine = session.scalar(spent.where(LlmCall.student_id == student))
    return float(mine or 0) < settings.tutor_gbp_per_student_per_day


def _durable(session: Session) -> sessionmaker[Session] | None:
    """Sessions on their own connection, for a safeguarding event that must survive a failed
    turn. Only for a session bound to the engine itself (a request): one bound to a single
    connection (a test's rolled-back transaction) writes the event with the turn."""
    bind = session.get_bind()
    return sessionmaker(bind=bind, expire_on_commit=False) if isinstance(bind, Engine) else None


def _deps(
    session: Session, services: TutorServices, settings: Settings, student: uuid.UUID
) -> Deps:
    llm = services.llm if services.llm and within_budget(session, student, settings) else None
    return Deps(
        session=session,
        maths_core=services.maths_core,
        scene_check=services.scene_check,
        llm=llm,
        durable=_durable(session),
    )


def _waiting(snapshot: Any) -> list[str]:
    for task in getattr(snapshot, "tasks", ()) or ():
        for pending in getattr(task, "interrupts", ()) or ():
            value = getattr(pending, "value", None)
            if isinstance(value, dict):
                return list(value.get("waiting_for", []))
    return []


def _result(
    row: TutorSession, values: dict[str, Any], waiting: list[str], *, latest: bool = True
) -> LessonOut:
    outbox = list(values.get("outbox", []))
    if latest:
        # Only what this turn added: an input that changed nothing shows nothing new.
        outbox = [entry for entry in outbox if entry.get("turn") == values.get("turn", 0)]
    return LessonOut(
        session_id=row.id,
        state=str(values.get("state", "PLAN")),
        ended=values.get("ended"),
        waiting_for=waiting,
        outbox=outbox,
    )


def _run(
    services: TutorServices, session: Session, graph: Any, run: Any, config: Any, deps: Deps
) -> dict[str, Any]:
    if not services.slots.acquire(timeout=TURN_WAIT_S):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Eddy is busy. Try again in a moment."
        )
    try:
        values: dict[str, Any] = graph.invoke(run, config, context=deps)
        return values
    except SceneServiceError:
        session.rollback()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Eddy cannot check maths just now. Try again in a moment.",
        ) from None
    finally:
        services.slots.release()


@router.post("/sessions", operation_id="startTutorSession")
def start(
    body: StartIn,
    caller: StudentOrSystem,
    session: DbSession,
    services: Services,
    settings: AppSettings,
) -> LessonOut:
    if not safeguarding.SCRIPT_APPROVED and not development(settings):
        # The safeguarding script and tripwires are drafts until Eddy's lead approves them.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="The tutor is not available yet."
        )
    if caller.role == "student":
        student = uuid.UUID(caller.subject)
    elif body.student_id is not None:
        student = body.student_id
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Name the student.")
    if body.node is not None:
        known = session.scalar(select(CurriculumNode.id).where(CurriculumNode.code == body.node))
        practisable = {t["node"] for t in services.maths_core.templates()}
        if known is None or body.node not in practisable:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail="There is no practice for that topic."
            )
    if not services.limiter.allow(str(student)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Take a short break.")
    row = TutorSession(student_id=student)
    session.add(row)
    session.flush()
    config: Any = {"configurable": {"thread_id": str(row.id)}}
    graph = graph_for(session)
    values = _run(
        services,
        session,
        graph,
        {"lesson": str(row.id), "student": str(student), "node_override": body.node, "turn": 0},
        config,
        _deps(session, services, settings, student),
    )
    waiting = _waiting(graph.get_state(config))
    session.commit()
    return _result(row, values, waiting)


def _after_safeguarding(session: Session, row: TutorSession, body: InputIn) -> LessonOut:
    """A message after the script: kept for the reviewer as another event, and the script is
    shown again. Nothing else is taken."""
    if body.kind != "message" or not body.text:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This lesson has ended.")
    previous = session.scalar(
        select(SafeguardingEvent)
        .where(SafeguardingEvent.tutor_session_id == row.id)
        .order_by(SafeguardingEvent.created_at.desc())
        .limit(1)
    )
    hit = safeguarding.tripwire(body.text)
    concern = safeguarding.Tripwire(
        previous.category if previous else "other",
        previous.severity if previous else "MEDIUM",  # type: ignore[arg-type]
        "(after the script)",
    )
    concern = safeguarding.more_severe(concern, hit)
    session.add(
        TutorMessageRow(
            session_id=row.id,
            role="STUDENT",
            content=body.text,
            state="ENDED",
            safety_flags=["after_script"],
            created_at=datetime.now(UTC),
        )
    )
    safeguarding.record_event(
        session,
        student_id=row.student_id,
        tutor_session_id=row.id,
        concern=concern,
        text=body.text,
        source="after_script",
    )
    session.commit()
    script = {
        "turn": 0,
        "type": "script",
        "text": safeguarding.SCRIPT,
        "version": safeguarding.SCRIPT_VERSION,
    }
    return LessonOut(
        session_id=row.id, state="ENDED", ended="SAFEGUARDING", waiting_for=[], outbox=[script]
    )


@router.post("/sessions/{session_id}/input", operation_id="sendTutorInput")
def send(
    session_id: uuid.UUID,
    body: InputIn,
    caller: StudentOrSystem,
    session: DbSession,
    services: Services,
    settings: AppSettings,
) -> LessonOut:
    try:
        # One input at a time per lesson. NO KEY UPDATE still lets a safeguarding event that
        # names this lesson be written from another connection.
        row = session.scalar(
            select(TutorSession)
            .where(TutorSession.id == session_id)
            .with_for_update(nowait=True, key_share=True)
        )
    except OperationalError:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Eddy is still working on your last message."
        ) from None
    if row is None or not _owned(caller, row.student_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such lesson.")
    if row.ended_at is not None:
        if row.end_reason == "SAFEGUARDING":
            return _after_safeguarding(session, row, body)
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This lesson has ended.")
    caught = body.kind == "message" and body.text and safeguarding.tripwire(body.text)
    # A disclosure is never held back by the rate limit.
    if not caught and not services.limiter.allow(str(row.student_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Take a short break.")
    config: Any = {"configurable": {"thread_id": str(row.id)}}
    graph = graph_for(session)
    waiting = _waiting(graph.get_state(config))
    if body.kind not in waiting:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"The lesson is waiting for: {', '.join(waiting)}."
        )
    resume: dict[str, Any] = {"kind": body.kind}
    if body.kind == "message":
        if not body.text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Type a message.")
        message = TutorMessageRow(
            session_id=row.id,
            role="STUDENT",
            content=body.text,
            state="PLAN",
            safety_flags=["unscreened"],
            created_at=datetime.now(UTC),
        )
        session.add(message)
        session.flush()
        resume["message_id"] = str(message.id)
    elif body.kind == "answer":
        resume["mathjson"] = body.mathjson
    elif body.kind == "confidence":
        resume["value"] = body.value
    values = _run(
        services,
        session,
        graph,
        Command(resume=resume),
        config,
        _deps(session, services, settings, row.student_id),
    )
    waiting = _waiting(graph.get_state(config))
    session.commit()
    return _result(row, values, waiting)


@router.get("/sessions/{session_id}", operation_id="getTutorSession")
def read(session_id: uuid.UUID, caller: StudentOrSystem, session: DbSession) -> LessonOut:
    row = session.get(TutorSession, session_id)
    if row is None or not _owned(caller, row.student_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such lesson.")
    snapshot = graph_for(session).get_state({"configurable": {"thread_id": str(row.id)}})
    return _result(row, dict(snapshot.values or {}), _waiting(snapshot), latest=False)
