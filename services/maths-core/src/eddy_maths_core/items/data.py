"""Probability and statistics: P7, P8 and S4 templates and rules."""

import random
from itertools import product
from math import gcd

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.base import Template
from eddy_maths_core.items.text import round_half_up
from eddy_maths_core.rules import Params, q, rule

# Any exact form: GCSE accepts 2/36, 1/18 and an exact decimal alike unless the question asks.
PROBABILITY = AnswerFormat()
COLOURS = ("red", "blue", "green", "yellow")


def _sum_count(total: int) -> int:
    return sum(1 for a, b in product(range(1, 7), repeat=2) if a + b == total)


# P7: possibility spaces


@rule("sample_space_unordered")
def _unordered(p: Params) -> sympy.Basic:
    pairs = {
        tuple(sorted(pair)) for pair in product(range(1, 7), repeat=2) if sum(pair) == p["total"]
    }
    return q(len(pairs), 21)


# P8: tree diagrams


@rule("tree_add_along_branches")
def _add_along(p: Params) -> sympy.Basic:
    return q(p["a"], p["n"]) + q(p["b"], p["m"])


@rule("tree_multiply_alternatives")
def _multiply_alternatives(p: Params) -> sympy.Basic:
    first = q(p["a"], p["n"]) * (1 - q(p["b"], p["m"]))
    second = (1 - q(p["a"], p["n"])) * q(p["b"], p["m"])
    return first * second


@rule("tree_ignore_replacement")
def _ignore_replacement(p: Params) -> sympy.Basic:
    return q(p["r"], p["r"] + p["s"]) ** 2


# S4: averages and range


