"""The misconception rule registry (ADR-0022).

A rule is a pure function from an item's parameters to the wrong answer a misconception
produces, or None when the misconception cannot show itself with those parameters. The same
function makes the distractor and recognises the student's wrong answer, so they cannot drift.
Every `distractor` rule named in curriculum/maths/misconceptions.yaml must be registered here;
a test checks it.
"""

from collections.abc import Callable
from typing import Any

import sympy

Params = dict[str, Any]
Rule = Callable[[Params], sympy.Basic | None]

RULES: dict[str, Rule] = {}


def rule(name: str) -> Callable[[Rule], Rule]:
    def register(function: Rule) -> Rule:
        if name in RULES:
            raise ValueError(f"rule {name} is registered twice")
        RULES[name] = function
        return function

    return register


def q(numerator: int, denominator: int = 1) -> sympy.Rational:
    """An exact rational. Shorter to read in rule bodies than sympy.Rational."""
    return sympy.Rational(numerator, denominator)


def dec(text: str) -> sympy.Rational:
    """An exact rational from a decimal written in the item, such as "0.125"."""
    whole, _, places = text.lstrip("-").partition(".")
    value = sympy.Rational(int(whole + places), 10 ** len(places))
    return -value if text.startswith("-") else value
