"""The onboarding diagnostic (SPEC.md section 4.1, ADR-0032).

About 15 minutes, stoppable and resumable. One question per node, in an order that starts with
the nodes that build on others: a confident right answer (3 or 4 out of 4) on a node passes over
its prerequisites, a wrong answer keeps them in the queue. At most MAX_QUESTIONS questions.

Questions are typed answers checked by maths-core, not multiple choice: most templates carry
one misconception distractor, so four options that each name a misconception are not possible
yet (ADR-0032). A wrong answer that matches a misconception rule makes it SUSPECTED, never
CONFIRMED (ADR-0026). Confidence is asked before the answer is revealed. "I do not know yet"
counts as a wrong answer with no misconception.

The state holds node codes and item ids only, never what the student typed; answers are
attempts (`is_diagnostic`).
"""

import json
import uuid
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api.db.models import (
    Attempt,
    CurriculumNode,
    DiagnosticSession,
    Item,
    Misconception,
    StudentProfile,
)
from eddy_api.scenes.services import MathsCoreClient
from eddy_api.tutor import learner_store

MAX_QUESTIONS = 20
SURE = 3
STRAND_ORDER = {
    "NUMBER": 0,
    "RATIO": 1,
    "ALGEBRA": 2,
    "GEOMETRY": 3,
    "PROBABILITY": 4,
    "STATISTICS": 5,
}


@dataclass(frozen=True)
class Question:
    number: int
    item_id: str
    node: str
    node_title: str
    stem: str
    command_word: str
    calculator: bool


@dataclass(frozen=True)
class Reveal:
    correct: bool
    answer_latex: str
    misconception: str | None


def _seed(session_id: uuid.UUID, index: int) -> int:
    return zlib.crc32(f"{session_id}:{index}".encode()) & 0x7FFFFFFF


def _templates_by_node(maths_core: MathsCoreClient) -> dict[str, list[dict[str, Any]]]:
    by_node: dict[str, list[dict[str, Any]]] = {}
    for template in maths_core.templates():
        by_node.setdefault(str(template["node"]), []).append(template)
    return by_node


def plan_queue(session: Session, practisable: set[str]) -> list[str]:
    """Nodes that build on more come first, so a confident answer can pass over the rest."""
    infos = learner_store.node_infos(session, practisable)
    depth: dict[str, int] = {}
    prerequisites = {i.code: [code for code, _ in i.prerequisites] for i in infos}

    def depth_of(code: str, seen: frozenset[str] = frozenset()) -> int:
        if code in depth:
            return depth[code]
        below = [p for p in prerequisites.get(code, []) if p not in seen]
        value = 1 + max((depth_of(p, seen | {code}) for p in below), default=0)
        depth[code] = value
        return value

    nodes = [i for i in infos if i.practisable]
    return [
        i.code
        for i in sorted(
            nodes,
            key=lambda i: (-depth_of(i.code), STRAND_ORDER.get(i.strand, 9), i.code),
        )
    ]


def start_or_resume(
    session: Session, maths_core: MathsCoreClient, student: uuid.UUID
) -> DiagnosticSession:
    row = session.scalar(
        select(DiagnosticSession).where(
            DiagnosticSession.student_id == student, DiagnosticSession.completed_at.is_(None)
        )
    )
    if row is not None:
        return row
    profile = session.get(StudentProfile, student)
    if profile is not None and profile.diagnostic_completed_at is not None:
        # Done once: coming back shows it finished, and never feeds the model a second time.
        done = session.scalar(
            select(DiagnosticSession)
            .where(DiagnosticSession.student_id == student)
            .order_by(DiagnosticSession.started_at.desc())
        )
        if done is not None:
            return done
    practisable = set(_templates_by_node(maths_core))
    row = DiagnosticSession(
        student_id=student,
        state={"queue": plan_queue(session, practisable), "asked": [], "skipped": []},
    )
    session.add(row)
    session.flush()
    _next_item(session, maths_core, row)
    return row


def _node_row(session: Session, code: str) -> CurriculumNode:
    row = session.scalar(select(CurriculumNode).where(CurriculumNode.code == code))
    if row is None:
        raise LookupError(code)
    return row


