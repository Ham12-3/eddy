"""Number: N1, N2, N9, N10, N11 and N12 templates, and their misconception rules."""

import random
from math import gcd

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.base import Template
from eddy_maths_core.items.text import money, round_half_up, tex
from eddy_maths_core.rules import Params, dec, q, rule

FRACTION = AnswerFormat(form="fraction", simplest=True)
DECIMAL = AnswerFormat(form="decimal")
PERCENT = AnswerFormat(unit="%")


def _proper(rng: random.Random, low: int = 2, high: int = 12) -> tuple[int, int]:
    d = rng.randint(low, high)
    n = rng.randint(1, d - 1)
    g = gcd(n, d)
    return n // g, d // g


# N1: ordering


@rule("neg_compare_by_magnitude")
def _neg_compare(p: Params) -> sympy.Basic:
    return -q(min(p["a"], p["b"]))


@rule("decimal_compare_by_length")
def _decimal_longer(p: Params) -> sympy.Basic:
    return dec(p["long"])


@rule("decimal_compare_shorter_bigger")
def _decimal_shorter(p: Params) -> sympy.Basic:
    return dec(p["short"])


@rule("unit_fraction_compare_by_denominator")
def _unit_fraction(p: Params) -> sympy.Basic:
    return q(1, max(p["a"], p["b"]))


def _two_decimals(rng: random.Random) -> Params:
    short = f"0.{rng.randint(1, 9)}"
    long = f"0.{rng.randint(1, 9)}{rng.randint(0, 9)}{rng.randint(1, 9)}"
    return {"short": short, "long": long}


# N2: the four operations


@rule("neg_add_sign_rule_overapplied")
def _neg_add(p: Params) -> sympy.Basic:
    return q(p["a"] + p["b"])


@rule("neg_sub_negative_as_sub")
def _neg_sub(p: Params) -> sympy.Basic:
    return q(p["a"] - p["b"])


@rule("neg_mult_sign_negative")
def _neg_mult(p: Params) -> sympy.Basic:
    return -q(p["a"] * p["b"])


@rule("frac_add_num_den")
def _frac_add(p: Params) -> sympy.Basic:
    return q(p["a"] + p["c"], p["b"] + p["d"])


@rule("frac_sub_num_den")
def _frac_sub(p: Params) -> sympy.Basic | None:
    if p["b"] == p["d"]:
        return None
    return q(p["a"] - p["c"], p["b"] - p["d"])


@rule("frac_div_flip_first")
def _frac_div(p: Params) -> sympy.Basic:
    return q(p["b"], p["a"]) * q(p["c"], p["d"])


@rule("decimal_add_right_aligned")
def _decimal_right_aligned(p: Params) -> sympy.Basic:
    # The shorter decimal's digits are lined up under the longer one's last digits.
    places = len(p["long"].partition(".")[2])
    misread = q(int(p["short"].replace(".", "")), 10**places)
    return misread + dec(p["long"])


@rule("decimal_mult_point_count_wrong")
def _decimal_mult(p: Params) -> sympy.Basic:
    # One decimal place in the answer instead of two: 0.3 x 0.2 = 0.6.
    return q(p["a"] * p["b"], 10)


@rule("mixed_mult_whole_only")
def _mixed_whole_only(p: Params) -> sympy.Basic:
    return q(p["w"] * p["k"]) + q(p["n"], p["d"])


@rule("left_to_right_evaluation")
def _left_to_right(p: Params) -> sympy.Basic:
    return q((p["a"] + p["b"]) * p["c"])


# N9: standard form


@rule("sf_negative_power_wrong_direction")
def _sf_direction(p: Params) -> sympy.Basic | None:
    if p["k"] >= 0:
        return None
    return dec(p["m"]) * q(10) ** (-p["k"])


@rule("sf_power_applied_to_mantissa")
def _sf_on_mantissa(p: Params) -> sympy.Basic:
    return dec(p["m"]) ** p["k"]


@rule("sf_power_counts_zeros")
def _sf_counts_zeros(p: Params) -> sympy.Basic:
    ordinary = dec(p["m"]) * q(10) ** p["k"]
    text = str(int(ordinary))
    zeros = len(text) - len(text.rstrip("0"))
    return dec(p["m"]) * q(10) ** zeros


@rule("sf_multiply_powers")
def _sf_multiply_powers(p: Params) -> sympy.Basic:
    return q(p["a"] * p["b"]) * q(10) ** (p["m"] * p["n"])


# N10: fractions, decimals and percentages


@rule("fdp_third_point_three")
def _third(p: Params) -> sympy.Basic | None:
    # One third read as 0.3, so two thirds as 0.6.
    return q(3 * p["n"], 10) if p["d"] == 3 else None


