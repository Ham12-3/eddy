"""The learner model in the database (SPEC.md section 7.1, ADR-0026).

`eddy_api.learner` is pure: it never touches the database. This module loads a student's state
for a node (mastery, the misconception tracks, the review card), applies an answer or a
remediation through the learner functions, and saves the result. `mastery_state.model` and
`misconception_state.track` hold the full state; the other columns summarise it for queries.
"""

import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from fsrs import Card, State
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api.db.models import (
    CurriculumNode,
    MasteryState,
    Misconception,
    MisconceptionState,
    NodePrerequisite,
    ReviewCard,
)
from eddy_api.learner import bkt, mastery, misconceptions, review
from eddy_api.learner.mastery import Attempt, NodeMastery
from eddy_api.learner.misconceptions import Track
from eddy_api.learner.planner import NodeInfo


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def node_to_json(state: NodeMastery) -> dict[str, Any]:
    raw = asdict(state)
    raw["unaided_correct"] = [[session, at.isoformat()] for session, at in state.unaided_correct]
    raw["probes"] = [list(pair) for pair in state.probes]
    return raw


def node_from_json(raw: dict[str, Any], code: str) -> NodeMastery:
    if not raw:
        return NodeMastery(node=code)
    return NodeMastery(
        node=raw["node"],
        p_mastery=raw["p_mastery"],
        params=bkt.BktParams(**raw["params"]),
        status=raw["status"],
        evidence_count=raw["evidence_count"],
        unaided_correct=tuple(
            (session, datetime.fromisoformat(at)) for session, at in raw["unaided_correct"]
        ),
        consecutive_failures=raw["consecutive_failures"],
        last_session=raw["last_session"],
        diagnosed_in=raw["diagnosed_in"],
        review_pending=raw["review_pending"],
        probes=tuple((code_, count) for code_, count in raw["probes"]),
    )


def track_to_json(track: Track) -> dict[str, Any]:
    raw = asdict(track)
    raw["evidence"] = list(track.evidence)
    raw["last_seen"] = track.last_seen.isoformat() if track.last_seen else None
    return raw


def track_from_json(raw: dict[str, Any]) -> Track | None:
    if not raw:
        return None
    return Track(
        **{**raw, "evidence": tuple(raw["evidence"]), "last_seen": _time(raw["last_seen"])}
    )


def load_node(session: Session, student: uuid.UUID, node: CurriculumNode) -> NodeMastery:
    row = session.get(MasteryState, (student, node.id))
    return node_from_json(row.model if row else {}, node.code)


def save_node(
    session: Session, student: uuid.UUID, node: CurriculumNode, state: NodeMastery
) -> None:
    row = session.get(MasteryState, (student, node.id))
    if row is None:
        row = MasteryState(student_id=student, node_id=node.id)
        session.add(row)
    row.p_mastery = state.p_mastery
    row.p_learn = state.params.p_learn
    row.p_guess = state.params.p_guess
    row.p_slip = state.params.p_slip
    row.evidence_count = state.evidence_count
    row.status = state.status
    row.model = node_to_json(state)


def load_track(session: Session, student: uuid.UUID, misconception: Misconception) -> Track | None:
    row = session.get(MisconceptionState, (student, misconception.id))
    return track_from_json(row.track) if row else None


def save_track(
    session: Session,
    student: uuid.UUID,
    misconception: Misconception,
    track: Track,
    attempt_id: uuid.UUID | None,
) -> None:
    row = session.get(MisconceptionState, (student, misconception.id))
    if row is None:
        row = MisconceptionState(
            student_id=student, misconception_id=misconception.id, evidence_attempt_ids=[]
        )
        session.add(row)
    row.status = track.status
    if attempt_id is not None:
        row.evidence_attempt_ids = [*row.evidence_attempt_ids, attempt_id]
    row.last_seen_at = track.last_seen or datetime.now(UTC)
    row.track = track_to_json(track)


def node_tracks(session: Session, student: uuid.UUID, node: CurriculumNode) -> list[Track]:
    rows = session.execute(
        select(MisconceptionState.track)
        .join(Misconception, Misconception.id == MisconceptionState.misconception_id)
        .where(MisconceptionState.student_id == student, Misconception.node_id == node.id)
    )
    return [track for (raw,) in rows if (track := track_from_json(raw))]


