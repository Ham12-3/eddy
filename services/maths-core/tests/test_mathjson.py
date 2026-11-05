"""The MathJSON converter: what it accepts, what it refuses, and that it never runs input."""

import ast
import time
from pathlib import Path
from typing import Any

import pytest
import sympy
from hypothesis import given, settings
from hypothesis import strategies as st

from eddy_maths_core.items import TEMPLATES
from eddy_maths_core.mathjson import (
    MAX_DEPTH,
    MAX_NODES,
    MathJsonError,
    read_response,
    split_unit,
    to_sympy,
)
from eddy_maths_core.verify import check_answer, check_steps, verify_claims

SOURCE = Path(__file__).resolve().parents[1] / "src" / "eddy_maths_core"
x = sympy.Symbol("x")


@pytest.mark.parametrize(
    ("node", "expected"),
    [
        (3, sympy.Integer(3)),
        (0.1, sympy.Rational(1, 10)),
        ({"num": "0.125"}, sympy.Rational(1, 8)),
        ({"num": "0.(3)"}, sympy.Rational(1, 3)),
        ({"num": "1.2(36)"}, sympy.Rational(68, 55)),
        ({"num": "-2.5e3"}, sympy.Integer(-2500)),
        (["Add", "x", 1], x + 1),
        (["Subtract", 5, ["Negate", 3]], sympy.Integer(8)),
        (["Divide", 1, 3], sympy.Rational(1, 3)),
        (["Rational", 2, 4], sympy.Rational(1, 2)),
        (["InvisibleOperator", 2, ["Divide", 1, 2]], sympy.Rational(5, 2)),
        (["InvisibleOperator", 2, "x"], 2 * x),
        (["Power", 10, -3], sympy.Rational(1, 1000)),
        (["Square", 3], sympy.Integer(9)),
        (["Sqrt", 8], 2 * sympy.sqrt(2)),
        (["Root", 27, 3], sympy.Integer(3)),
        (["Abs", -4], sympy.Integer(4)),
        (["Percent", 15], sympy.Rational(3, 20)),
        (["Degrees", 30], sympy.Integer(30)),
        (["Multiply", 2, "Pi"], 2 * sympy.pi),
        ("Half", sympy.Rational(1, 2)),
        (["Delimiter", ["Add", "x", 1]], x + 1),
        (["Delimiter", ["Sequence", 2, 3], "'(,)'"], sympy.Tuple(2, 3)),
        (["Ratio", 2, 3], sympy.Tuple(2, 3)),
        (["Equal", ["Add", ["Multiply", 2, "x"], 3], 11], sympy.Eq(2 * x + 3, 11)),
    ],
)
def test_converts(node: Any, expected: sympy.Basic) -> None:
    assert to_sympy(node) == expected


@pytest.mark.parametrize(
    ("node", "reason"),
    [
        (["Divide", 1, 0], "divides by zero"),
        (["Power", 10, 1000], "too large"),
        ({"num": "1e999"}, "too large"),
        (10**60, "too large"),
        (["Error", "'missing'"], "could not be read"),
        (["Foo", 1], "cannot check yet"),
        (["Root", 8, 50], "small roots"),
        ("cm", "after the number"),
        ("eval", "symbol"),
        ("__import__", "symbol"),
        (["InvisibleOperator", 2, 3], "operation between"),
        (True, "could not be read"),
        (None, "could not be read"),
        ([], "could not be read"),
        ({"num": "1+1"}, "could not be read"),
        ({"str": "x"}, "could not be read"),
        (["Add"], "could not be read"),
        (["Divide", 1], "could not be read"),
        (["Add", *([1] * 40)], "too many parts"),
    ],
)
def test_refuses(node: Any, reason: str) -> None:
    with pytest.raises(MathJsonError, match=reason):
        to_sympy(node)


def test_depth_and_size_limits() -> None:
    deep: Any = 1
    for _ in range(MAX_DEPTH + 1):
        deep = ["Negate", deep]
    with pytest.raises(MathJsonError, match="nested too deeply"):
        to_sympy(deep)
    wide: Any = 1
    for _ in range(MAX_NODES // 3):
        wide = ["Add", wide, ["Add", 1, 1]]
    with pytest.raises(MathJsonError):
        to_sympy(wide)


def test_units_are_split_off_the_end() -> None:
    assert split_unit(["Multiply", 5, "cm"]) == (5, "cm")
    assert split_unit(["Multiply", 12, ["Power", "cm", 2]]) == (12, "cm^2")
    assert split_unit(["Multiply", 2, "x"]) == (["Multiply", 2, "x"], None)
    assert read_response(["Percent", 40]).unit == "%"
    assert read_response(["Percent", 40]).value == 40


def test_no_code_path_parses_or_runs_text() -> None:
    """No eval, exec, sympify, parse_expr or S("...") anywhere in maths-core."""
    builtins = {"eval", "exec", "compile", "__import__"}
    sympy_parsers = {"sympify", "parse_expr", "S", "lambdify", "parse_latex"}
    for path in SOURCE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Name):
                assert node.func.id not in builtins | sympy_parsers, f"{path.name}:{node.lineno}"
            elif isinstance(node.func, ast.Attribute):
                assert node.func.attr not in sympy_parsers, f"{path.name}:{node.lineno}"


