"""Algebra: A8, A9, A10 and A17 templates and rules."""

import random

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.base import Template
from eddy_maths_core.rules import Params, q, rule

X, Y = sympy.symbols("x y")
COORDINATE = AnswerFormat(kind="coordinate")
EQUATION = AnswerFormat(kind="equation")


def _nonzero(rng: random.Random, low: int, high: int) -> int:
    return rng.choice([n for n in range(low, high + 1) if n != 0])


def _signed(value: int) -> str:
    """'+ 3' or '- 3', for writing terms after the first."""
    return f"+ {value}" if value >= 0 else f"- {-value}"


def _units(count: int) -> str:
    return "1 unit" if count == 1 else f"{count} units"


def _term(coefficient: int, letter: str = "x") -> str:
    if coefficient == 1:
        return letter
    if coefficient == -1:
        return f"-{letter}"
    return f"{coefficient}{letter}"


# A17: linear equations


@rule("eq_inverse_wrong_operation")
def _same_operation(p: Params) -> sympy.Basic:
    return q(p["c"] + p["b"])  # x + b = c gives c + b


@rule("eq_coefficient_subtracted")
def _coefficient_subtracted(p: Params) -> sympy.Basic:
    return q(p["c"] - p["a"])  # ax = c gives c - a


@rule("eq_divide_one_term")
def _divide_one_term(p: Params) -> sympy.Basic:
    return q(p["c"], p["a"]) - p["b"]  # ax + b = c gives x + b = c / a


@rule("eq_move_without_sign_change")
def _move_keep_sign(p: Params) -> sympy.Basic | None:
    # ax + b = cx + d: cx crosses as +cx, so (a + c)x + b = d.
    if p["a"] + p["c"] == 0:
        return None
    return q(p["d"] - p["b"], p["a"] + p["c"])


@rule("eq_sign_changed_not_moved")
def _sign_in_place(p: Params) -> sympy.Basic | None:
    # ax + b = cx + d becomes ax - b = cx + d, then is solved correctly.
    if p["a"] == p["c"]:
        return None
    return q(p["d"] + p["b"], p["a"] - p["c"])


@rule("expand_first_term_only")
def _first_term_only(p: Params) -> sympy.Basic:
    return q(p["c"] - p["b"], p["a"])  # a(x + b) = c read as ax + b = c


@rule("eq_sign_lost_dividing_negative")
def _sign_lost(p: Params) -> sympy.Basic:
    return q(abs(p["c"]), abs(p["a"]))  # -ax = c gives a positive answer


# A8: coordinates


@rule("coordinates_swapped")
def _coordinates_swapped(p: Params) -> sympy.Basic:
    return sympy.Tuple(p["y"], p["x"])


# A9: straight-line graphs


@rule("line_table_swapped")
def _table_swapped(p: Params) -> sympy.Basic:
    # Uses the given x value as y and solves for x instead.
    return q(p["k"] - p["c"], p["m"])


@rule("parallel_by_intercept")
def _parallel_intercept(p: Params) -> sympy.Basic:
    return q(p["c"])


# A10: gradient and intercept


@rule("gradient_run_over_rise")
def _run_over_rise(p: Params) -> sympy.Basic | None:
    rise, run = p["y2"] - p["y1"], p["x2"] - p["x1"]
    return q(run, rise) if rise else None


@rule("gradient_sign_dropped")
def _sign_dropped(p: Params) -> sympy.Basic:
    return abs(q(p["y2"] - p["y1"], p["x2"] - p["x1"]))


@rule("intercept_not_divided")
def _not_divided(p: Params) -> sympy.Basic:
    return q(p["c"])


@rule("gradient_counts_squares")
def _counts_squares(p: Params) -> sympy.Basic:
    return q(p["rise_squares"], p["run_squares"])


def _one_step(rng: random.Random) -> Params:
    x, b = rng.randint(-9, 15), rng.randint(2, 15)
    return {"b": b, "c": x + b, "x": x}


def _two_step(rng: random.Random) -> Params:
    a, x, b = rng.randint(2, 9), rng.randint(-6, 12), _nonzero(rng, -12, 15)
    return {"a": a, "b": b, "c": a * x + b, "x": x}


