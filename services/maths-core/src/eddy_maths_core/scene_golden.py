"""The scene half of the maths golden set (SPEC.md section 7.6): every maths fact in the default
scenes is verified, for about 100 scene specs.

`python -m eddy_maths_core.scene_golden inputs PATH` writes, for each default scene's item
template and misconception, eight generated items with the student's wrong answer (that
misconception's distractor). packages/scenes builds a scene from each one
(`pnpm --filter @eddy/scenes golden`) and writes its spec, its claims and its canvas labels.
`check PATH` then requires:

- every claim is a relation that maths-core verifies as true;
- the scene's correct answer equals maths-core's answer for the item, and the wrong answer the
  scene describes equals the student's actual answer;
- every number the narration or a label states, sign included, is one the claims, the item or
  the answers state. "minus 4" and "negative 4" read as -4. A bare number may stand for the size of
  a stated negative only after a subtraction ("6x - 5" when b is -5) or before a direction word
  ("6 down", "1 left"), so "x = 4" when x is -4 is caught. This is a
  set-membership test: it catches a number nothing checked, not a wrong pairing of checked ones.

A label may show a faulty step (the student's wrong reasoning, marked as wrong); its numbers still
have to come from the item or the claims. Axis and scale labels (the structure role) are left out:
they are a number line's or a grid's own scale, not statements.
"""

import json
import re
import sys
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from math import gcd
from pathlib import Path
from typing import Any

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.items import TEMPLATES
from eddy_maths_core.mathjson import MathJsonError, to_sympy
from eddy_maths_core.serialize import to_mathjson
from eddy_maths_core.verify import verify_claims

# Item template and misconception for each default scene (packages/scenes checks these match).
SCENES = {
    "n1-order-negatives": "NEG_ORDER_BY_DIGIT",
    "n1-order-decimals": "DEC_LONGER_IS_BIGGER",
    "n9-standard-to-ordinary": "SF_NEGATIVE_POWER_DIRECTION",
    "r9-reverse-percentage": "PCT_REVERSE_APPLY_TO_NEW",
    "r5-share-in-ratio": "RATIO_DIVIDE_BY_EACH_PART",
    "a17-two-step": "EQ_DIVIDE_ONE_TERM",
    "a10-gradient-two-points": "GRADIENT_RUN_OVER_RISE",
    "g3-cointerior": "ANGLES_COINTERIOR_EQUAL",
    "g7-translation": "TRANSLATE_COMPONENTS_SWAPPED",
    "g16-triangle-area": "AREA_TRIANGLE_NO_HALF",
    "g20-hypotenuse": "PYTH_NO_SQUARE_ROOT",
    "p8-tree-and": "TREE_ADD_ALONG_BRANCHES",
    "s4-median": "MEDIAN_UNORDERED",
    "n1-order-unit-fractions": "UNIT_FRACTION_BIGGER_DENOMINATOR",
    "n2-fraction-add-unlike": "FRAC_ADD_NUM_DEN",
    "n2-fraction-subtract-unlike": "FRAC_SUB_NUM_DEN",
    "n2-fraction-divide": "FRAC_DIV_FLIP_FIRST",
    "n2-add-negatives": "NEG_TWO_NEGATIVES_ADD_POSITIVE",
    "n3-order-of-operations": "ORDER_OF_OPERATIONS_LEFT_TO_RIGHT",
    "n12-fraction-of-amount": "FRAC_OF_AMOUNT_DIVIDE_ONLY",
    "n12-percentage-of-amount": "PCT_DIVIDE_BY_PERCENT",
}


def _common_denominator_at_most(limit: int) -> Callable[[dict[str, Any]], bool]:
    def allowed(params: dict[str, Any]) -> bool:
        b, d = int(params["b"]), int(params["d"])
        return b * d // gcd(b, d) <= limit

    return allowed


# Items a scene declines (its params() throws), so they get a written explanation instead:
# bars cut into more than 24 parts cannot be read on a phone.
SCENE_ITEMS = {
    "n2-fraction-add-unlike": _common_denominator_at_most(24),
    "n2-fraction-subtract-unlike": _common_denominator_at_most(24),
}
PER_SCENE = 8
FIRST_SEED = 2000
MAX_SEEDS = 500

# A number as scenes write it: a minus sign (U+2212) or hyphen, digits, an optional decimal part.
# Commas inside numbers are thousands separators.
MINUS = chr(0x2212)
NUMBER = re.compile(rf"(?<![\w.])([{MINUS}-]?)(\d[\d,]*(?:\.\d+)?)")


def inputs() -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for template_id, code in SCENES.items():
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for seed in range(FIRST_SEED, FIRST_SEED + MAX_SEEDS):
            item = TEMPLATES[template_id].generate(seed)
            wrong = [d for d in item.distractors if d.misconception == code]
            key = json.dumps(item.params, sort_keys=True)
            allowed = SCENE_ITEMS.get(template_id)
            if not wrong or key in seen or (allowed and not allowed(item.params)):
                continue
            seen.add(key)
            rows.append(
                {
                    "seed": seed,
                    "params": item.params,
                    "answer": to_mathjson(item.answer),
                    "studentAnswer": to_mathjson(wrong[0].value),
                }
            )
            if len(rows) == PER_SCENE:
                break
        if len(rows) < PER_SCENE:
            raise RuntimeError(f"{template_id} gave only {len(rows)} items with {code}")
        result[f"{template_id}:{code}"] = rows
    return result