@rule("median_unordered")
def _median_unordered(p: Params) -> sympy.Basic:
    values = p["values"]
    return q(values[len(values) // 2])


@rule("median_position_as_value")
def _median_position(p: Params) -> sympy.Basic:
    return q(len(p["values"]) + 1, 2)


def _grouped(p: Params) -> tuple[list[int], list[int]]:
    starts = [p["start"] + i * p["width"] for i in range(len(p["freqs"]))]
    mids = [s + p["width"] // 2 for s in starts]
    return mids, p["freqs"]


@rule("grouped_mean_class_width")
def _class_width(p: Params) -> sympy.Basic:
    return q(sum(p["width"] * f for f in p["freqs"]), sum(p["freqs"]))


@rule("grouped_mean_divide_by_groups")
def _divide_by_groups(p: Params) -> sympy.Basic:
    mids, freqs = _grouped(p)
    return q(sum(m * f for m, f in zip(mids, freqs, strict=True)), len(freqs))


@rule("mode_as_frequency")
def _mode_frequency(p: Params) -> sympy.Basic:
    return q(max(p["freqs"]))


@rule("range_largest_value")
def _range_largest(p: Params) -> sympy.Basic:
    return q(max(p["values"]))


def _bag(rng: random.Random) -> Params:
    return {"r": rng.randint(2, 7), "s": rng.randint(2, 7), "colour": rng.choice(COLOURS[:2])}


def _simplest_numerator(rng: random.Random, denominator: int) -> int:
    return rng.choice([k for k in range(1, denominator) if gcd(k, denominator) == 1])


def _two_events(rng: random.Random) -> Params:
    n, m = rng.choice([4, 5, 8, 10]), rng.choice([4, 5, 8, 10])
    return {"n": n, "m": m, "a": _simplest_numerator(rng, n), "b": _simplest_numerator(rng, m)}


def _odd_list(rng: random.Random) -> Params:
    size = rng.choice([5, 7, 9])
    return {"values": [rng.randint(1, 30) for _ in range(size)]}


def _median_of(values: list[int]) -> sympy.Rational:
    ordered = sorted(values)
    return q(ordered[len(ordered) // 2])


def _grouped_table(rng: random.Random) -> Params:
    width = rng.choice([10, 20])
    return {
        "start": 0,
        "width": width,
        "freqs": [rng.randint(1, 12) for _ in range(rng.choice([4, 5]))],
    }


def _frequency_table(rng: random.Random) -> Params:
    values = sorted(rng.sample(range(0, 8), 5))
    freqs = rng.sample(range(2, 15), 5)
    return {"values": values, "freqs": freqs}


def _table(p: Params) -> str:
    rows = " & ".join(str(v) for v in p["values"])
    freqs = " & ".join(str(f) for f in p["freqs"])
    columns = "c" * (len(p["values"]) + 1)
    return (
        f"$\\begin{{array}}{{{columns}}} \\text{{Number of pets}} & {rows} \\\\ "
        f"\\text{{Frequency}} & {freqs} \\end{{array}}$"
    )


def _grouped_rows(p: Params) -> str:
    rows = []
    for i, f in enumerate(p["freqs"]):
        low = p["start"] + i * p["width"]
        rows.append(f"{low} < t \\le {low + p['width']} & {f}")
    body = " \\\\ ".join(rows)
    header = "\\text{Time, } t \\text{ (minutes)} & \\text{Frequency}"
    return f"$\\begin{{array}}{{cc}} {header} \\\\ {body} \\end{{array}}$"


TEMPLATES = [
    Template(
        id="p7-two-dice-sum",
        node="P7",
        family="P7.two-dice",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"total": r.randint(3, 11)},
        stem=lambda p: (
            "Two fair six-sided dice are rolled and the scores are added. Work out the probability "
            f"that the total is {p['total']}."
        ),
        answer=lambda p: q(_sum_count(p["total"]), 36),
        answer_format=PROBABILITY,
        structures={"PROBABILITY_OVER_ONE": "probability_over_one"},
        misconceptions={"SAMPLE_SPACE_UNORDERED": "sample_space_unordered"},
    ),
    Template(
        id="p7-count-outcomes",
        node="P7",
        family="P7.count-outcomes",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {
            "starters": r.randint(2, 5),
            "mains": r.randint(3, 7),
            "desserts": r.randint(2, 5),
        },
        stem=lambda p: (
            f"A cafe offers {p['starters']} starters, {p['mains']} main courses and "
            f"{p['desserts']} desserts. How many different three-course meals can be chosen?"
        ),
        answer=lambda p: q(p["starters"] * p["mains"] * p["desserts"]),
    ),
    Template(
        id="p7-spinner-and-coin",
        node="P7",
        family="P7.two-events-grid",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=lambda r: {"sides": r.choice([3, 4, 5, 6]), "target": r.randint(1, 3)},
        valid=lambda p: p["target"] <= p["sides"],
        stem=lambda p: (
            f"A fair spinner numbered 1 to {p['sides']} is spun and a fair coin is thrown. "
            f"Work out the probability of getting a {p['target']} and heads."
        ),
        answer=lambda p: q(1, 2 * p["sides"]),
        answer_format=PROBABILITY,
    ),
    Template(
        id="p8-tree-and",
        node="P8",
        family="P8.tree-and",
        command_word="WORK_OUT",
        marks=2,
        calculator=False,
        draw=_two_events,
        stem=lambda p: (
            f"The probability that Asha's bus is late is $\\frac{{{p['a']}}}{{{p['n']}}}$. "
            f"The probability that it rains is $\\frac{{{p['b']}}}{{{p['m']}}}$. The two events "
            "are independent. Work out the probability that the bus is late and it rains."
        ),
        answer=lambda p: q(p["a"], p["n"]) * q(p["b"], p["m"]),
        answer_format=PROBABILITY,
        structures={"PROBABILITY_OVER_ONE": "probability_over_one"},
        misconceptions={"TREE_ADD_ALONG_BRANCHES": "tree_add_along_branches"},
    ),
    Template(
        id="p8-tree-or",
        node="P8",
        family="P8.tree-or",
        command_word="WORK_OUT",
        marks=3,
        calculator=False,
        draw=_two_events,
        stem=lambda p: (
            f"The probability that Ben passes a music exam is $\\frac{{{p['a']}}}{{{p['n']}}}$. "
            f"The probability that he passes a swimming test is $\\frac{{{p['b']}}}{{{p['m']}}}$. "
            "The two events are independent. Work out the probability that he passes exactly one "
            "of them."
        ),
        answer=lambda p: (
            q(p["a"], p["n"]) * (1 - q(p["b"], p["m"]))
            + (1 - q(p["a"], p["n"])) * q(p["b"], p["m"])
        ),
        answer_format=PROBABILITY,
        structures={"PROBABILITY_OVER_ONE": "probability_over_one"},
        misconceptions={"TREE_MULTIPLY_ALTERNATIVES": "tree_multiply_alternatives"},
    ),
    Template(
        id="p8-without-replacement",
        node="P8",
        family="P8.tree-without-replacement",
        command_word="WORK_OUT",
        marks=3,
        calculator=False,
        draw=_bag,
        stem=lambda p: (
            f"A bag holds {p['r']} red counters and {p['s']} blue counters. Two counters are taken "
            "at random without replacement. Work out the probability that both are red."
        ),
        answer=lambda p: q(p["r"], p["r"] + p["s"]) * q(p["r"] - 1, p["r"] + p["s"] - 1),
        answer_format=PROBABILITY,
        structures={"PROBABILITY_OVER_ONE": "probability_over_one"},
        misconceptions={"TREE_IGNORE_REPLACEMENT": "tree_ignore_replacement"},
    ),
    Template(
        id="s4-median",
        node="S4",
        family="S4.median",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=_odd_list,
        valid=lambda p: p["values"] != sorted(p["values"]),
        stem=lambda p: f"Find the median of these numbers: {', '.join(map(str, p['values']))}.",
        answer=lambda p: _median_of(p["values"]),
        misconceptions={
            "MEDIAN_UNORDERED": "median_unordered",
            "MEDIAN_POSITION_AS_VALUE": "median_position_as_value",
        },
    ),
    Template(
        id="s4-grouped-mean",
        node="S4",
        family="S4.grouped-mean",
        command_word="ESTIMATE",
        marks=3,
        calculator=True,
        draw=_grouped_table,
        stem=lambda p: (
            "The table shows how long some students took to get to school. Work out an estimate "
            f"of the mean time. Give your answer to 1 decimal place. {_grouped_rows(p)}"
        ),
        answer=lambda p: round_half_up(
            q(sum(m * f for m, f in zip(*_grouped(p), strict=True)), sum(p["freqs"])), 1
        ),
        answer_format=AnswerFormat(dp=1),
        misconceptions={
            "GROUPED_MEAN_CLASS_WIDTH": "grouped_mean_class_width",
            "GROUPED_MEAN_DIVIDE_BY_CLASSES": "grouped_mean_divide_by_groups",
        },
    ),
    Template(
        id="s4-mode-from-table",
        node="S4",
        family="S4.mode-from-table",
        command_word="WRITE",
        marks=1,
        calculator=False,
        draw=_frequency_table,
        stem=lambda p: (
            f"The table shows how many pets some students have. Write down the mode. {_table(p)}"
        ),
        answer=lambda p: q(p["values"][p["freqs"].index(max(p["freqs"]))]),
        misconceptions={"MODE_AS_FREQUENCY": "mode_as_frequency"},
    ),
    Template(
        id="s4-range",
        node="S4",
        family="S4.range",
        command_word="WORK_OUT",
        marks=1,
        calculator=False,
        draw=lambda r: {"values": [r.randint(2, 40) for _ in range(r.randint(6, 9))]},
        valid=lambda p: min(p["values"]) > 0,
        stem=lambda p: f"Work out the range of these numbers: {', '.join(map(str, p['values']))}.",
        answer=lambda p: q(max(p["values"]) - min(p["values"])),
        misconceptions={"RANGE_AS_LARGEST": "range_largest_value"},
    ),
]
