"""Node selection, interleaving and today's plan (SPEC.md 4.2, 4.3 and 7.1, ADR-0026).

- A prerequisite is met once it has been secured (SECURE, or NEEDS_REVIEW after being secured).
  A review falling due on a root node must not lock the course behind it. A prerequisite with
  no items yet cannot be practised, so it is met when its own prerequisites are: the gate looks
  through it to the practisable nodes behind it.
- Next node: carry on with a node already started (LEARNING), the nearest to SECURE first.
  Otherwise open a new one: the lowest-mastery node whose prerequisites are met, weighted by
  Foundation mark density. A target grade of 5 flattens that weighting, because a student
  aiming higher spreads effort more evenly.
- Reviews: due FSRS cards, oldest first, plus any node that has slipped to NEEDS_REVIEW (a
  repair, even before its card is due), at most 5 a session. Once 3 or more nodes have been
  secured, reviews are interleaved so that consecutive reviews come from different strands
  where possible; before that, practice stays blocked by node.
- Today's plan: one node, the reviews, one re-check, and the head of the remediation queue.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from fsrs import Card

from eddy_api.learner.mastery import SECURED, NodeMastery
from eddy_api.learner.misconceptions import Track, awaiting_recheck, remediation_queue
from eddy_api.learner.review import is_due

INTERLEAVE_AFTER = 3
MAX_REVIEWS = 5


@dataclass(frozen=True)
class NodeInfo:
    code: str
    strand: str
    prerequisites: tuple[tuple[str, float], ...] = ()
    # Foundation mark density (curriculum_node.exam_weight_hint); 1.0 until it is measured.
    weight: float = 1.0
    # False when maths-core has no item template for the node: it is never chosen, and it does
    # not hold back the nodes that depend on it.
    practisable: bool = True


@dataclass(frozen=True)
class SessionPlan:
    node: str | None
    reviews: tuple[str, ...]
    recheck: str | None
    remediation: str | None
    interleaved: bool


def _state(model: Mapping[str, NodeMastery], code: str) -> NodeMastery:
    return model.get(code) or NodeMastery(node=code)


def _natural(code: str) -> tuple[str, int]:
    """N2 before N10."""
    found = re.fullmatch(r"([A-Z]+)(\d+)", code)
    return (found[1], int(found[2])) if found else (code, 0)


def secured(model: Mapping[str, NodeMastery]) -> list[str]:
    """Nodes that have reached SECURE, including those now due for review."""
    return sorted(code for code, s in model.items() if s.status in SECURED)


def ready(info: NodeInfo, model: Mapping[str, NodeMastery], nodes: Mapping[str, NodeInfo]) -> bool:
    """Every prerequisite is secured. One with no items is looked through: it is met when its
    own prerequisites are. A prerequisite missing from `nodes` is outside the plan and met."""
    for code, _ in info.prerequisites:
        prerequisite = nodes.get(code)
        if prerequisite is None:
            continue
        if prerequisite.practisable:
            if _state(model, code).status not in SECURED:
                return False
        elif not ready(prerequisite, model, nodes):
            return False
    return True


def choose_node(
    nodes: Sequence[NodeInfo], model: Mapping[str, NodeMastery], target_grade: int = 4
) -> str | None:
    by_code = {info.code: info for info in nodes}
    candidates = [
        info
        for info in nodes
        if info.practisable
        and _state(model, info.code).status in ("UNSEEN", "LEARNING")
        and ready(info, model, by_code)
    ]
    started = [info for info in candidates if _state(model, info.code).status == "LEARNING"]
    if started:
        return min(
            started, key=lambda info: (-_state(model, info.code).p_mastery, _natural(info.code))
        ).code
    if not candidates:
        return None
    exponent = 1.0 if target_grade <= 4 else 0.5
    return min(
        candidates,
        key=lambda info: (
            -(1 - _state(model, info.code).p_mastery) * info.weight**exponent,
            # Ties: fewer prerequisites first, then in natural order, so the choice is stable.
            len(info.prerequisites),
            _natural(info.code),
        ),
    ).code


def interleaving_on(model: Mapping[str, NodeMastery]) -> bool:
    return len(secured(model)) >= INTERLEAVE_AFTER


def review_order(due: Sequence[tuple[str, str, datetime]], *, interleave: bool) -> list[str]:
    """Order due reviews, each (node, strand, due_at). Oldest first; when interleaving, the
    next review comes from a different strand than the last wherever one is waiting."""
    waiting = sorted(due, key=lambda entry: (entry[2], _natural(entry[0])))
    if not interleave:
        return [node for node, _, _ in waiting]
    ordered: list[str] = []
    last_strand: str | None = None
    while waiting:
        pick = next((e for e in waiting if e[1] != last_strand), waiting[0])
        waiting.remove(pick)
        ordered.append(pick[0])
        last_strand = pick[1]
    return ordered


def plan_session(
    nodes: Sequence[NodeInfo],
    model: Mapping[str, NodeMastery],
    cards: Mapping[str, Card],
    tracks: Sequence[Track],
    now: datetime,
    *,
    target_grade: int = 4,
) -> SessionPlan:
    strands = {info.code: info.strand for info in nodes}
    due = [
        (code, strands.get(code, ""), card.due) for code, card in cards.items() if is_due(card, now)
    ]
    listed = {code for code, _, _ in due}
    due += [
        (code, strands.get(code, ""), now)
        for code, state in sorted(model.items())
        if state.status == "NEEDS_REVIEW" and code not in listed
    ]
    interleave = interleaving_on(model)
    node = choose_node(nodes, model, target_grade)
    queue = remediation_queue(tracks, node)
    recheck = awaiting_recheck(tracks)
    return SessionPlan(
        node=node,
        reviews=tuple(review_order(due, interleave=interleave)[:MAX_REVIEWS]),
        recheck=recheck[0].code if recheck else None,
        remediation=queue[0].code if queue else None,
        interleaved=interleave,
    )
