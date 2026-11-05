"""Bayesian knowledge tracing: the probability a student has mastered one node.

Starting parameters are the SPEC.md 7.1 defaults, to be refitted per node once pilot data
exists. An aided attempt (a hint used, or a scene watched before answering) moves the estimate
only part of the way a normal attempt would.
"""

from dataclasses import dataclass

# Probabilities stay inside (P_MIN, P_MAX). The ceiling matters: without it a long run of
# correct answers saturates the estimate, and then several wrong answers in a row barely move
# it, so a node the student has stopped understanding would still look mastered (ADR-0026).
P_MIN = 1e-4
P_MAX = 0.99


@dataclass(frozen=True)
class BktParams:
    p_init: float = 0.2
    p_learn: float = 0.15
    p_guess: float = 0.2
    p_slip: float = 0.1


DEFAULT = BktParams()


def _clamp(p: float) -> float:
    return min(P_MAX, max(P_MIN, p))


def guess_rate(params: BktParams, options: int | None) -> float:
    """The chance of a right answer without the skill. A choice between `options` answers can
    be guessed one time in `options` (0.25 for four, as SPEC.md 7.1 says; 0.5 for a choice of
    two), and never less than a free answer's rate."""
    if options is None:
        return params.p_guess
    if options < 2:
        raise ValueError("a choice needs at least two options")
    return max(params.p_guess, 1 / options)


def posterior(p: float, correct: bool, guess: float, slip: float) -> float:
    """P(mastered | this answer), before any learning from the attempt itself."""
    if correct:
        knew = p * (1 - slip)
        return knew / (knew + (1 - p) * guess)
    knew = p * slip
    return knew / (knew + (1 - p) * (1 - guess))


def update(
    p: float,
    correct: bool,
    params: BktParams = DEFAULT,
    *,
    weight: float = 1.0,
    options: int | None = None,
) -> float:
    """The mastery estimate after one attempt.

    `weight` below 1 moves the estimate only that fraction of the way: aided attempts count,
    but for less (SPEC.md 7.1). `options` is the number of answers to choose from on a choice
    item, None for a free answer.
    """
    if not 0 < weight <= 1:
        raise ValueError("weight must be in (0, 1]")
    after = posterior(_clamp(p), correct, guess_rate(params, options), params.p_slip)
    learned = after + (1 - after) * params.p_learn
    return _clamp(p + weight * (learned - p))