def _both_sides(rng: random.Random) -> Params:
    a, c = rng.sample(range(2, 10), 2)
    x = rng.randint(-6, 10)
    b = _nonzero(rng, -10, 12)
    return {"a": a, "b": b, "c": c, "d": a * x + b - c * x, "x": x}


def _two_points(rng: random.Random) -> Params:
    m = _nonzero(rng, -5, 5)
    x1 = rng.randint(-5, 3)
    x2 = x1 + rng.randint(1, 4)
    y1 = rng.randint(-6, 6)
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y1 + m * (x2 - x1), "m": m}


def _scaled_graph(rng: random.Random) -> Params:
    x_scale, y_scale = rng.choice([(1, 2), (1, 5), (2, 1), (1, 10), (2, 5)])
    run_squares = rng.randint(2, 6)
    rise_squares = rng.randint(1, 8)
    return {
        "x_scale": x_scale,
        "y_scale": y_scale,
        "run_squares": run_squares,
        "rise_squares": rise_squares,
    }


TEMPLATES = [
    Template(
        id="a17-one-step-add",
        node="A17",
        family="A17.one-step",
        command_word="SOLVE",
        marks=1,
        calculator=False,
        draw=_one_step,
        stem=lambda p: f"Solve $x + {p['b']} = {p['c']}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={"EQ_WRONG_INVERSE": "eq_inverse_wrong_operation"},
    ),
    Template(
        id="a17-one-step-multiply",
        node="A17",
        family="A17.one-step-multiply",
        command_word="SOLVE",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda a, x: {"a": a, "c": a * x, "x": x})(
            r.randint(2, 9), r.randint(2, 12)
        ),
        stem=lambda p: f"Solve ${p['a']}x = {p['c']}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={"EQ_COEFFICIENT_SUBTRACTED": "eq_coefficient_subtracted"},
    ),
    Template(
        id="a17-two-step",
        node="A17",
        family="A17.two-step",
        command_word="SOLVE",
        marks=2,
        calculator=False,
        draw=_two_step,
        stem=lambda p: f"Solve ${p['a']}x {_signed(p['b'])} = {p['c']}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={"EQ_DIVIDE_ONE_TERM": "eq_divide_one_term"},
    ),
    Template(
        id="a17-unknown-both-sides",
        node="A17",
        family="A17.unknown-both-sides",
        command_word="SOLVE",
        marks=3,
        calculator=False,
        draw=_both_sides,
        valid=lambda p: p["a"] > p["c"] and p["d"] != 0,
        stem=lambda p: f"Solve ${p['a']}x {_signed(p['b'])} = {p['c']}x {_signed(p['d'])}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={
            "EQ_MOVE_WITHOUT_SIGN_CHANGE": "eq_move_without_sign_change",
            "EQ_SIGN_CHANGED_NOT_MOVED": "eq_sign_changed_not_moved",
        },
    ),
    Template(
        id="a17-brackets",
        node="A17",
        family="A17.equation-with-brackets",
        command_word="SOLVE",
        marks=2,
        calculator=False,
        draw=lambda r: (lambda a, b, x: {"a": a, "b": b, "c": a * (x + b), "x": x})(
            r.randint(2, 6), _nonzero(r, -5, 8), r.randint(-4, 9)
        ),
        stem=lambda p: f"Solve ${p['a']}(x {_signed(p['b'])}) = {p['c']}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={"EQ_BRACKET_FIRST_TERM_ONLY": "expand_first_term_only"},
    ),
    Template(
        id="a17-negative-coefficient",
        node="A17",
        family="A17.negative-coefficient",
        command_word="SOLVE",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda a, x: {"a": -a, "c": -a * x, "x": x})(
            r.randint(2, 9), _nonzero(r, -9, 9)
        ),
        # A positive right-hand side and a negative solution, so dropping the sign shows.
        valid=lambda p: p["x"] < 0,
        stem=lambda p: f"Solve ${_term(p['a'])} = {p['c']}$.",
        answer=lambda p: q(p["x"]),
        misconceptions={"EQ_NEGATIVE_DIVISION_SIGN": "eq_sign_lost_dividing_negative"},
    ),
    Template(
        id="a8-read-coordinates",
        node="A8",
        family="A8.read-coordinates",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"x": _nonzero(r, -6, 6), "y": _nonzero(r, -6, 6)},
        valid=lambda p: p["x"] != p["y"],
        stem=lambda _: "Write down the coordinates of point $P$.",
        answer=lambda p: sympy.Tuple(p["x"], p["y"]),
        answer_format=COORDINATE,
        diagram=lambda p: {
            "type": "coordinate_grid",
            "range": 7,
            "points": {"P": [p["x"], p["y"]]},
        },
        misconceptions={"COORDINATES_SWAPPED": "coordinates_swapped"},
    ),
    Template(
        id="a9-table-of-values",
        node="A9",
        family="A9.table-of-values",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"m": r.randint(2, 5), "c": _nonzero(r, -6, 6), "k": r.randint(-3, 5)},
        valid=lambda p: p["k"] != 0,
        stem=lambda p: (
            f"For the line $y = {p['m']}x {_signed(p['c'])}$, work out the value of $y$ "
            f"when $x = {p['k']}$."
        ),
        answer=lambda p: q(p["m"] * p["k"] + p["c"]),
        misconceptions={"LINE_SUBSTITUTION_SWAPPED": "line_table_swapped"},
    ),
    Template(
        id="a9-parallel-gradient",
        node="A9",
        family="A9.parallel-lines",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"m": _nonzero(r, -6, 6), "c": _nonzero(r, -9, 9)},
        valid=lambda p: p["m"] != p["c"],
        stem=lambda p: (
            f"Line $L$ has equation $y = {_term(p['m'])} {_signed(p['c'])}$. "
            "Write down the gradient of any line parallel to $L$."
        ),
        answer=lambda p: q(p["m"]),
        misconceptions={"PARALLEL_BY_INTERCEPT": "parallel_by_intercept"},
    ),
    Template(
        id="a9-line-through-point",
        node="A9",
        family="A9.line-equation",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"m": _nonzero(r, -4, 5), "px": r.randint(-3, 4), "c": r.randint(-8, 8)},
        stem=lambda p: (
            f"A straight line has gradient ${p['m']}$ and passes through the point "
            f"$({p['px']}, {p['m'] * p['px'] + p['c']})$. Find the equation of the line in the "
            "form $y = mx + c$."
        ),
        answer=lambda p: sympy.Eq(Y, p["m"] * X + p["c"]),
        answer_format=EQUATION,
    ),
    Template(
        id="a10-gradient-two-points",
        node="A10",
        family="A10.gradient-from-two-points",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_two_points,
        valid=lambda p: abs(p["m"]) != 1,
        stem=lambda p: (
            f"Work out the gradient of the straight line through $({p['x1']}, {p['y1']})$ and "
            f"$({p['x2']}, {p['y2']})$."
        ),
        answer=lambda p: q(p["m"]),
        misconceptions={
            "GRADIENT_RUN_OVER_RISE": "gradient_run_over_rise",
            "GRADIENT_SIGN_DROPPED": "gradient_sign_dropped",
        },
    ),
    Template(
        id="a10-intercept-from-equation",
        node="A10",
        family="A10.intercept-from-equation",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda a, m, c: {"a": a, "b": a * m, "c": a * c, "m": m, "k": c})(
            r.randint(2, 5), _nonzero(r, -4, 4), _nonzero(r, -6, 6)
        ),
        stem=lambda p: (
            f"A line has equation ${p['a']}y = {_term(p['b'])} {_signed(p['c'])}$. "
            "Write down the $y$-intercept of the line."
        ),
        answer=lambda p: q(p["k"]),
        misconceptions={"INTERCEPT_NOT_DIVIDED": "intercept_not_divided"},
    ),
    Template(
        id="a10-gradient-from-graph",
        node="A10",
        family="A10.gradient-from-graph",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_scaled_graph,
        stem=lambda p: (
            f"On the grid, one square across is {_units(p['x_scale'])} and one square up is "
            f"{_units(p['y_scale'])}. Work out the gradient of the straight line shown."
        ),
        answer=lambda p: q(p["rise_squares"] * p["y_scale"], p["run_squares"] * p["x_scale"]),
        diagram=lambda p: {
            "type": "coordinate_grid",
            "x_scale": p["x_scale"],
            "y_scale": p["y_scale"],
            "line": {"run_squares": p["run_squares"], "rise_squares": p["rise_squares"]},
        },
        misconceptions={"GRADIENT_IGNORES_SCALE": "gradient_counts_squares"},
    ),
]
