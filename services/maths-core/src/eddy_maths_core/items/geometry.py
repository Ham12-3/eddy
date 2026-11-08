"""Geometry and measures: G3, G7, G16, G17 and G20 templates and rules."""

import random

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.base import Template
from eddy_maths_core.items.text import round_half_up, round_sf_rational
from eddy_maths_core.rules import Params, q, rule

DEGREES = AnswerFormat(unit="°")
POINT = AnswerFormat(kind="coordinate")
ONE_DP = AnswerFormat(form="decimal", dp=1)
PYTHAGOREAN = [
    (3, 4, 5),
    (5, 12, 13),
    (6, 8, 10),
    (8, 15, 17),
    (9, 12, 15),
    (7, 24, 25),
    (20, 21, 29),
]


def _rounded(value: sympy.Expr, p: Params) -> sympy.Basic:
    """Round a rule's value the way the item asks the student to round."""
    places = p.get("dp")
    return round_half_up(value, places) if places is not None else value


# G3: angles


@rule("angles_line_sum_360")
def _line_360(p: Params) -> sympy.Basic:
    return q(360 - p["a"])


@rule("triangle_sum_360")
def _triangle_360(p: Params) -> sympy.Basic:
    return q(360 - p["a"] - p["b"])


@rule("cointerior_as_equal")
def _cointerior_equal(p: Params) -> sympy.Basic:
    return q(p["a"])


@rule("polygon_interior_n_times_180")
def _n_times_180(p: Params) -> sympy.Basic:
    return q(p["n"] * 180)


@rule("vertically_opposite_as_supplementary")
def _vertically_supplementary(p: Params) -> sympy.Basic:
    return q(180 - p["a"])


# G7: transformations


@rule("translate_components_swapped")
def _translate_swapped(p: Params) -> sympy.Basic:
    return sympy.Tuple(p["x"] + p["dy"], p["y"] + p["dx"])


def _rotate(x: int, y: int, cx: int, cy: int, clockwise: bool) -> sympy.Tuple:
    dx, dy = x - cx, y - cy
    turned = (dy, -dx) if clockwise else (-dy, dx)
    return sympy.Tuple(cx + turned[0], cy + turned[1])


@rule("rotate_about_origin")
def _about_origin(p: Params) -> sympy.Basic | None:
    if (p["cx"], p["cy"]) == (0, 0):
        return None
    return _rotate(p["x"], p["y"], 0, 0, p["clockwise"])


@rule("rotate_wrong_direction")
def _wrong_direction(p: Params) -> sympy.Basic:
    return _rotate(p["x"], p["y"], p["cx"], p["cy"], not p["clockwise"])


@rule("reflect_line_as_axis")
def _line_as_axis(p: Params) -> sympy.Basic:
    # The diagonal mirror treated as the x-axis.
    return sympy.Tuple(p["x"], -p["y"])


@rule("enlarge_ignore_centre")
def _ignore_centre(p: Params) -> sympy.Basic:
    # Scales the shape in place from its own vertex A instead of from the centre.
    return sympy.Tuple(
        p["ax"] + p["k"] * (p["bx"] - p["ax"]), p["ay"] + p["k"] * (p["by"] - p["ay"])
    )


# G16: area


@rule("area_as_perimeter")
def _as_perimeter(p: Params) -> sympy.Basic:
    return q(2 * (p["l"] + p["w"]))


@rule("triangle_no_half")
def _triangle_no_half(p: Params) -> sympy.Basic:
    return q(p["b"] * p["h"])


@rule("parallelogram_slant_height")
def _slant(p: Params) -> sympy.Basic:
    return q(p["b"] * p["s"])


@rule("trapezium_no_half")
def _trapezium_no_half(p: Params) -> sympy.Basic:
    return q((p["a"] + p["b"]) * p["h"])


@rule("area_units_linear_factor")
def _linear_factor(p: Params) -> sympy.Basic:
    return q(p["m2"] * 100)


# G17: circles and composite shapes


@rule("circle_area_as_circumference")
def _as_circumference(p: Params) -> sympy.Basic:
    return _rounded(2 * sympy.pi * p["r"], p)


@rule("circle_diameter_as_radius")
def _diameter_as_radius(p: Params) -> sympy.Basic:
    return _rounded(sympy.pi * p["d"] ** 2, p)