@rule("fdp_denominator_as_decimal")
def _denominator_decimal(p: Params) -> sympy.Basic | None:
    # 1/3 is FDP_THIRD_AS_POINT_THREE's slip, and 1/10 gives the right answer.
    if p["n"] != 1 or p["d"] in (3, 10):
        return None
    return q(p["d"], 10 ** len(str(p["d"])))


@rule("fdp_percent_digits_only")
def _percent_digits(p: Params) -> sympy.Basic:
    return q(int(p["x"].partition(".")[2]))


@rule("fdp_concatenate")
def _concatenate(p: Params) -> sympy.Basic:
    return q(int(f"{p['n']}{p['d']}"))


# N11, R6: a ratio as a fraction


@rule("ratio_part_over_other_part")
def _part_over_part(p: Params) -> sympy.Basic:
    return q(p["a"], p["b"])


# N12: fractions and percentages as operators


@rule("frac_of_amount_divide_only")
def _divide_only(p: Params) -> sympy.Basic | None:
    if p["n"] == 1:
        return None
    return q(p["amount"], p["d"])


@rule("pct_divide_by_percent")
def _divide_by_percent(p: Params) -> sympy.Basic:
    value = dec(str(p["amount"])) / dec(str(p["pct"]))
    places = p.get("dp")
    return round_half_up(value, places) if places else value


def _fraction_of_amount(rng: random.Random) -> Params:
    n, d = _proper(rng, 3, 9)
    return {"n": n, "d": d, "amount": d * rng.randint(2, 12)}


def _sf_mantissa(rng: random.Random) -> str:
    return f"{rng.randint(1, 9)}.{rng.randint(1, 9)}"


