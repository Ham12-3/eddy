"""Equivalence, answer formats, step checking and claim verification."""

from typing import Any

import pytest
import sympy
from hypothesis import given, settings
from hypothesis import strategies as st

from eddy_maths_core.equivalence import equivalent, numerically_zero
from eddy_maths_core.formats import AnswerFormat, check_format, round_sf
from eddy_maths_core.items import TEMPLATES
from eddy_maths_core.mathjson import read_response, to_sympy
from eddy_maths_core.serialize import answer_mathjson, to_mathjson
from eddy_maths_core.verify import check_answer, check_steps, stem_values, verify_claims

x, y = sympy.symbols("x y")


@pytest.mark.parametrize(
    ("a", "b", "same"),
    [
        (["Divide", 1, 2], 0.5, True),
        (["Divide", 1, 3], 0.333, False),
        (["Multiply", 2, ["Add", "x", 3]], ["Add", ["Multiply", 2, "x"], 6], True),
        (["Power", ["Add", "x", 1], 2], ["Add", ["Power", "x", 2], 1], False),
        (
            ["Divide", ["Subtract", ["Power", "x", 2], 1], ["Subtract", "x", 1]],
            ["Add", "x", 1],
            True,
        ),
        (["Sqrt", 8], ["Multiply", 2, ["Sqrt", 2]], True),
        (["Equal", ["Add", ["Multiply", 2, "x"], 3], 11], ["Equal", "x", 4], True),
        (["Equal", "x", 4], ["Equal", "x", 5], False),
        (
            ["Equal", "y", ["Add", ["Multiply", 2, "x"], 1]],
            ["Equal", ["Multiply", 2, "y"], ["Add", ["Multiply", 4, "x"], 2]],
            True,
        ),
        (["Tuple", 2, 3], ["Tuple", 3, 2], False),
        (["Equal", "x", 4], 4, False),
    ],
)
def test_equivalence(a: Any, b: Any, same: bool) -> None:
    assert equivalent(to_sympy(a), to_sympy(b)) is same


def test_ratios_compare_by_proportion() -> None:
    assert equivalent(sympy.Tuple(2, 3), sympy.Tuple(4, 6), ratio=True)
    assert not equivalent(sympy.Tuple(2, 3), sympy.Tuple(3, 2), ratio=True)


def test_sampling_avoids_singularities() -> None:
    assert numerically_zero((x**2 - 1) / (x - 1) - (x + 1))
    assert not numerically_zero(1 / x)


small = st.integers(min_value=-50, max_value=50)


@settings(max_examples=150, deadline=None)
@given(small, small, small)
def test_expanded_and_factorised_forms_agree(a: int, b: int, c: int) -> None:
    factorised = a * (x + b) * (x - c)
    assert equivalent(factorised, sympy.expand(factorised))
    assert equivalent(factorised + 1, sympy.expand(factorised)) is False


@settings(max_examples=150, deadline=None)
@given(st.integers(-(10**6), 10**6), st.integers(1, 10**4))
def test_written_values_round_trip(p: int, q: int) -> None:
    value = sympy.Rational(p, q)
    assert to_sympy(to_mathjson(value)) == value


@pytest.mark.parametrize(
    ("written", "fmt", "codes"),
    [
        ({"num": "0.50"}, AnswerFormat(dp=2), []),
        ({"num": "0.5"}, AnswerFormat(dp=2), ["dp"]),
        (["Rational", 4, 8], AnswerFormat(form="fraction", simplest=True), ["simplest"]),
        (0.5, AnswerFormat(form="fraction"), ["form_fraction"]),
        (["Multiply", 4.1, ["Power", 10, 7]], AnswerFormat(form="standard_form"), []),
        (["Multiply", 41, ["Power", 10, 6]], AnswerFormat(form="standard_form"), ["form_standard"]),
        (["Multiply", 12, "m"], AnswerFormat(unit="cm"), ["unit_wrong"]),
        (12, AnswerFormat(unit="cm"), []),
        (12, AnswerFormat(unit="cm", require_unit=True), ["unit_missing"]),
        (["Percent", 40], AnswerFormat(unit="%"), []),
        (["Ratio", 4, 6], AnswerFormat(kind="ratio", simplest=True), ["simplest"]),
    ],
)
def test_format_rules(written: Any, fmt: AnswerFormat, codes: list[str]) -> None:
    response = read_response(written)
    assert [i.code for i in check_format(written, response.value, response.unit, fmt)] == codes


def test_significant_figures_round_half_up() -> None:
    assert str(round_sf(sympy.Rational(12345, 1000), 3)) == "12.3"
    assert str(round_sf(sympy.Rational(125, 100), 2)) == "1.3"


def test_check_answer_accepts_x_equals() -> None:
    item = TEMPLATES["a17-two-step"].generate(3)
    assert check_answer(item, ["Equal", "x", to_mathjson(item.answer)]).correct
    assert check_answer(item, ["Equal", to_mathjson(item.answer), "x"]).correct


