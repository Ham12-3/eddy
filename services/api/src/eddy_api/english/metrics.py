"""Agreement between two markers on an ordinal scale (SPEC.md section 7.4, Loop 4).

When English marking arrives (M11), a model's levels are compared with teachers' on the same
answers with these three numbers:

- quadratic weighted kappa: agreement beyond chance, with near misses costing less than far ones;
- exact agreement: the share of answers given the same level;
- adjacent agreement: the share given levels at most one apart.
"""

from collections.abc import Sequence


def _check(first: Sequence[int], second: Sequence[int], low: int, high: int) -> None:
    if len(first) != len(second):
        raise ValueError("Both markers must mark the same answers")
    if not first:
        raise ValueError("No marks to compare")
    if high <= low:
        raise ValueError("The scale needs at least two levels")
    for mark in (*first, *second):
        if not low <= mark <= high:
            raise ValueError(f"Mark {mark} is outside {low} to {high}")


def quadratic_weighted_kappa(
    first: Sequence[int], second: Sequence[int], low: int, high: int
) -> float:
    """Cohen's kappa with quadratic weights on the scale low..high (1 is perfect agreement,
    0 is chance, below 0 worse than chance)."""
    _check(first, second, low, high)
    size = high - low + 1
    observed = [[0.0] * size for _ in range(size)]
    for a, b in zip(first, second, strict=True):
        observed[a - low][b - low] += 1
    count = len(first)
    rows = [sum(row) for row in observed]
    columns = [sum(observed[i][j] for i in range(size)) for j in range(size)]
    disagreement = expected = 0.0
    for i in range(size):
        for j in range(size):
            weight = (i - j) ** 2 / (size - 1) ** 2
            disagreement += weight * observed[i][j]
            expected += weight * rows[i] * columns[j] / count
    if expected == 0:
        # Both markers gave one and the same level throughout: agreement is perfect.
        return 1.0
    return 1.0 - disagreement / expected


def exact_agreement(first: Sequence[int], second: Sequence[int], low: int, high: int) -> float:
    _check(first, second, low, high)
    return sum(a == b for a, b in zip(first, second, strict=True)) / len(first)


def adjacent_agreement(first: Sequence[int], second: Sequence[int], low: int, high: int) -> float:
    _check(first, second, low, high)
    return sum(abs(a - b) <= 1 for a, b in zip(first, second, strict=True)) / len(first)