@rule("composite_perimeter_includes_inner")
def _inner_edges(p: Params) -> sympy.Basic:
    # The L-shape split into two rectangles; the dividing edge is counted too.
    return q(2 * (p["w"] + p["h"]) + (p["w"] - p["cut_w"]))


# G20: Pythagoras


@rule("pythagoras_no_root")
def _no_root(p: Params) -> sympy.Basic:
    return q(p["a"] ** 2 + p["b"] ** 2)


@rule("pythagoras_add_sides")
def _add_sides(p: Params) -> sympy.Basic:
    return q(p["a"] + p["b"])


@rule("pythagoras_subtract_for_hypotenuse")
def _subtract_for_hypotenuse(p: Params) -> sympy.Basic:
    return _rounded(sympy.sqrt(abs(p["a"] ** 2 - p["b"] ** 2)), p)


@rule("pythagoras_add_for_leg")
def _add_for_leg(p: Params) -> sympy.Basic:
    return _rounded(sympy.sqrt(p["c"] ** 2 + p["a"] ** 2), p)


def _triple(rng: random.Random) -> Params:
    a, b, c = rng.choice(PYTHAGOREAN)
    if rng.random() < 0.5:
        a, b = b, a
    return {"a": a, "b": b, "c": c}


def _rotation(rng: random.Random) -> Params:
    return {
        "x": rng.randint(-4, 5),
        "y": rng.randint(-4, 5),
        "cx": rng.randint(-2, 3),
        "cy": rng.randint(-2, 3),
        "clockwise": rng.random() < 0.5,
    }


def _l_shape(rng: random.Random) -> Params:
    w, h = rng.randint(6, 14), rng.randint(6, 14)
    return {"w": w, "h": h, "cut_w": rng.randint(2, w - 2), "cut_h": rng.randint(2, h - 2)}