def test_check_answer_reports_unreadable_input_safely() -> None:
    item = TEMPLATES["a17-two-step"].generate(3)
    result = check_answer(item, ["Error", "'missing'"])
    assert not result.correct
    assert result.unreadable
    assert str(item.answer) not in result.unreadable


def test_structure_rule_spots_standard_form_not_normalised() -> None:
    item = TEMPLATES["n9-ordinary-to-standard"].generate(2)
    mantissa, power = sympy.Rational(item.params["m"]) * 10, item.params["k"] - 1
    written = [
        "Multiply",
        int(mantissa) if mantissa.is_integer else float(mantissa),
        ["Power", 10, power],
    ]
    result = check_answer(item, written)
    assert result.equivalent
    assert not result.correct
    assert result.misconceptions == ["SF_NOT_NORMALISED"]


def test_probability_over_one_only_when_no_rule_explains_it() -> None:
    item = TEMPLATES["p8-tree-and"].generate(3)
    added = to_mathjson(next(d.value for d in item.distractors))
    assert check_answer(item, ["Divide", 9, 5]).misconceptions == ["PROBABILITY_OVER_ONE"]
    assert "PROBABILITY_OVER_ONE" not in check_answer(item, added).misconceptions


def test_rounded_distractors_match_the_students_rounding() -> None:
    item = TEMPLATES["g20-hypotenuse"].generate(0)
    a, b = item.params["a"], item.params["b"]
    rounded = round(float(sympy.sqrt(abs(a**2 - b**2))), 1)
    assert "PYTH_WRONG_HYPOTENUSE" in check_answer(item, rounded).misconceptions


def test_steps() -> None:
    good = [
        ["Equal", ["Add", ["Multiply", 2, "x"], 3], 11],
        ["Equal", ["Multiply", 2, "x"], 8],
        ["Equal", "x", 4],
    ]
    assert check_steps(good).valid
    bad = [good[0], ["Equal", ["Multiply", 2, "x"], 14], ["Equal", "x", 7]]
    assert check_steps(bad).first_invalid == 1
    assert check_steps([good[0], ["Foo"]]).unreadable
    assert not check_steps([good[0], ["Add", "x", 1]]).valid


def test_claims_and_answer_leaks() -> None:
    item = TEMPLATES["a17-two-step"].generate(3)
    results = verify_claims(
        [
            ("claim", ["Equal", ["Add", 3, 4], 7]),
            ("claim", ["Equal", ["Multiply", 3, 4], 7]),
            ("claim", ["Less", 2, 3]),
            ("claim", ["Add", 1, 1]),
            ("given", ["Equal", "x", to_mathjson(item.answer)]),
            ("step", ["Equal", ["Multiply", 2, "x"], 8]),
            ("step", ["Equal", "x", 4]),
            ("given", ["Foo"]),
        ],
        item,
    )
    assert [r.verified for r in results] == [True, False, True, False, True, True, True, False]
    assert results[4].leaks_answer
    assert not results[0].leaks_answer


def test_answers_are_written_in_the_asked_form() -> None:
    assert answer_mathjson(sympy.Rational(7, 10), AnswerFormat(form="decimal")) == {"num": "0.7"}
    assert answer_mathjson(sympy.Rational(1, 3), AnswerFormat(dp=2)) == {"num": "0.33"}
    assert answer_mathjson(sympy.Integer(41_000_000), AnswerFormat(form="standard_form")) == [
        "Multiply",
        {"num": "4.1"},
        ["Power", 10, 7],
    ]
    assert answer_mathjson(sympy.Rational(5, 2), AnswerFormat(form="mixed_number")) == [
        "InvisibleOperator",
        2,
        ["Rational", 1, 2],
    ]


@pytest.mark.parametrize(
    ("written", "codes"),
    [
        (["InvisibleOperator", 2, ["Rational", 1, 2]], []),
        (["InvisibleOperator", 2, ["Rational", 2, 4]], ["simplest"]),  # 2 2/4
        (["InvisibleOperator", 1, ["Rational", 6, 4]], ["form_mixed"]),  # 1 6/4
        (["Add", 1, ["Rational", 3, 2]], ["form_mixed"]),
        (["Rational", 5, 2], ["form_mixed"]),
    ],
)
def test_mixed_numbers_need_a_proper_fraction(written: Any, codes: list[str]) -> None:
    fmt = AnswerFormat(form="mixed_number", simplest=True)
    response = read_response(written)
    assert [i.code for i in check_format(written, response.value, response.unit, fmt)] == codes


def test_exact_answers_refuse_rounded_decimals() -> None:
    fmt = AnswerFormat(form="exact")
    for written, codes in (
        (["Multiply", 25, "Pi"], []),
        ({"num": "78.54"}, ["form_exact"]),
        (["Multiply", 78.539816, 1], ["form_exact"]),
    ):
        response = read_response(written)
        assert [i.code for i in check_format(written, response.value, response.unit, fmt)] == codes