def _next_item(session: Session, maths_core: MathsCoreClient, row: DiagnosticSession) -> None:
    """Puts the next question in the state, or marks the diagnostic done."""
    state = dict(row.state)
    queue: list[str] = list(state["queue"])
    asked: list[dict[str, Any]] = list(state["asked"])
    if not queue or len(asked) >= MAX_QUESTIONS:
        state["current"] = None
        row.state = state
        _finish(session, row)
        return
    node = queue.pop(0)
    templates = _templates_by_node(maths_core).get(node, [])
    if not templates:
        state["queue"] = queue
        row.state = state
        _next_item(session, maths_core, row)
        return
    index = len(asked)
    seed = _seed(row.id, index)
    # Questions that need a diagram wait for the lesson, which can draw them.
    start = seed % len(templates)
    generated: dict[str, Any] | None = None
    template: dict[str, Any] = templates[start]
    for offset in range(len(templates)):
        template = templates[(start + offset) % len(templates)]
        candidate = maths_core.item(str(template["id"]), seed)
        if not candidate.get("diagram"):
            generated = candidate
            break
    if generated is None:
        state["queue"] = queue
        row.state = state
        _next_item(session, maths_core, row)
        return
    node_row = _node_row(session, node)
    item = Item(
        node_id=node_row.id,
        template_id=generated["template_id"],
        seed=seed,
        params=generated["params"],
        stem_markdown=generated["stem_markdown"],
        answer_canonical=json.dumps(generated["answer"]["mathjson"]),
        answer_format=generated["answer_format"],
        calculator_allowed=generated["calculator"],
        command_word=generated["command_word"],
        marks=generated["marks"],
        distractors=[
            {"value": d["value"]["mathjson"], "misconception_code": d["misconception"]}
            for d in generated["distractors"]
        ],
        provenance="TEMPLATE",
        cas_verified_at=datetime.now(UTC),
    )
    session.add(item)
    session.flush()
    state["queue"] = queue
    state["current"] = {
        "item_id": str(item.id),
        "node": node,
        "template_id": generated["template_id"],
        "seed": seed,
        "answer_latex": generated["answer"]["latex"],
        "could_reveal": sorted(
            {d["misconception"] for d in generated["distractors"]}
            | set(template.get("structures", []))
        ),
        "served_at": datetime.now(UTC).isoformat(),
    }
    row.state = state


def question(session: Session, row: DiagnosticSession) -> Question | None:
    current = row.state.get("current")
    if not current:
        return None
    item = session.get(Item, uuid.UUID(current["item_id"]))
    node = _node_row(session, current["node"])
    if item is None:
        return None
    return Question(
        number=len(row.state["asked"]) + 1,
        item_id=current["item_id"],
        node=current["node"],
        node_title=node.title,
        stem=item.stem_markdown,
        command_word=item.command_word,
        calculator=item.calculator_allowed,
    )


class UnreadableError(ValueError):
    """maths-core could not read the answer: nothing is recorded. The message is safe to show."""


def answer(
    session: Session,
    maths_core: MathsCoreClient,
    row: DiagnosticSession,
    *,
    mathjson: Any | None,
    confidence: int,
    dont_know: bool,
) -> Reveal:
    state = dict(row.state)
    current = state.get("current")
    if not current:
        raise LookupError("no question")
    codes: list[str] = []
    if dont_know:
        correct = False
    else:
        result = maths_core.check_answer(current["template_id"], current["seed"], mathjson)
        if result.get("unreadable"):
            issues = [i["message"] for i in result.get("format_issues", [])]
            raise UnreadableError(issues[0] if issues else "Eddy could not read that answer.")
        correct = bool(result["correct"])
        codes = [] if correct else list(result.get("misconceptions", []))
    misconception = (
        session.scalar(select(Misconception).where(Misconception.code == codes[0]))
        if codes
        else None
    )
    served = datetime.fromisoformat(current["served_at"])
    now = datetime.now(UTC)
    time_ms = max(0, int((now - served).total_seconds() * 1000))
    attempt = Attempt(
        student_id=row.student_id,
        item_id=uuid.UUID(current["item_id"]),
        response_raw="",
        response_mathjson=None if dont_know else mathjson,
        correct=correct,
        detected_misconception_id=misconception.id if misconception else None,
        confidence_self_report=confidence,
        is_diagnostic=True,
        time_ms=time_ms,
    )
    session.add(attempt)
    session.flush()
    node_row = _node_row(session, current["node"])
    node_codes = tuple(
        session.scalars(select(Misconception.code).where(Misconception.node_id == node_row.id))
    )
    learner_store.apply_answer(
        session,
        student=row.student_id,
        node=node_row,
        attempt_id=attempt.id,
        lesson=f"diagnostic:{row.id}",
        correct=correct,
        misconception=misconception,
        confidence=confidence,
        hints=0,
        aided=False,
        time_ms=time_ms,
        could_reveal=tuple(current["could_reveal"]),
        node_codes=node_codes,
        now=now,
        diagnostic=True,
    )
    asked = list(state["asked"])
    asked.append({"node": current["node"], "item_id": current["item_id"], "correct": correct})
    queue: list[str] = list(state["queue"])
    if correct and confidence >= SURE:
        # A confident right answer passes over the node's prerequisites.
        info = next(
            (i for i in learner_store.node_infos(session, set(queue)) if i.code == current["node"]),
            None,
        )
        below = {code for code, _ in info.prerequisites} if info else set()
        skipped = [code for code in queue if code in below]
        queue = [code for code in queue if code not in below]
        state["skipped"] = list(state.get("skipped", [])) + skipped
    state["asked"] = asked
    state["queue"] = queue
    state["current"] = None
    row.state = state
    reveal = Reveal(
        correct=correct,
        answer_latex=current["answer_latex"],
        misconception=misconception.student_facing_description if misconception else None,
    )
    _next_item(session, maths_core, row)
    return reveal


def _finish(session: Session, row: DiagnosticSession) -> None:
    now = datetime.now(UTC)
    row.completed_at = now
    profile = session.get(StudentProfile, row.student_id)
    if profile is not None and profile.diagnostic_completed_at is None:
        profile.diagnostic_completed_at = now