def load_card(session: Session, student: uuid.UUID, node: CurriculumNode) -> ReviewCard | None:
    return session.scalar(
        select(ReviewCard).where(ReviewCard.student_id == student, ReviewCard.node_id == node.id)
    )


def card_from_row(row: ReviewCard) -> Card:
    return Card(
        state=State[row.fsrs_state],
        stability=row.stability or None,
        difficulty=row.difficulty or None,
        due=row.due_at,
        last_review=row.last_review_at,
    )


def save_card(
    session: Session, student: uuid.UUID, node: CurriculumNode, card: Card, now: datetime
) -> None:
    row = load_card(session, student, node)
    if row is None:
        row = ReviewCard(student_id=student, node_id=node.id, lapses=0, target_retention=0.9)
        session.add(row)
    if row.fsrs_state == State.Review.name and card.state == State.Relearning:
        row.lapses += 1
    row.fsrs_state = card.state.name
    row.difficulty = card.difficulty or 0.0
    row.stability = card.stability or 0.0
    row.retrievability = review.retrievability(card, now)
    row.due_at = card.due
    row.last_review_at = card.last_review


def node_infos(session: Session, practisable: set[str]) -> list[NodeInfo]:
    """Every live node, with its prerequisites, for the planner."""
    nodes = session.scalars(select(CurriculumNode).where(CurriculumNode.retired_at.is_(None)))
    by_id = {node.id: node for node in nodes}
    prerequisites: dict[uuid.UUID, list[tuple[str, float]]] = {}
    for edge in session.scalars(select(NodePrerequisite)):
        target = by_id.get(edge.prerequisite_node_id)
        if target is not None:
            prerequisites.setdefault(edge.node_id, []).append((target.code, float(edge.strength)))
    return [
        NodeInfo(
            code=node.code,
            strand=node.strand,
            prerequisites=tuple(prerequisites.get(node.id, [])),
            weight=float(node.exam_weight_hint or 1.0),
            practisable=node.code in practisable,
        )
        for node in by_id.values()
    ]


def apply_answer(
    session: Session,
    *,
    student: uuid.UUID,
    node: CurriculumNode,
    attempt_id: uuid.UUID,
    lesson: str,
    correct: bool,
    misconception: Misconception | None,
    confidence: int | None,
    hints: int,
    aided: bool,
    time_ms: int,
    could_reveal: tuple[str, ...],
    node_codes: tuple[str, ...],
    now: datetime,
    template_codes: tuple[tuple[str, ...], ...] = (),
    prerequisites: tuple[tuple[str, float], ...] = (),
    diagnostic: bool = False,
) -> NodeMastery:
    """One answer through the learner model (as the M4 simulator does), saved.

    `template_codes` are the misconceptions each of the node's item templates can reveal (SECURE
    must probe those), and `prerequisites` the node's prerequisite edges, whose priors are
    raised when the node becomes SECURE. A diagnostic match only makes a misconception
    SUSPECTED (ADR-0026).
    """
    state = load_node(session, student, node)
    was = state.status
    strong = False
    track: Track | None = None
    if misconception is not None:
        track = load_track(session, student, misconception)
        event = misconceptions.match_event(
            options=None, confidence=confidence, diagnostic=diagnostic
        )
        track = misconceptions.apply(
            track,
            event,
            code=misconception.code,
            node=node.code,
            at=now,
            session=lesson,
            attempt=str(attempt_id),
            confident=bool(confidence and confidence >= 3),
        )
        strong = misconceptions.restarts_run(event, track)
        if strong:
            state = mastery.misconception_seen(state, misconception.code)
        save_track(session, student, misconception, track, attempt_id)
    elif correct:
        # A correct answer on an item that could reveal a remediated misconception re-checks it.
        for open_track in node_tracks(session, student, node):
            if open_track.status == "REMEDIATED" and open_track.code in could_reveal:
                closed = misconceptions.apply(
                    open_track,
                    "recheck_passed",
                    code=open_track.code,
                    node=node.code,
                    at=now,
                    session=lesson,
                    attempt=str(attempt_id),
                )
                row = session.scalar(
                    select(Misconception).where(Misconception.code == open_track.code)
                )
                if row is not None:
                    save_track(session, student, row, closed, attempt_id)
    tracks = node_tracks(session, student, node)
    if track is not None:
        tracks = [t for t in tracks if t.code != track.code] + [track]
    state = mastery.record(
        state,
        Attempt(
            node=node.code,
            correct=correct,
            at=now,
            session=lesson,
            aided=aided,
            confidence=confidence,
            explained=strong,
            could_reveal=could_reveal,
        ),
        to_probe=mastery.probe_codes(node_codes, [could_reveal, *template_codes]),
        open_misconception=misconceptions.node_has_open(tracks, node.code),
    )
    save_node(session, student, node, state)
    if state.status == "SECURE" and was != "SECURE" and prerequisites:
        _boost(session, student, prerequisites)
    grade = review.rating(
        correct=correct, confidence=confidence, hints=hints, aided=aided, time_ms=time_ms
    )
    card_row = load_card(session, student, node)
    if card_row is not None:
        save_card(session, student, node, review.review(card_from_row(card_row), grade, now), now)
    elif state.status == "SECURE":
        save_card(session, student, node, review.start_card(grade, now), now)
    session.flush()
    return state