TEMPLATES = [
    Template(
        id="n1-order-negatives",
        node="N1",
        family="N1.order-negatives",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), r.sample(range(2, 15), 2), strict=True)),
        stem=lambda p: f"Which is smaller: ${-p['a']}$ or ${-p['b']}$?",
        answer=lambda p: -q(max(p["a"], p["b"])),
        choice=True,
        misconceptions={"NEG_ORDER_BY_DIGIT": "neg_compare_by_magnitude"},
    ),
    Template(
        id="n1-order-decimals",
        node="N1",
        family="N1.order-decimals",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=_two_decimals,
        valid=lambda p: dec(p["short"]) != dec(p["long"]),
        stem=lambda p: f"Which is larger: ${p['short']}$ or ${p['long']}$?",
        answer=lambda p: max(dec(p["short"]), dec(p["long"])),
        answer_format=DECIMAL,
        choice=True,
        misconceptions={
            "DEC_LONGER_IS_BIGGER": "decimal_compare_by_length",
            "DEC_SHORTER_IS_BIGGER": "decimal_compare_shorter_bigger",
        },
    ),
    Template(
        id="n1-order-unit-fractions",
        node="N1",
        family="N1.order-fractions",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), r.sample(range(2, 13), 2), strict=True)),
        stem=lambda p: f"Which is larger: $\\frac{{1}}{{{p['a']}}}$ or $\\frac{{1}}{{{p['b']}}}$?",
        answer=lambda p: q(1, min(p["a"], p["b"])),
        answer_format=AnswerFormat(form="fraction"),
        choice=True,
        misconceptions={"UNIT_FRACTION_BIGGER_DENOMINATOR": "unit_fraction_compare_by_denominator"},
    ),
    Template(
        id="n2-add-negatives",
        node="N2",
        family="N2.add-negatives",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 15), "b": r.randint(2, 15)},
        stem=lambda p: f"Work out ${-p['a']} + ({-p['b']})$.",
        answer=lambda p: -q(p["a"] + p["b"]),
        misconceptions={"NEG_TWO_NEGATIVES_ADD_POSITIVE": "neg_add_sign_rule_overapplied"},
    ),
    Template(
        id="n2-subtract-negatives",
        node="N2",
        family="N2.subtract-negatives",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 15), "b": r.randint(2, 15)},
        stem=lambda p: f"Work out ${p['a']} - ({-p['b']})$.",
        answer=lambda p: q(p["a"] + p["b"]),
        misconceptions={"NEG_SUBTRACT_NEGATIVE": "neg_sub_negative_as_sub"},
    ),
    Template(
        id="n2-multiply-negatives",
        node="N2",
        family="N2.multiply-negatives",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 12), "b": r.randint(2, 12)},
        stem=lambda p: f"Work out $({-p['a']}) \\times ({-p['b']})$.",
        answer=lambda p: q(p["a"] * p["b"]),
        misconceptions={"NEG_MULTIPLY_SIGN": "neg_mult_sign_negative"},
    ),
    Template(
        id="n2-fraction-add-unlike",
        node="N2",
        family="N2.fraction-add-unlike",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (
            dict(zip(("a", "b"), _proper(r, 2, 9), strict=True))
            | dict(zip(("c", "d"), _proper(r, 2, 9), strict=True))
        ),
        valid=lambda p: p["b"] != p["d"] and q(p["a"], p["b"]) + q(p["c"], p["d"]) < 1,
        stem=lambda p: (
            f"Work out $\\frac{{{p['a']}}}{{{p['b']}}} + \\frac{{{p['c']}}}{{{p['d']}}}$. "
            "Give your answer as a fraction in its simplest form."
        ),
        answer=lambda p: q(p["a"], p["b"]) + q(p["c"], p["d"]),
        answer_format=FRACTION,
        misconceptions={"FRAC_ADD_NUM_DEN": "frac_add_num_den"},
    ),
    Template(
        id="n2-fraction-subtract-unlike",
        node="N2",
        family="N2.fraction-subtract-unlike",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (
            dict(zip(("a", "b"), _proper(r, 2, 9), strict=True))
            | dict(zip(("c", "d"), _proper(r, 2, 9), strict=True))
        ),
        valid=lambda p: (
            p["a"] > p["c"] and p["b"] > p["d"] and q(p["a"], p["b"]) > q(p["c"], p["d"])
        ),
        stem=lambda p: (
            f"Work out $\\frac{{{p['a']}}}{{{p['b']}}} - \\frac{{{p['c']}}}{{{p['d']}}}$. "
            "Give your answer as a fraction in its simplest form."
        ),
        answer=lambda p: q(p["a"], p["b"]) - q(p["c"], p["d"]),
        answer_format=FRACTION,
        misconceptions={"FRAC_SUB_NUM_DEN": "frac_sub_num_den"},
    ),
    Template(
        id="n2-fraction-divide",
        node="N2",
        family="N2.fraction-divide",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (
            dict(zip(("a", "b"), _proper(r, 2, 9), strict=True))
            | dict(zip(("c", "d"), _proper(r, 2, 9), strict=True))
        ),
        valid=lambda p: not (q(p["a"], p["b"]) / q(p["c"], p["d"])).is_integer,
        stem=lambda p: (
            f"Work out $\\frac{{{p['a']}}}{{{p['b']}}} \\div \\frac{{{p['c']}}}{{{p['d']}}}$. "
            "Give your answer as a fraction in its simplest form."
        ),
        answer=lambda p: q(p["a"], p["b"]) / q(p["c"], p["d"]),
        answer_format=FRACTION,
        misconceptions={"FRAC_DIV_FLIP_FIRST": "frac_div_flip_first"},
    ),
    Template(
        id="n2-add-decimals",
        node="N2",
        family="N2.add-decimals",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {
            "short": f"{r.randint(1, 9)}.{r.randint(1, 9)}",
            "long": f"{r.randint(1, 9)}.{r.randint(0, 9)}{r.randint(1, 9)}",
        },
        stem=lambda p: f"Work out ${p['short']} + {p['long']}$.",
        answer=lambda p: dec(p["short"]) + dec(p["long"]),
        answer_format=DECIMAL,
        misconceptions={"DEC_ADD_RIGHT_ALIGNED": "decimal_add_right_aligned"},
    ),
    Template(
        id="n2-multiply-decimals",
        node="N2",
        family="N2.multiply-decimals",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 9), "b": r.randint(2, 9)},
        stem=lambda p: f"Work out $0.{p['a']} \\times 0.{p['b']}$.",
        answer=lambda p: q(p["a"] * p["b"], 100),
        answer_format=DECIMAL,
        misconceptions={"DEC_MULTIPLY_POINT_PLACE": "decimal_mult_point_count_wrong"},
    ),
    Template(
        id="n2-multiply-mixed-number",
        node="N2",
        family="N2.multiply-mixed-numbers",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (
            {"w": r.randint(1, 5), "k": r.randint(2, 6)}
            | dict(zip(("n", "d"), _proper(r, 2, 5), strict=True))
        ),
        stem=lambda p: (
            f"Work out ${p['w']}\\frac{{{p['n']}}}{{{p['d']}}} \\times {p['k']}$. "
            "Give your answer as a mixed number in its simplest form."
        ),
        answer=lambda p: (p["w"] + q(p["n"], p["d"])) * p["k"],
        answer_format=AnswerFormat(form="mixed_number", simplest=True),
        valid=lambda p: not ((p["w"] + q(p["n"], p["d"])) * p["k"]).is_integer,
        misconceptions={"MIXED_NUMBER_WHOLE_ONLY": "mixed_mult_whole_only"},
    ),
    Template(
        id="n3-order-of-operations",
        node="N3",
        family="N3.order-of-operations",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 12), "b": r.randint(2, 9), "c": r.randint(2, 9)},
        stem=lambda p: f"Work out ${p['a']} + {p['b']} \\times {p['c']}$.",
        answer=lambda p: q(p["a"] + p["b"] * p["c"]),
        misconceptions={"ORDER_OF_OPERATIONS_LEFT_TO_RIGHT": "left_to_right_evaluation"},
    ),
    Template(
        id="n9-standard-to-ordinary",
        node="N9",
        family="N9.standard-form-to-ordinary",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"m": _sf_mantissa(r), "k": r.choice([-4, -3, -2, 2, 3, 4])},
        stem=lambda p: f"Write ${p['m']} \\times 10^{{{p['k']}}}$ as an ordinary number.",
        answer=lambda p: dec(p["m"]) * q(10) ** p["k"],
        answer_format=DECIMAL,
        misconceptions={
            "SF_NEGATIVE_POWER_DIRECTION": "sf_negative_power_wrong_direction",
            "SF_POWER_ON_MANTISSA": "sf_power_applied_to_mantissa",
        },
    ),
    Template(
        id="n9-ordinary-to-standard",
        node="N9",
        family="N9.ordinary-to-standard-form",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"m": _sf_mantissa(r), "k": r.randint(3, 8)},
        stem=lambda p: f"Write ${tex(dec(p['m']) * q(10) ** p['k'])}$ in standard form.",
        answer=lambda p: dec(p["m"]) * q(10) ** p["k"],
        answer_format=AnswerFormat(form="standard_form"),
        structures={"SF_NOT_NORMALISED": "sf_not_normalised"},
        misconceptions={"SF_POWER_COUNTS_ZEROS": "sf_power_counts_zeros"},
    ),
    Template(
        id="n9-multiply-standard-form",
        node="N9",
        family="N9.multiply-standard-form",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {
            "a": r.randint(2, 4),
            "b": r.randint(2, 4),
            "m": r.randint(2, 6),
            "n": r.randint(2, 6),
        },
        valid=lambda p: p["m"] * p["n"] != p["m"] + p["n"],
        stem=lambda p: (
            f"Work out $({p['a']} \\times 10^{{{p['m']}}}) "
            f"\\times ({p['b']} \\times 10^{{{p['n']}}})$. "
            "Give your answer in standard form."
        ),
        answer=lambda p: q(p["a"] * p["b"]) * q(10) ** (p["m"] + p["n"]),
        answer_format=AnswerFormat(form="standard_form"),
        structures={"SF_NOT_NORMALISED": "sf_not_normalised"},
        misconceptions={"SF_MULTIPLY_POWERS": "sf_multiply_powers"},
    ),
    Template(
        id="n10-fraction-to-decimal",
        node="N10",
        family="N10.fraction-to-decimal",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(
            zip(
                ("n", "d"),
                r.choice([(1, 4), (3, 4), (1, 5), (2, 5), (1, 8), (3, 8), (1, 20), (1, 25)]),
                strict=True,
            )
        ),
        stem=lambda p: f"Write $\\frac{{{p['n']}}}{{{p['d']}}}$ as a decimal.",
        answer=lambda p: q(p["n"], p["d"]),
        answer_format=DECIMAL,
        misconceptions={"FDP_DENOMINATOR_AS_DECIMAL": "fdp_denominator_as_decimal"},
    ),
    Template(
        id="n10-thirds-to-decimal",
        node="N10",
        family="N10.fraction-to-decimal",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"n": r.choice([1, 2]), "d": 3},
        stem=lambda p: (
            f"Write $\\frac{{{p['n']}}}{{3}}$ as a decimal. Give your answer to 2 decimal places."
        ),
        # The answer is the rounded value the question asks for.
        answer=lambda p: q(round(100 * p["n"] / 3), 100),
        answer_format=AnswerFormat(form="decimal", dp=2),
        misconceptions={"FDP_THIRD_AS_POINT_THREE": "fdp_third_point_three"},
    ),
    Template(
        id="n10-decimal-to-percentage",
        node="N10",
        family="N10.decimal-to-percentage",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"x": r.choice([f"0.{r.randint(2, 9)}", f"0.{r.randint(10, 99)}5"])},
        stem=lambda p: f"Write ${p['x']}$ as a percentage.",
        answer=lambda p: dec(p["x"]) * 100,
        answer_format=PERCENT,
        misconceptions={"FDP_PERCENT_DIGITS_ONLY": "fdp_percent_digits_only"},
    ),
    Template(
        id="n10-fraction-to-percentage",
        node="N10",
        family="N10.fraction-to-percentage",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda d: {"n": r.randint(1, d - 1), "d": d})(
            r.choice([2, 4, 5, 10, 20, 25])
        ),
        valid=lambda p: gcd(p["n"], p["d"]) == 1,
        stem=lambda p: f"Write $\\frac{{{p['n']}}}{{{p['d']}}}$ as a percentage.",
        answer=lambda p: q(p["n"] * 100, p["d"]),
        answer_format=PERCENT,
        misconceptions={"FDP_CONCATENATE": "fdp_concatenate"},
    ),
    Template(
        id="n11-ratio-to-fraction",
        node="N11",
        family="N11.ratio-to-fraction",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), r.sample(range(1, 10), 2), strict=True)),
        valid=lambda p: gcd(p["a"], p["b"]) == 1,
        stem=lambda p: (
            f"Red and blue counters are in the ratio ${p['a']} : {p['b']}$. "
            "What fraction of the counters are red?"
        ),
        answer=lambda p: q(p["a"], p["a"] + p["b"]),
        answer_format=FRACTION,
        misconceptions={"FRAC_IN_RATIO_WRONG_WHOLE": "ratio_part_over_other_part"},
    ),
    Template(
        id="n11-fraction-to-ratio",
        node="N11",
        family="N11.fraction-to-ratio",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("n", "d"), _proper(r, 3, 10), strict=True)),
        stem=lambda p: (
            f"$\\frac{{{p['n']}}}{{{p['d']}}}$ of the people in a choir are tenors. "
            "The rest are not. Write the ratio of tenors to other singers in its simplest form."
        ),
        answer=lambda p: sympy.Tuple(p["n"], p["d"] - p["n"]),
        answer_format=AnswerFormat(kind="ratio", simplest=True),
    ),
    Template(
        id="n11-part-as-fraction-of-part",
        node="N11",
        family="N11.part-of-part",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), r.sample(range(2, 10), 2), strict=True)),
        valid=lambda p: gcd(p["a"], p["b"]) == 1,
        stem=lambda p: (
            f"The ratio of cats to dogs at a rescue centre is ${p['a']} : {p['b']}$. "
            "Write the number of cats as a fraction of the number of dogs."
        ),
        answer=lambda p: q(p["a"], p["b"]),
        answer_format=AnswerFormat(form="fraction"),
    ),
    Template(
        id="n12-fraction-of-amount",
        node="N12",
        family="N12.fraction-of-amount",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=_fraction_of_amount,
        stem=lambda p: f"Work out $\\frac{{{p['n']}}}{{{p['d']}}}$ of ${p['amount']}$.",
        answer=lambda p: q(p["n"] * p["amount"], p["d"]),
        misconceptions={"FRAC_OF_AMOUNT_DIVIDE_ONLY": "frac_of_amount_divide_only"},
    ),
    Template(
        id="n12-percentage-of-amount",
        node="N12",
        family="N12.percentage-of-amount",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {
            "pct": r.choice([5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 75]),
            "amount": 20 * r.randint(1, 12),
        },
        valid=lambda p: (p["pct"] * p["amount"]) % 100 == 0,
        stem=lambda p: f"Work out ${p['pct']}\\%$ of ${p['amount']}$.",
        answer=lambda p: q(p["pct"] * p["amount"], 100),
        misconceptions={"PCT_DIVIDE_BY_PERCENT": "pct_divide_by_percent"},
    ),
    Template(
        id="n12-percentage-of-money",
        node="N12",
        family="N12.percentage-of-amount",
        command_word="WORK_OUT",
        marks=2,
        calculator=True,
        draw=lambda r: {
            "pct": r.choice(["12.5", "17.5", "8", "4.5", "22"]),
            "amount": f"{r.randint(12, 95)}.{r.choice(['20', '40', '60', '80'])}",
            "dp": 2,
        },
        stem=lambda p: (
            f"Work out ${p['pct']}\\%$ of {money(p['amount'])}. "
            "Give your answer to the nearest penny."
        ),
        answer=lambda p: round_half_up(dec(p["pct"]) * dec(p["amount"]) / 100, 2),
        answer_format=AnswerFormat(form="decimal", dp=2),
        misconceptions={"PCT_DIVIDE_BY_PERCENT": "pct_divide_by_percent"},
    ),
]
