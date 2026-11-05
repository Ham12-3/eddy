"""Elo ratings: item difficulty, student ability per strand, and target-band item choice.

The same scale as chess (400 points is ten-to-one odds). An item's K shrinks as it gathers
attempts, so new items calibrate quickly and settled ones stay put: K is 40 / (1 + n / 20), so
20 after 20 attempts, 10 after 60, and 8 from 80 on. Aided attempts do not update either
rating: help changes the odds the ratings would learn from (ADR-0026).
"""

from collections.abc import Collection, Sequence
from dataclasses import dataclass

SCALE = 400.0
START = 1500.0
K_STUDENT = 32.0
K_ITEM_START = 40.0
K_ITEM_MIN = 8.0
# Attempts after which an item's K has fallen to half its starting value.
K_ITEM_SETTLE = 20.0
# Practice items aim for roughly 70 to 85% predicted success (SPEC.md 7.1).
TARGET_LOW = 0.70
TARGET_HIGH = 0.85
TARGET_MID = (TARGET_LOW + TARGET_HIGH) / 2


def expected(ability: float, difficulty: float) -> float:
    """Predicted chance a student of this ability answers an item of this difficulty."""
    return float(1.0 / (1.0 + 10 ** ((difficulty - ability) / SCALE)))


def item_k(attempts: int) -> float:
    return max(K_ITEM_MIN, K_ITEM_START / (1 + attempts / K_ITEM_SETTLE))


def update(
    ability: float, difficulty: float, item_attempts: int, correct: bool, *, aided: bool = False
) -> tuple[float, float]:
    """(new ability, new difficulty) after one attempt; an aided attempt changes neither."""
    if aided:
        return ability, difficulty
    surprise = (1.0 if correct else 0.0) - expected(ability, difficulty)
    return ability + K_STUDENT * surprise, difficulty - item_k(item_attempts) * surprise


@dataclass(frozen=True)
class Candidate:
    item: str
    family: str
    difficulty: float
    # Misconception codes the item could reveal.
    reveals: tuple[str, ...] = ()


def choose_item(
    ability: float,
    candidates: Sequence[Candidate],
    recent_families: Sequence[str] = (),
    unprobed: Collection[str] = (),
) -> Candidate | None:
    """The item whose predicted success is closest to the middle of the target band.

    Items from recently seen families are only used when nothing else is left, so practice
    does not repeat the same surface. `unprobed` names misconceptions the node's coverage still
    needs (pass it once mastery is near SECURE): items that could reveal one come first.
    """
    fresh = [c for c in candidates if c.family not in recent_families] or list(candidates)
    if not fresh:
        return None
    wanted = set(unprobed)
    pool = [c for c in fresh if wanted.intersection(c.reveals)] or fresh
    return min(
        pool,
        key=lambda c: (abs(expected(ability, c.difficulty) - TARGET_MID), c.item),
    )


def in_target_band(ability: float, difficulty: float) -> bool:
    return TARGET_LOW <= expected(ability, difficulty) <= TARGET_HIGH