HEADS = [
    "Add",
    "Multiply",
    "Subtract",
    "Negate",
    "Divide",
    "Rational",
    "Power",
    "Square",
    "Sqrt",
    "Root",
    "Abs",
    "Percent",
    "Degrees",
    "Delimiter",
    "Sequence",
    "Tuple",
    "Ratio",
    "Equal",
    "Less",
    "InvisibleOperator",
    "Error",
    "Hold",
    "Apply",
    "Function",
    "Assign",
]
leaves = st.one_of(
    st.integers(min_value=-(10**50), max_value=10**50),
    st.floats(allow_nan=True, allow_infinity=True),
    st.sampled_from(["x", "y", "Pi", "Half", "cm", "theta", "ExponentialE", "'text'", "", "os"]),
    st.text(max_size=8),
    st.builds(lambda s: {"num": s}, st.text(max_size=12)),
    st.none(),
    st.booleans(),
)
trees = st.recursive(
    leaves,
    lambda children: st.one_of(
        st.lists(children, max_size=5).map(lambda args: args),
        st.tuples(st.sampled_from(HEADS), st.lists(children, max_size=4)).map(
            lambda pair: [pair[0], *pair[1]]
        ),
        st.dictionaries(st.sampled_from(["num", "sym", "fn", "str"]), children, max_size=2),
    ),
    max_leaves=60,
)


@settings(max_examples=1500, deadline=None)
@given(trees)
def test_fuzz_never_crashes(node: Any) -> None:
    """Any JSON at all: a SymPy value or a MathJsonError, never anything else, and fast."""
    start = time.perf_counter()
    try:
        value = to_sympy(node)
    except MathJsonError:
        pass
    else:
        assert isinstance(value, sympy.Basic)
    assert time.perf_counter() - start < 2.0


# Valid-looking maths, nested deep, to hunt for slow paths: powers of powers, squares of
# squares, recurring decimals and roots of negatives.
maths_leaves = st.one_of(
    st.integers(min_value=-12, max_value=12),
    st.sampled_from(["x", "y", {"num": "0.(3)"}, {"num": "1.25"}, 2.5]),
)
maths_trees = st.recursive(
    maths_leaves,
    lambda children: st.one_of(
        st.tuples(st.sampled_from(["Power", "Root"]), children, st.integers(-8, 64)).map(list),
        st.tuples(st.sampled_from(["Square", "Sqrt", "Negate"]), children).map(list),
        st.tuples(
            st.sampled_from(["Add", "Multiply", "Divide", "Equal", "Less"]), children, children
        ).map(list),
    ),
    max_leaves=40,
)
ITEMS = [
    TEMPLATES[name].generate(3) for name in ("a17-two-step", "p8-tree-and", "n10-thirds-to-decimal")
]


@settings(max_examples=400, deadline=None)
@given(maths_trees)
def test_every_verification_path_is_safe_and_fast(node: Any) -> None:
    """Answer checks, step checks and claims: a verdict, never an exception, and quickly."""
    for item in ITEMS:
        start = time.perf_counter()
        check_answer(item, node)
        check_steps([node, node])
        check_steps([["Equal", "x", 1], node])
        verify_claims([("claim", node), ("given", node), ("step", node)], item)
        assert time.perf_counter() - start < 3.0, node


def _nested_powers(levels: int) -> Any:
    node: Any = 2
    for _ in range(levels):
        node = ["Power", node, 4]
    return node


@pytest.mark.parametrize(
    ("node", "reason"),
    [
        (["Sqrt", -4], "no real value"),
        (_nested_powers(8), "too large"),  # 2^(4^8): took seconds before the limit
        (["Power", ["Add", "x", 1], 13], "too high"),
        (["Power", ["Power", ["Add", "x", 1], 4], 4], "too high"),
    ],
)
def test_refuses_expensive_or_unreal_maths(node: Any, reason: str) -> None:
    with pytest.raises(MathJsonError, match=reason):
        to_sympy(node)


def test_a_recurring_decimal_answer_is_judged_not_crashed() -> None:
    item = TEMPLATES["n10-thirds-to-decimal"].generate(1)
    result = check_answer(item, {"num": "0.(3)"})
    assert result.unreadable is None
    assert not result.correct


@pytest.mark.parametrize(
    ("node", "reason"),
    [
        (["Power", 10, ["Multiply", 10**30, "x"]], "powers that are numbers"),
        (["Power", "x", ["Power", "x", 12]], "powers that are numbers"),
        (["Add", "a", "b", "c", "d"], "more letters"),
        (["Add", *(["Sqrt", ["Add", "x", n]] for n in range(5))], "more roots"),
        ("x\n", "symbol"),
        ({"num": chr(0xFF11) + chr(0xFF12)}, "could not be read"),  # fullwidth digits
        (["InvisibleOperator", 10**60, ["Divide", 1, 2]], "too large"),
        (["Tuple", ["Tuple", 1, 2], 3], "could not be read"),
        (["Tuple", ["Equal", "x", 1], 3], "could not be read"),
    ],
)
def test_refuses_what_the_security_review_found(node: Any, reason: str) -> None:
    with pytest.raises(MathJsonError, match=reason):
        to_sympy(node)


symbolic_powers = st.recursive(
    maths_leaves,
    lambda children: st.tuples(st.just("Power"), children, children).map(list),
    max_leaves=12,
)


@settings(max_examples=200, deadline=None)
@given(symbolic_powers)
def test_powers_with_any_exponent_are_quick(node: Any) -> None:
    start = time.perf_counter()
    for item in ITEMS:
        check_answer(item, node)
    assert time.perf_counter() - start < 3.0, node
