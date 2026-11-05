"""Is a response the same maths as the answer? (SPEC.md section 7.3)

Never string comparison. In order of preference:

- Rational expressions (no roots, no pi) are compared exactly: `cancel(a - b) == 0`. No
  tolerance, so 10.0000000001 is not 10.
- Anything else is sampled at 20 random real points that avoid singularities, at 15 digits,
  then confirmed with `simplify` when the expression is small. Points are drawn afresh for every
  call, so nobody can build an expression that vanishes only at known points.
- Equations are equivalent when one is a constant multiple of the other, or when they have the
  same solution set (solved only for one unknown, up to degree 4, as a polynomial or rational
  equation). Tuples compare element by element; ratios by a positive proportion.

Answer-format rules (decimal places, significant figures, simplest form, standard form, units)
are separate: see `formats.py`.
"""

import random
from collections.abc import Iterable

import sympy

from eddy_maths_core.mathjson import degree

# solveset is only used up to quartics; above that, equations compare by sampling.
MAX_SOLVE_DEGREE = 4
# simplify only runs on expressions this small; larger ones rest on sampling.
MAX_SIMPLIFY_OPS = 60

SAMPLES = 20
# Give up after this many points in a row that give no real value.
MAX_MISSES = 10
DIGITS = 15
TOLERANCE = 1e-9

_points = random.SystemRandom()


def _sample_points(symbols: Iterable[sympy.Symbol]) -> dict[sympy.Symbol, sympy.Rational]:
    # Rationals with small denominators avoid both integer coincidences and float noise.
    return {
        s: sympy.Rational(_points.randint(-97, 97), _points.choice([3, 7, 11, 13, 17, 19]))
        for s in symbols
    }


def _evaluate(expr: sympy.Expr, point: dict[sympy.Symbol, sympy.Rational]) -> float | None:
    """The value at a point to DIGITS significant figures, or None if it has no real value."""
    value = expr.evalf(DIGITS, subs=point)
    if not value.is_number or value.has(sympy.zoo, sympy.nan) or not value.is_finite:
        return None
    if not value.is_real:
        return None
    return float(value)


def numerically_zero(expr: sympy.Expr) -> bool:
    """True when `expr` is zero at every one of SAMPLES valid random points."""
    symbols = sorted(expr.free_symbols, key=lambda s: s.name)
    if not symbols:
        value = _evaluate(expr, {})
        return value is not None and abs(value) < TOLERANCE
    tested = 0
    misses = 0  # points in a row where the expression has no real value
    while tested < SAMPLES and misses < MAX_MISSES:
        value = _evaluate(expr, _sample_points(symbols))
        if value is None:
            misses += 1  # a singularity or no real value: try another point
            continue
        misses = 0
        if abs(value) > TOLERANCE:
            return False
        tested += 1
    # An expression with no real value at most points (such as the square root of -x^2) is
    # not shown to be zero.
    return tested == SAMPLES


def _is_rational_expression(expr: sympy.Expr) -> bool:
    symbols = list(expr.free_symbols)
    return bool(expr.is_rational_function(*symbols)) and not expr.has(sympy.pi)


def expressions_equal(a: sympy.Expr, b: sympy.Expr) -> bool:
    difference = a - b
    if difference == 0:
        return True
    if _is_rational_expression(difference):
        return bool(sympy.cancel(difference) == 0)
    # Numeric sampling first: it is fast and rules out most wrong answers at once.
    if not numerically_zero(difference):
        return False
    if sympy.count_ops(difference) > MAX_SIMPLIFY_OPS:
        return numerically_zero(difference)  # a second, independent set of points
    simplified = sympy.simplify(difference)
    # Sampling agreed. A symbolic zero confirms it; when simplify cannot decide, a second set
    # of fresh random points must agree too (ADR-0025).
    return simplified == 0 or numerically_zero(simplified)


def _solutions(relation: sympy.Eq) -> sympy.Set | None:
    symbols = sorted(relation.free_symbols, key=lambda s: s.name)
    if len(symbols) != 1:
        return None
    expr = relation.lhs - relation.rhs
    if not expr.is_rational_function(symbols[0]):
        return None  # roots of roots and the like are not solved; they compare by sampling
    return sympy.solveset(expr, symbols[0], domain=sympy.S.Reals)


def equations_equal(a: sympy.Eq, b: sympy.Eq) -> bool:
    """Same unknowns and the same solution set.

    Most working steps multiply both sides by a constant or rearrange terms, so a constant
    multiple is tried first: it needs no solving. Otherwise one unknown up to degree 4 is
    solved; anything else compares by sampling.
    """
    if a.free_symbols != b.free_symbols:
        return False
    left, right = a.lhs - a.rhs, b.lhs - b.rhs
    if right == 0 or left == 0:
        return bool(left == right)
    if _is_rational_expression(left) and _is_rational_expression(right):
        ratio = sympy.cancel(left / right)
        if ratio.is_number:
            return bool(ratio != 0)
    elif _constant_multiple(left, right):
        return True
    if max(degree(left), degree(right)) <= MAX_SOLVE_DEGREE:
        first, second = _solutions(a), _solutions(b)
        if first is not None and second is not None:
            return bool(first == second)
    return False


def _constant_multiple(left: sympy.Expr, right: sympy.Expr) -> bool:
    """left is a non-zero constant times right, by sampling: no expansion, no solving."""
    symbols = sorted(left.free_symbols | right.free_symbols, key=lambda s: s.name)
    scale: float | None = None
    agreed = 0
    for _ in range(SAMPLES * 3):
        point = _sample_points(symbols)
        top, bottom = _evaluate(left, point), _evaluate(right, point)
        if top is None or bottom is None or abs(bottom) < TOLERANCE:
            continue
        here = top / bottom
        if scale is None:
            scale = here
        elif abs(here - scale) > TOLERANCE * max(1.0, abs(scale)):
            return False
        agreed += 1
        if agreed == SAMPLES:
            break
    return agreed == SAMPLES and scale is not None and abs(scale) > TOLERANCE


def ratios_equal(a: sympy.Tuple, b: sympy.Tuple) -> bool:
    if len(a) != len(b) or any(x == 0 for x in b):
        return False
    scale = a[0] / b[0]
    if not (scale.is_number and scale > 0):
        return False  # 2 : 3 is not -2 : -3
    return all(expressions_equal(x, scale * y) for x, y in zip(a, b, strict=True))


def equivalent(a: sympy.Basic, b: sympy.Basic, *, ratio: bool = False) -> bool:
    """`a` and `b` are the same maths. `ratio` compares tuples by proportion (2:3 is 4:6)."""
    if isinstance(a, sympy.Tuple) or isinstance(b, sympy.Tuple):
        if not (isinstance(a, sympy.Tuple) and isinstance(b, sympy.Tuple)):
            return False
        if ratio:
            return ratios_equal(a, b)
        return len(a) == len(b) and all(equivalent(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, sympy.Eq) or isinstance(b, sympy.Eq):
        return isinstance(a, sympy.Eq) and isinstance(b, sympy.Eq) and equations_equal(a, b)
    if isinstance(a, sympy.Expr) and isinstance(b, sympy.Expr):
        return expressions_equal(a, b)
    return False