def apply_remediated(
    session: Session,
    *,
    student: uuid.UUID,
    misconception: Misconception,
    node: CurriculumNode,
    lesson: str,
    now: datetime,
) -> None:
    """The scene and follow-up for a misconception are done."""
    track = load_track(session, student, misconception)
    if track is None or track.status not in ("SUSPECTED", "CONFIRMED", "RECURRED"):
        return
    track = misconceptions.apply(
        track, "remediated", code=misconception.code, node=node.code, at=now, session=lesson
    )
    save_track(session, student, misconception, track, None)
    session.flush()


def _node_rows(session: Session, codes: list[str]) -> dict[str, CurriculumNode]:
    rows = session.scalars(select(CurriculumNode).where(CurriculumNode.code.in_(codes)))
    return {row.code: row for row in rows}


def _boost(
    session: Session, student: uuid.UUID, prerequisites: tuple[tuple[str, float], ...]
) -> None:
    """Prerequisite propagation (SPEC.md section 7.1) after a node becomes SECURE."""
    rows = _node_rows(session, [code for code, _ in prerequisites])
    model = {code: load_node(session, student, row) for code, row in rows.items()}
    boosted = mastery.boost_prerequisites(model, [p for p in prerequisites if p[0] in rows])
    for code, state in boosted.items():
        if state != model.get(code):
            save_node(session, student, rows[code], state)


def student_model(session: Session, student: uuid.UUID, codes: list[str]) -> dict[str, NodeMastery]:
    rows = _node_rows(session, codes)
    return {code: load_node(session, student, row) for code, row in rows.items()}


def student_cards(session: Session, student: uuid.UUID) -> dict[str, Card]:
    rows = session.scalars(select(ReviewCard).where(ReviewCard.student_id == student))
    nodes = {n.id: n.code for n in session.scalars(select(CurriculumNode))}
    return {nodes[row.node_id]: card_from_row(row) for row in rows if row.node_id in nodes}


def student_tracks(session: Session, student: uuid.UUID) -> list[Track]:
    rows = session.scalars(
        select(MisconceptionState).where(MisconceptionState.student_id == student)
    )
    tracks = [track_from_json(dict(row.track or {})) for row in rows]
    return [track for track in tracks if track is not None]


def prerequisite_to_probe(
    session: Session,
    *,
    student: uuid.UUID,
    node: CurriculumNode,
    prerequisites: tuple[tuple[str, float], ...],
    practisable: set[str],
) -> str | None:
    """After two failures on a node, the prerequisite to probe first (SPEC.md section 7.1), or
    None. Offering it is recorded, so it is offered once a session."""
    state = load_node(session, student, node)
    if not mastery.needs_prerequisite_diagnostic(state):
        return None
    model = student_model(session, student, [code for code, _ in prerequisites])
    order = mastery.prerequisite_diagnostic(model, prerequisites, practisable=practisable)
    save_node(session, student, node, mastery.start_diagnostic(state))
    return order[0] if order else None
