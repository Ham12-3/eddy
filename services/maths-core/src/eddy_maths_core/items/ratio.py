"""Ratio, proportion and percentages: R4, R5, R6, R7 and R9 templates and rules."""

import random
from math import gcd

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.base import Template
from eddy_maths_core.items.text import money, round_half_up
from eddy_maths_core.rules import Params, q, rule

RATIO = AnswerFormat(kind="ratio", simplest=True)
MONEY = AnswerFormat(form="decimal", dp=2)


def _coprime_pair(rng: random.Random, low: int = 1, high: int = 9) -> tuple[int, int]:
    while True:
        a, b = rng.randint(low, high), rng.randint(low, high)
        if a != b and gcd(a, b) == 1:
            return a, b


# R4: writing and simplifying ratios


@rule("ratio_order_swapped")
def _swapped(p: Params) -> sympy.Basic:
    g = gcd(p["a"], p["b"])
    return sympy.Tuple(p["b"] // g, p["a"] // g)


@rule("ratio_simplify_one_part")
def _one_side(p: Params) -> sympy.Basic:
    g = gcd(p["a"], p["b"])
    return sympy.Tuple(p["a"] // g, p["b"])


# R5: sharing in a ratio


@rule("ratio_divide_by_each_part")
def _each_part(p: Params) -> sympy.Basic:
    # Shares the total as total / part: the asked share becomes total / its own part.
    return q(p["total"], p[p["ask"]])


@rule("ratio_divide_by_one_part")
def _one_part(p: Params) -> sympy.Basic:
    # Divides the total by the second number in the ratio and uses that as one part:
    # 30 in 2 : 3 gives parts of 10, so shares of 20 and 30 (which add to 50, not 30).
    return q(p["total"], p["b"]) * p[p["ask"]]


@rule("ratio_part_treated_as_total")
def _part_as_total(p: Params) -> sympy.Basic:
    # The given share is split as though it were the whole amount.
    return q(p["given"], p["a"] + p["b"]) * p[p["ask"]]


# R6: a ratio as a fraction relationship


@rule("ratio_fraction_inverted")
def _inverted(p: Params) -> sympy.Basic:
    return q(p["a"], p["b"])


# R7: scaling


@rule("ratio_additive_scaling")
def _additive(p: Params) -> sympy.Basic:
    return q(p["amount"] + (p["new_people"] - p["people"]))


# R9: percentage change


@rule("pct_change_only")
def _change_only(p: Params) -> sympy.Basic:
    return q(p["amount"] * p["pct"], 100)


@rule("pct_reverse_apply_to_new")
def _reverse_on_new(p: Params) -> sympy.Basic:
    new = q(p["original"] * (100 + p["sign"] * p["pct"]), 100)
    return new - p["sign"] * new * q(p["pct"], 100)


@rule("pct_successive_add")
def _successive_add(p: Params) -> sympy.Basic:
    return q(p["amount"] * (100 + p["first"] + p["second"]), 100)


@rule("pct_change_over_new")
def _over_new(p: Params) -> sympy.Basic:
    return q(100 * (p["new"] - p["old"]), p["new"])


def _share(rng: random.Random) -> Params:
    a, b = _coprime_pair(rng, 1, 7)
    return {"a": a, "b": b, "total": (a + b) * rng.randint(3, 15), "ask": rng.choice(["a", "b"])}


def _one_share(rng: random.Random) -> Params:
    a, b = _coprime_pair(rng, 1, 7)
    given_part = rng.choice(["a", "b"])
    unit = rng.randint(3, 12)
    return {
        "a": a,
        "b": b,
        "given_part": given_part,
        "given": unit * (a if given_part == "a" else b),
        "ask": "b" if given_part == "a" else "a",
        "unit": unit,
    }


NAMES = {"a": "Asha", "b": "Ben"}

TEMPLATES = [
    Template(
        id="r4-write-ratio",
        node="R4",
        family="R4.write-ratio",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: {"a": r.randint(2, 18), "b": r.randint(2, 18)},
        valid=lambda p: p["a"] != p["b"],
        stem=lambda p: (
            f"A pet shop has {p['a']} cats and {p['b']} dogs. "
            "Write the ratio of cats to dogs in its simplest form."
        ),
        answer=lambda p: sympy.Tuple(p["a"] // gcd(p["a"], p["b"]), p["b"] // gcd(p["a"], p["b"])),
        answer_format=RATIO,
        misconceptions={"RATIO_ORDER_SWAPPED": "ratio_order_swapped"},
    ),
    Template(
        id="r4-simplify-ratio",
        node="R4",
        family="R4.simplify-ratio",
        command_word="SIMPLIFY",
        marks=1,
        calculator=False,
        draw=lambda r: (lambda k, pair: {"a": k * pair[0], "b": k * pair[1]})(
            r.randint(2, 6), _coprime_pair(r, 1, 9)
        ),
        stem=lambda p: f"Write the ratio ${p['a']} : {p['b']}$ in its simplest form.",
        answer=lambda p: sympy.Tuple(p["a"] // gcd(p["a"], p["b"]), p["b"] // gcd(p["a"], p["b"])),
        answer_format=RATIO,
        misconceptions={"RATIO_SIMPLIFY_ONE_PART": "ratio_simplify_one_part"},
    ),
    Template(
        id="r4-ratio-with-units",
        node="R4",
        family="R4.ratio-with-units",
        command_word="WRITE",
        marks=2,
        calculator=False,
        draw=lambda r: {"cm": 10 * r.randint(1, 9), "m": r.randint(1, 5)},
        valid=lambda p: p["cm"] != 100 * p["m"],
        stem=lambda p: f"Write ${p['cm']}$ cm $: {p['m']}$ m as a ratio in its simplest form.",
        answer=lambda p: sympy.Tuple(
            p["cm"] // gcd(p["cm"], 100 * p["m"]), 100 * p["m"] // gcd(p["cm"], 100 * p["m"])
        ),
        answer_format=RATIO,
    ),
    Template(
        id="r5-share-in-ratio",
        node="R5",
        family="R5.share-in-ratio",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_share,
        stem=lambda p: (
            f"{NAMES['a']} and {NAMES['b']} share £{p['total']} "
            f"in the ratio ${p['a']} : {p['b']}$. "
            f"How much does {NAMES[p['ask']]} get?"
        ),
        answer=lambda p: q(p["total"] * p[p["ask"]], p["a"] + p["b"]),
        misconceptions={
            "RATIO_DIVIDE_BY_EACH_PART": "ratio_divide_by_each_part",
            "RATIO_DIVIDE_BY_ONE_PART": "ratio_divide_by_one_part",
        },
    ),
    Template(
        id="r5-ratio-from-one-share",
        node="R5",
        family="R5.ratio-from-one-share",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_one_share,
        stem=lambda p: (
            f"{NAMES['a']} and {NAMES['b']} share some sweets in the ratio ${p['a']} : {p['b']}$. "
            f"{NAMES[p['given_part']]} gets {p['given']} sweets. "
            f"How many does {NAMES[p['ask']]} get?"
        ),
        answer=lambda p: q(p["unit"] * p[p["ask"]]),
        misconceptions={"RATIO_PART_TREATED_AS_TOTAL": "ratio_part_treated_as_total"},
    ),
    Template(
        id="r5-share-difference",
        node="R5",
        family="R5.share-difference",
        command_word="WORK_OUT",
        marks=3,
        calculator=False,
        draw=lambda r: (lambda pair, unit: {"a": min(pair), "b": max(pair), "unit": unit})(
            _coprime_pair(r, 1, 8), r.randint(2, 12)
        ),
        stem=lambda p: (
            f"{NAMES['a']} and {NAMES['b']} share some money in the ratio ${p['a']} : {p['b']}$. "
            f"{NAMES['b']} gets £{(p['b'] - p['a']) * p['unit']} more than {NAMES['a']}. "
            "How much money do they share altogether?"
        ),
        answer=lambda p: q((p["a"] + p["b"]) * p["unit"]),
    ),
    Template(
        id="r6-fraction-relationship",
        node="R6",
        family="R6.ratio-relationship",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), _coprime_pair(r, 2, 9), strict=True)),
        stem=lambda p: (
            f"The ratio of apples to pears in a box is ${p['a']} : {p['b']}$. "
            "The number of pears is what fraction of the number of apples?"
        ),
        answer=lambda p: q(p["b"], p["a"]),
        answer_format=AnswerFormat(form="fraction"),
        misconceptions={"RATIO_FRACTION_WRONG_WAY_ROUND": "ratio_fraction_inverted"},
    ),
    Template(
        id="r6-ratio-from-fraction",
        node="R6",
        family="R6.ratio-from-fraction",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=lambda r: dict(zip(("a", "b"), _coprime_pair(r, 1, 9), strict=True)),
        valid=lambda p: p["b"] > 1,  # never "7/1 of the roses"
        stem=lambda p: (
            f"In a garden, the number of tulips is $\\frac{{{p['a']}}}{{{p['b']}}}$ "
            "of the number of "
            "roses. Write the ratio of tulips to roses in its simplest form."
        ),
        answer=lambda p: sympy.Tuple(p["a"], p["b"]),
        answer_format=RATIO,
    ),
    Template(
        id="r6-ratio-to-multiplier",
        node="R6",
        family="R6.ratio-multiplier",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (lambda pair, unit: {"a": pair[0], "b": pair[1], "unit": unit})(
            _coprime_pair(r, 1, 9), r.randint(2, 10)
        ),
        stem=lambda p: (
            f"Paint is mixed from blue and white in the ratio ${p['a']} : {p['b']}$. "
            f"A tin uses {p['a'] * p['unit']} litres of blue. How many litres of white does it use?"
        ),
        answer=lambda p: q(p["b"] * p["unit"]),
    ),
    Template(
        id="r7-scale-recipe",
        node="R7",
        family="R7.scale-quantities",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: (
            lambda people, factor: {
                "people": people,
                "new_people": int(people * factor),
                "amount": r.randint(2, 12) * people // gcd(people, 2),
            }
        )(r.choice([2, 4, 6, 8]), r.choice([q(3, 2), q(2), q(5, 2), q(3)])),
        valid=lambda p: (p["amount"] * p["new_people"]) % p["people"] == 0,
        stem=lambda p: (
            f"A recipe for {p['people']} people uses {p['amount']} g of butter. "
            f"How much butter is needed for {p['new_people']} people?"
        ),
        answer=lambda p: q(p["amount"] * p["new_people"], p["people"]),
        misconceptions={"RATIO_ADDITIVE_SCALING": "ratio_additive_scaling"},
    ),
    Template(
        id="r7-best-buy",
        node="R7",
        family="R7.unit-price",
        command_word="WORK_OUT",
        marks=2,
        calculator=True,
        draw=lambda r: {"grams": r.choice([250, 400, 500, 750]), "pence": r.randint(80, 450)},
        stem=lambda p: (
            f"A {p['grams']} g bag of rice costs {money(q(p['pence'], 100))}. "
            "Work out the cost of 100 g of rice, in pence. Give your answer to 1 decimal place."
        ),
        answer=lambda p: round_half_up(q(100 * p["pence"], p["grams"]), 1),
        answer_format=AnswerFormat(form="decimal", dp=1),
    ),
    Template(
        id="r7-direct-proportion",
        node="R7",
        family="R7.direct-proportion",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"n": r.randint(2, 8), "cost": r.randint(2, 9) * 10, "m": r.randint(3, 12)},
        valid=lambda p: p["n"] != p["m"] and (p["cost"] * p["m"]) % p["n"] == 0,
        stem=lambda p: (
            f"{p['n']} notebooks cost £{p['cost']}. Work out the cost of {p['m']} of the same "
            "notebooks."
        ),
        answer=lambda p: q(p["cost"] * p["m"], p["n"]),
        answer_format=AnswerFormat(),
    ),
    Template(
        id="r9-percentage-increase",
        node="R9",
        family="R9.percentage-change-amount",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {
            "amount": 20 * r.randint(2, 20),
            "pct": r.choice([5, 10, 15, 20, 25, 30, 35, 40]),
            "sign": r.choice([1, -1]),
        },
        valid=lambda p: (p["amount"] * p["pct"]) % 100 == 0,
        stem=lambda p: (
            f"{'Increase' if p['sign'] > 0 else 'Decrease'} £{p['amount']} by {p['pct']}%."
        ),
        answer=lambda p: q(p["amount"] * (100 + p["sign"] * p["pct"]), 100),
        misconceptions={"PCT_CHANGE_ONLY": "pct_change_only"},
    ),
    Template(
        id="r9-reverse-percentage",
        node="R9",
        family="R9.reverse-percentage",
        command_word="WORK_OUT",
        marks=3,
        calculator=True,
        draw=lambda r: {
            "original": 20 * r.randint(2, 25),
            "pct": r.choice([10, 20, 25, 30, 40]),
            "sign": r.choice([1, -1]),
        },
        valid=lambda p: (p["original"] * p["pct"]) % 100 == 0,
        stem=lambda p: (
            f"In a sale, every price is reduced by {p['pct']}%. A coat costs "
            f"£{p['original'] * (100 - p['pct']) // 100} in the sale. "
            "Work out its price before the sale."
            if p["sign"] < 0
            else f"A price of £{p['original'] * (100 + p['pct']) // 100} includes a {p['pct']}% "
            "service charge. Work out the price before the service charge was added."
        ),
        answer=lambda p: q(p["original"]),
        misconceptions={"PCT_REVERSE_APPLY_TO_NEW": "pct_reverse_apply_to_new"},
    ),
    Template(
        id="r9-successive-change",
        node="R9",
        family="R9.successive-percentage-change",
        command_word="WORK_OUT",
        marks=3,
        calculator=True,
        draw=lambda r: {
            "amount": 100 * r.randint(1, 9),
            "first": r.choice([5, 10, 20]),
            "second": r.choice([5, 10, 20, 25]),
        },
        stem=lambda p: (
            f"A painting is worth £{p['amount']}. "
            f"Its value rises by {p['first']}% in one year, then "
            f"by {p['second']}% the next year. Work out its value after the two years."
        ),
        answer=lambda p: q(p["amount"] * (100 + p["first"]) * (100 + p["second"]), 10_000),
        answer_format=AnswerFormat(),
        misconceptions={"PCT_SUCCESSIVE_ADD": "pct_successive_add"},
    ),
    Template(
        id="r9-percentage-change",
        node="R9",
        family="R9.percentage-change-find",
        command_word="WORK_OUT",
        marks=2,
        calculator=True,
        draw=lambda r: (lambda old, pct: {"old": old, "new": old * (100 + pct) // 100, "pct": pct})(
            20 * r.randint(2, 20), r.choice([10, 15, 20, 25, 30, 40, 50])
        ),
        valid=lambda p: p["old"] * (100 + p["pct"]) % 100 == 0,
        stem=lambda p: (
            f"A bus fare goes up from {p['old']}p to {p['new']}p. Work out the percentage increase."
        ),
        answer=lambda p: q(p["pct"]),
        answer_format=AnswerFormat(unit="%"),
        misconceptions={"PCT_CHANGE_OVER_NEW": "pct_change_over_new"},
    ),
]