TEMPLATES = [
    Template(
        id="g3-angles-on-a-line",
        node="G3",
        family="G3.angles-on-a-line",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(25, 155)},
        valid=lambda p: p["a"] != 90,
        stem=lambda p: (
            f"Two angles lie on a straight line. One is ${p['a']}^\\circ$. Work out the size of "
            "the other angle."
        ),
        answer=lambda p: q(180 - p["a"]),
        answer_format=DEGREES,
        diagram=lambda p: {"type": "angles_on_line", "known": [p["a"]]},
        misconceptions={"ANGLES_LINE_SUM_360": "angles_line_sum_360"},
    ),
    Template(
        id="g3-triangle-angles",
        node="G3",
        family="G3.triangle-angles",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(20, 100), "b": r.randint(20, 100)},
        valid=lambda p: p["a"] + p["b"] < 170,
        stem=lambda p: (
            f"Two angles of a triangle are ${p['a']}^\\circ$ and ${p['b']}^\\circ$. "
            "Work out the size of the third angle."
        ),
        answer=lambda p: q(180 - p["a"] - p["b"]),
        answer_format=DEGREES,
        misconceptions={"ANGLES_TRIANGLE_SUM_360": "triangle_sum_360"},
    ),
    Template(
        id="g3-cointerior",
        node="G3",
        family="G3.parallel-line-angles",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"a": r.randint(35, 145)},
        valid=lambda p: p["a"] != 90,
        stem=lambda p: (
            "Two parallel lines are crossed by a third line. Angles $p$ and $q$ both lie "
            "between the parallel lines, on the same side of the crossing line. "
            f"Angle $p$ is ${p['a']}^\\circ$. Work out the size of angle $q$."
        ),
        answer=lambda p: q(180 - p["a"]),
        answer_format=DEGREES,
        diagram=lambda p: {
            "type": "parallel_lines",
            "known": {"p": p["a"]},
            "find": "q",
            "relation": "co-interior",
        },
        misconceptions={"ANGLES_COINTERIOR_EQUAL": "cointerior_as_equal"},
    ),
    Template(
        id="g3-alternate-with-reason",
        node="G3",
        family="G3.angle-reasons",
        command_word="WRITE",
        marks=2,
        calculator=False,
        draw=lambda r: {"a": r.randint(30, 150)},
        valid=lambda p: p["a"] != 90,
        stem=lambda p: (
            f"Two parallel lines are crossed by a third line. Angle $p$ is ${p['a']}^\\circ$ and "
            "angle $q$ is alternate to it. Write down the size of angle $q$."
        ),
        answer=lambda p: q(p["a"]),
        answer_format=DEGREES,
        diagram=lambda p: {
            "type": "parallel_lines",
            "known": {"p": p["a"]},
            "find": "q",
            "relation": "alternate",
        },
    ),
    Template(
        id="g3-polygon-interior-sum",
        node="G3",
        family="G3.polygon-interior-sum",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"n": r.randint(5, 12)},
        stem=lambda p: f"Work out the sum of the interior angles of a polygon with {p['n']} sides.",
        answer=lambda p: q((p["n"] - 2) * 180),
        answer_format=DEGREES,
        misconceptions={"POLYGON_INTERIOR_N_TIMES_180": "polygon_interior_n_times_180"},
    ),
    Template(
        id="g3-vertically-opposite",
        node="G3",
        family="G3.vertically-opposite",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(20, 160)},
        valid=lambda p: p["a"] != 90,
        stem=lambda p: (
            f"Two straight lines cross. One of the angles is ${p['a']}^\\circ$. "
            "Write down the size "
            "of the angle vertically opposite it."
        ),
        answer=lambda p: q(p["a"]),
        answer_format=DEGREES,
        misconceptions={
            "VERTICALLY_OPPOSITE_SUPPLEMENTARY": "vertically_opposite_as_supplementary"
        },
    ),
    Template(
        id="g7-translation",
        node="G7",
        family="G7.translation",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {
            "x": r.randint(-5, 5),
            "y": r.randint(-5, 5),
            "dx": r.choice([n for n in range(-6, 7) if n]),
            "dy": r.choice([n for n in range(-6, 7) if n]),
        },
        valid=lambda p: p["dx"] != p["dy"],
        stem=lambda p: (
            f"The point $({p['x']}, {p['y']})$ is translated by the vector "
            f"$\\begin{{pmatrix}} {p['dx']} \\\\ {p['dy']} \\end{{pmatrix}}$. "
            "Write down the coordinates of its image."
        ),
        answer=lambda p: sympy.Tuple(p["x"] + p["dx"], p["y"] + p["dy"]),
        answer_format=POINT,
        misconceptions={"TRANSLATE_COMPONENTS_SWAPPED": "translate_components_swapped"},
    ),
    Template(
        id="g7-rotation",
        node="G7",
        family="G7.rotation",
        command_word="WRITE",
        marks=2,
        calculator=False,
        draw=_rotation,
        valid=lambda p: (p["x"], p["y"]) != (p["cx"], p["cy"]) and (p["cx"], p["cy"]) != (0, 0),
        stem=lambda p: (
            f"The point $({p['x']}, {p['y']})$ is rotated $90^\\circ$ "
            f"{'clockwise' if p['clockwise'] else 'anticlockwise'} about $({p['cx']}, {p['cy']})$. "
            "Write down the coordinates of its image."
        ),
        answer=lambda p: _rotate(p["x"], p["y"], p["cx"], p["cy"], p["clockwise"]),
        answer_format=POINT,
        misconceptions={
            "ROTATE_ABOUT_ORIGIN": "rotate_about_origin",
            "ROTATE_WRONG_DIRECTION": "rotate_wrong_direction",
        },
    ),
    Template(
        id="g7-reflection-diagonal",
        node="G7",
        family="G7.reflection",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {
            "x": r.randint(-6, 6),
            "y": r.randint(-6, 6),
            "line": r.choice(["y = x", "y = -x"]),
        },
        valid=lambda p: abs(p["x"]) != abs(p["y"]) and p["y"] != 0,
        stem=lambda p: (
            f"The point $({p['x']}, {p['y']})$ is reflected in the line ${p['line']}$. "
            "Write down the coordinates of its image."
        ),
        answer=lambda p: (
            sympy.Tuple(p["y"], p["x"]) if p["line"] == "y = x" else sympy.Tuple(-p["y"], -p["x"])
        ),
        answer_format=POINT,
        misconceptions={"REFLECT_DIAGONAL_AS_AXIS": "reflect_line_as_axis"},
    ),
    Template(
        id="g7-enlargement",
        node="G7",
        family="G7.enlargement",
        command_word="WRITE",
        marks=2,
        calculator=False,
        draw=lambda r: {
            "ax": r.randint(1, 4),
            "ay": r.randint(1, 4),
            "bx": r.randint(1, 5),
            "by": r.randint(1, 5),
            "cx": r.randint(-2, 2),
            "cy": r.randint(-2, 2),
            "k": r.randint(2, 3),
        },
        valid=lambda p: (
            (p["ax"], p["ay"]) != (p["bx"], p["by"])
            and (p["cx"], p["cy"]) not in ((p["ax"], p["ay"]), (p["bx"], p["by"]))
        ),
        stem=lambda p: (
            f"Triangle $T$ has vertices $A({p['ax']}, {p['ay']})$, "
            f"$B({p['bx']}, {p['by']})$ and one "
            f"more. $T$ is enlarged by scale factor ${p['k']}$, centre $({p['cx']}, {p['cy']})$. "
            "Write down the coordinates of the image of $B$."
        ),
        answer=lambda p: sympy.Tuple(
            p["cx"] + p["k"] * (p["bx"] - p["cx"]), p["cy"] + p["k"] * (p["by"] - p["cy"])
        ),
        answer_format=POINT,
        misconceptions={"ENLARGE_FROM_SHAPE": "enlarge_ignore_centre"},
    ),
    Template(
        id="g16-rectangle-area",
        node="G16",
        family="G16.rectangle-area",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"l": r.randint(3, 15), "w": r.randint(2, 12)},
        valid=lambda p: p["l"] != p["w"] and p["l"] * p["w"] != 2 * (p["l"] + p["w"]),
        stem=lambda p: f"A rectangle is {p['l']} cm long and {p['w']} cm wide. Work out its area.",
        answer=lambda p: q(p["l"] * p["w"]),
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"AREA_AS_PERIMETER": "area_as_perimeter"},
    ),
    Template(
        id="g16-triangle-area",
        node="G16",
        family="G16.triangle-area",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"b": r.randint(3, 16), "h": r.randint(2, 14)},
        stem=lambda p: (
            f"A triangle has base {p['b']} cm and perpendicular height {p['h']} cm. "
            "Work out its area."
        ),
        answer=lambda p: q(p["b"] * p["h"], 2),
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"AREA_TRIANGLE_NO_HALF": "triangle_no_half"},
    ),
    Template(
        id="g16-parallelogram-area",
        node="G16",
        family="G16.parallelogram-area",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda b, h: {"b": b, "h": h, "s": h + r.randint(1, 4)})(
            r.randint(4, 15), r.randint(3, 10)
        ),
        stem=lambda p: (
            f"A parallelogram has base {p['b']} cm, sloping sides of {p['s']} cm and perpendicular "
            f"height {p['h']} cm. Work out its area."
        ),
        answer=lambda p: q(p["b"] * p["h"]),
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"AREA_PARALLELOGRAM_SLANT": "parallelogram_slant_height"},
    ),
    Template(
        id="g16-trapezium-area",
        node="G16",
        family="G16.trapezium-area",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"a": r.randint(3, 10), "b": r.randint(5, 16), "h": r.randint(2, 10)},
        valid=lambda p: p["a"] < p["b"],
        stem=lambda p: (
            f"A trapezium has parallel sides of {p['a']} cm and {p['b']} cm. The perpendicular "
            f"distance between them is {p['h']} cm. Work out its area."
        ),
        answer=lambda p: q((p["a"] + p["b"]) * p["h"], 2),
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"AREA_TRAPEZIUM_NO_HALF": "trapezium_no_half"},
    ),
    Template(
        id="g16-area-units",
        node="G16",
        family="G16.area-units",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"m2": r.randint(2, 9)},
        stem=lambda p: f"Change ${p['m2']}\\ \\text{{m}}^2$ into $\\text{{cm}}^2$.",
        answer=lambda p: q(p["m2"] * 10_000),
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"AREA_UNITS_LINEAR_FACTOR": "area_units_linear_factor"},
    ),
    Template(
        id="g17-circle-area",
        node="G17",
        family="G17.circle-area",
        command_word="WORK_OUT",
        marks=2,
        calculator=True,
        draw=lambda r: {"r": r.randint(2, 15), "dp": 1},
        stem=lambda p: (
            f"A circle has radius {p['r']} cm. Work out its area. "
            "Give your answer to 1 decimal place."
        ),
        answer=lambda p: round_half_up(sympy.pi * p["r"] ** 2, 1),
        answer_format=AnswerFormat(form="decimal", dp=1, unit="cm^2"),
        misconceptions={"CIRCLE_AREA_AS_CIRCUMFERENCE": "circle_area_as_circumference"},
    ),
    Template(
        id="g17-circle-area-from-diameter",
        node="G17",
        family="G17.circle-area-from-diameter",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"d": 2 * r.randint(2, 10)},
        stem=lambda p: (
            f"A circle has diameter {p['d']} cm. Work out its area. "
            "Give your answer in terms of $\\pi$."
        ),
        answer=lambda p: sympy.pi * (p["d"] // 2) ** 2,
        answer_format=AnswerFormat(unit="cm^2"),
        misconceptions={"CIRCLE_DIAMETER_AS_RADIUS": "circle_diameter_as_radius"},
    ),
    Template(
        id="g17-circumference-3sf",
        node="G17",
        family="G17.circumference",
        command_word="WORK_OUT",
        marks=2,
        calculator=True,
        draw=lambda r: {"r": r.randint(2, 60)},
        stem=lambda p: (
            f"A circle has radius {p['r']} cm. Work out its circumference. "
            "Give your answer to 3 significant figures."
        ),
        answer=lambda p: round_sf_rational(2 * sympy.pi * p["r"], 3),
        answer_format=AnswerFormat(sf=3, unit="cm"),
    ),
    Template(
        id="g17-composite-perimeter",
        node="G17",
        family="G17.composite-perimeter",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_l_shape,
        stem=lambda p: (
            f"An L-shape is a {p['w']} cm by {p['h']} cm rectangle with a {p['cut_w']} cm by "
            f"{p['cut_h']} cm rectangle cut from one corner. Work out its perimeter."
        ),
        answer=lambda p: q(2 * (p["w"] + p["h"])),
        answer_format=AnswerFormat(unit="cm"),
        diagram=lambda p: {"type": "l_shape", **p},
        misconceptions={"COMPOSITE_PERIMETER_INNER_EDGES": "composite_perimeter_includes_inner"},
    ),
    Template(
        id="g20-hypotenuse",
        node="G20",
        family="G20.pythagoras-hypotenuse",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_triple,
        stem=lambda p: (
            f"A right-angled triangle has shorter sides of {p['a']} cm and {p['b']} cm. "
            "Work out the length of the hypotenuse."
        ),
        answer=lambda p: q(p["c"]),
        answer_format=AnswerFormat(unit="cm"),
        misconceptions={
            "PYTH_NO_SQUARE_ROOT": "pythagoras_no_root",
            "PYTH_ADD_SIDES": "pythagoras_add_sides",
            "PYTH_WRONG_HYPOTENUSE": "pythagoras_subtract_for_hypotenuse",
        },
    ),
    Template(
        id="g20-hypotenuse-decimal",
        node="G20",
        family="G20.pythagoras-hypotenuse",
        command_word="WORK_OUT",
        marks=3,
        calculator=True,
        draw=lambda r: {"a": r.randint(3, 15), "b": r.randint(3, 15), "dp": 1},
        valid=lambda p: p["a"] != p["b"] and not sympy.sqrt(p["a"] ** 2 + p["b"] ** 2).is_Integer,
        stem=lambda p: (
            f"A right-angled triangle has shorter sides of {p['a']} cm and {p['b']} cm. "
            "Work out the length of the hypotenuse. Give your answer to 1 decimal place."
        ),
        answer=lambda p: round_half_up(sympy.sqrt(p["a"] ** 2 + p["b"] ** 2), 1),
        answer_format=AnswerFormat(form="decimal", dp=1, unit="cm"),
        misconceptions={
            "PYTH_ADD_SIDES": "pythagoras_add_sides",
            "PYTH_WRONG_HYPOTENUSE": "pythagoras_subtract_for_hypotenuse",
        },
    ),
    Template(
        id="g20-shorter-side",
        node="G20",
        family="G20.pythagoras-shorter-side",
        command_word="WORK_OUT",
        marks=3,
        calculator=True,
        draw=_triple,
        stem=lambda p: (
            f"A right-angled triangle has hypotenuse {p['c']} cm and one shorter side of "
            f"{p['a']} cm. Work out the length of the other side."
        ),
        answer=lambda p: q(p["b"]),
        answer_format=AnswerFormat(unit="cm"),
        misconceptions={"PYTH_ADD_FOR_SHORTER_SIDE": "pythagoras_add_for_leg"},
    ),
]
