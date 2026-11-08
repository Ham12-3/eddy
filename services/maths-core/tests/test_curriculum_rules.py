"""maths-core and curriculum/maths agree: every rule the YAML names exists, every template's
misconceptions match the YAML, every re-check family has a template, and no student-facing
misconception text contains the answer to an item that can trigger it."""

import re
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
import yaml

from eddy_maths_core.items import ALL
from eddy_maths_core.rules import RULES
from eddy_maths_core.serialize import answer_mathjson
from eddy_maths_core.verify import STRUCTURES

CURRICULUM = Path(__file__).resolve().parents[3] / "curriculum" / "maths"


def _load(name: str) -> Any:
    return yaml.safe_load((CURRICULUM / name).read_text(encoding="utf-8"))


LIBRARY = {m["code"]: m for m in _load("misconceptions.yaml")["misconceptions"]}
MVP_NODES = {code for topic in _load("topics.yaml")["topics"] for code in topic["nodes"]}


def _rules(kind: str) -> dict[str, str]:
    """Misconception code to rule name, for one rule type."""
    return {
        code: rule["rule"]
        for code, m in LIBRARY.items()
        for rule in m["detect"]
        if rule["type"] == kind
    }


def test_every_rule_the_yaml_names_is_implemented() -> None:
    assert set(_rules("distractor").values()) <= set(RULES)
    assert set(_rules("structure").values()) <= set(STRUCTURES)


@pytest.mark.parametrize("template", ALL, ids=lambda t: t.id)
def test_template_misconceptions_match_the_yaml(template: Any) -> None:
    for code, rule_name in template.misconceptions.items():
        assert _rules("distractor").get(code) == rule_name, code
    for code, rule_name in template.structures.items():
        assert _rules("structure").get(code) == rule_name, code


def test_every_rule_based_misconception_is_on_a_template() -> None:
    on_templates = {code for t in ALL for code in [*t.misconceptions, *t.structures]}
    assert set(_rules("distractor")) | set(_rules("structure")) <= on_templates


def test_every_recheck_family_has_a_template() -> None:
    families = {t.family for t in ALL}
    assert {m["recheck"] for m in LIBRARY.values()} <= families


def test_every_mvp_node_has_three_templates() -> None:
    counts = Counter(t.node for t in ALL)
    assert {node: counts[node] for node in MVP_NODES if counts[node] < 3} == {}


def _written(value: Any) -> str:
    if isinstance(value, dict):
        return str(value["num"])
    if isinstance(value, list) and value[:1] == ["Rational"]:
        return f"{value[1]}/{value[2]}"
    return str(value)


@pytest.mark.parametrize(
    "template", [t for t in ALL if t.misconceptions or t.structures], ids=lambda t: t.id
)
def test_student_text_never_contains_the_answer(template: Any) -> None:
    """The text shown after a slip names the idea; it must not hand over this item's answer."""
    codes = [*template.misconceptions, *template.structures]
    for seed in range(40):
        item = template.generate(seed)
        answer = _written(answer_mathjson(item.answer, item.answer_format))
        if len(answer) < 2:
            continue  # a single digit appears in ordinary prose ("5 parts")
        for code in codes:
            numbers = re.findall(r"\d+(?:[./]\d+)?", LIBRARY[code]["student"])
            assert answer not in numbers, (code, item.stem, answer)