def test_significant_figures_format() -> None:
    fmt = AnswerFormat(sf=3)
    for written, codes in (({"num": "31.4"}, []), ({"num": "31.42"}, ["sf"]), (31, [])):
        response = read_response(written)
        assert [i.code for i in check_format(written, response.value, response.unit, fmt)] == codes


def test_a_percentage_is_not_an_amount() -> None:
    item = TEMPLATES["n12-percentage-of-amount"].generate(1)
    result = check_answer(item, ["Percent", to_mathjson(item.answer)])
    assert result.equivalent
    assert [i.code for i in result.format_issues] == ["unit_wrong"]


def test_numbers_should_arrive_as_typed() -> None:
    """Clients send numbers as {"num": "<as typed>"}: a JSON float loses trailing zeros."""
    fmt = AnswerFormat(dp=2)
    typed = read_response({"num": "3.10"})
    assert check_format({"num": "3.10"}, typed.value, None, fmt) == []
    as_float = read_response(3.10)
    assert [i.code for i in check_format(3.10, as_float.value, None, fmt)] == ["dp"]


def test_equations_need_the_same_unknowns() -> None:
    assert not equivalent(sympy.Eq(x, 3), sympy.Eq(y, 3))
    assert not equivalent(sympy.Tuple(2, 3), sympy.Tuple(-2, -3), ratio=True)


def test_high_degree_equations_compare_without_solving() -> None:
    import time

    high = sympy.Eq(x**9 + 3 * x, 7)
    start = time.perf_counter()
    assert equivalent(high, sympy.Eq(2 * x**9 + 6 * x, 14))
    assert not equivalent(high, sympy.Eq(x**9 + 3 * x, 8))
    assert time.perf_counter() - start < 1.0


def test_a_numeric_statement_must_be_true_whatever_its_role() -> None:
    results = verify_claims([("given", ["Equal", ["Add", 2, 2], 5])])
    assert not results[0].verified


def test_restating_the_question_is_not_a_leak_but_the_asked_form_is() -> None:
    item = TEMPLATES["n10-fraction-to-decimal"].generate(1)
    n, d = item.params["n"], item.params["d"]
    given, answer = verify_claims(
        [
            ("given", ["Rational", n, d]),
            ("claim", answer_mathjson(item.answer, item.answer_format)),
        ],
        item,
    )
    assert not given.leaks_answer
    assert answer.leaks_answer


def test_naming_a_choice_counts_as_a_leak() -> None:
    item = TEMPLATES["n1-order-negatives"].generate(1)
    a, b = item.params["a"], item.params["b"]
    (result,) = verify_claims([("given", ["Less", -max(a, b), -min(a, b)])], item)
    assert result.leaks_answer


def test_rational_values_compare_exactly() -> None:
    assert not equivalent(to_sympy({"num": "10.0000000001"}), sympy.Integer(10))
    assert not equivalent(x + 1, x + 1 + x / 10**12)


def test_givens_and_first_steps_are_checked_against_the_answer() -> None:
    item = TEMPLATES["a17-two-step"].generate(3)  # answer 4
    false_given, wrong_step, true_given = verify_claims(
        [
            ("given", ["Equal", ["Multiply", 2, "x"], ["Add", ["Multiply", 2, "x"], 1]]),
            ("step", ["Equal", ["Multiply", 3, "x"], 7]),
            ("given", ["Equal", ["Multiply", 2, "x"], 8]),
        ],
        item,
    )
    assert not false_given.verified
    assert not wrong_step.verified
    assert true_given.verified
    (alone,) = verify_claims([("given", ["Equal", ["Multiply", 2, "x"], 8])])
    assert not alone.verified  # no question to check it against


@pytest.mark.parametrize(
    ("template_id", "statement"),
    [
        ("a17-one-step-add", lambda answer: ["Equal", ["Subtract", "x", answer], 0]),
        ("a17-one-step-add", lambda answer: ["Equal", ["Add", "x", 1], ["Add", answer, 1]]),
        ("g17-circle-area", lambda answer: ["Multiply", 999, "Pi"]),  # replaced below
    ],
)
def test_answer_leak_bypasses_are_caught(template_id: str, statement: Any) -> None:
    item = TEMPLATES[template_id].generate(2)
    if template_id == "g17-circle-area":
        radius = item.params["r"]
        written: Any = ["Multiply", radius * radius, "Pi"]
    else:
        written = statement(to_mathjson(item.answer))
    (result,) = verify_claims([("claim", written)], item)
    assert result.leaks_answer, (item.stem, written)


def test_a_coordinate_component_is_a_leak() -> None:
    item = TEMPLATES["g7-translation"].generate(4)
    x_part = item.answer[0]
    (result,) = verify_claims([("given", ["Equal", "x", to_mathjson(x_part)])], item)
    assert result.leaks_answer or any(x_part == value for value in stem_values(item))