def _numbers_in(value: Any) -> set[Fraction]:
    """Every number written anywhere in a JSON value: MathJSON numbers, {"num": ...} strings,
    rationals, and numbers inside strings."""
    found: set[Fraction] = set()
    if isinstance(value, bool):
        return found
    if isinstance(value, int | float):
        found.add(Fraction(Decimal(str(value))))
    elif isinstance(value, str):
        found |= numbers_in_text(value)
    elif isinstance(value, list):
        if (
            len(value) == 3
            and value[0] == "Rational"
            and all(isinstance(v, int) for v in value[1:])
        ):
            found.add(Fraction(value[1], value[2]))
        for entry in value:
            found |= _numbers_in(entry)
        if value and value[0] == "Negate":
            found |= {-n for n in found}
    elif isinstance(value, dict):
        for entry in value.values():
            found |= _numbers_in(entry)
    return found


# "negative 4" is -4. "minus" is subtraction ("180 minus 116"), as is a spaced sign ("6x - 5").
WORDED_SIGN = re.compile(r"\bnegative\s+$", re.IGNORECASE)
SUBTRACTED = re.compile(rf"(?:[{MINUS}-]|\bminus)\s+$", re.IGNORECASE)
# Words after which a bare number is a size or a distance, not a signed value.
DIRECTION = re.compile(
    r"^\s*(?:units?\s+)?(?:down|up|left|right|across|places?|lower|higher)\b", re.IGNORECASE
)


def numbers_with_context(text: str) -> list[tuple[Fraction, bool]]:
    """Each number in the text, signed, and whether it may stand for the size of a stated
    negative: after a subtraction ("x - 5" when b is -5) or before a direction ("6 down")."""
    found: list[tuple[Fraction, bool]] = []
    for match in NUMBER.finditer(text):
        sign, digits = match.group(1), match.group(2)
        try:
            number = Fraction(Decimal(digits.replace(",", "")))
        except InvalidOperation:  # pragma: no cover - the pattern only matches digits
            continue
        negative = bool(sign) or bool(WORDED_SIGN.search(text[: match.start()]))
        size_only = bool(DIRECTION.match(text[match.end() :])) or bool(
            SUBTRACTED.search(text[: match.start()])
        )
        found.append((-number if negative else number, size_only))
    return found


def numbers_in_text(text: str) -> set[Fraction]:
    return {number for number, _ in numbers_with_context(text)}


def _equal(a: Any, b: Any) -> str | None:
    """None when maths-core finds a and b equivalent (pairs element by element), else why not."""
    try:
        same = equivalent(to_sympy(a), to_sympy(b))
    except MathJsonError as error:
        return str(error)
    return None if same else "they differ"


def check_record(record: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    claims = record["claims"]
    if not claims:
        problems.append("states no claims")
    for result, claim in zip(verify_claims([("claim", c) for c in claims]), claims, strict=True):
        if not result.verified:
            problems.append(f"claim {json.dumps(claim)} is not verified: {result.problem}")
    spec = record["spec"]
    for name, mine, theirs in (
        ("correct answer", spec["correctAnswer"], record["answer"]),
        ("predicted wrong answer", record.get("predicted"), spec["studentAnswer"]),
    ):
        if mine is None:
            problems.append(f"the scene gives no {name}")
            continue
        reason = _equal(mine, theirs)
        if reason:
            problems.append(f"{name} {json.dumps(mine)} is not {json.dumps(theirs)}: {reason}")
    stated = (
        _numbers_in(claims)
        | _numbers_in(spec["params"])
        | _numbers_in(spec["correctAnswer"])
        | _numbers_in(spec["studentAnswer"])
    )
    sizes = {abs(n) for n in stated}
    sources = [("narration", beat["narration"]) for beat in spec["beats"]]
    sources += [("label", label) for label in record["labels"]]
    for kind, text in sources:
        for number, directed in numbers_with_context(text):
            if number in stated or (directed and number in sizes):
                continue
            problems.append(f"{kind} states {number} with nothing to check it: {text!r}")
    return problems


def check(path: Path) -> int:
    lines = [line for line in path.read_bytes().decode().splitlines() if line.strip()]
    failures = 0
    for line in lines:
        record = json.loads(line)
        for problem in check_record(record):
            failures += 1
            print(f"{record['template']} seed {record['seed']}: {problem}")
    print(f"scene golden set: {len(lines)} specs, {failures} problems")
    return 0 if failures == 0 and lines else 1


def main(argv: list[str]) -> int:
    # Narration has minus signs (U+2212); the Windows console default cannot print them.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    if len(argv) == 3 and argv[1] == "inputs":
        text = json.dumps(inputs(), indent=1) + "\n"
        Path(argv[2]).write_bytes(text.encode())
        print(f"wrote {argv[2]}")
        return 0
    if len(argv) == 3 and argv[1] == "check":
        return check(Path(argv[2]))
    print("usage: python -m eddy_maths_core.scene_golden inputs|check PATH")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
