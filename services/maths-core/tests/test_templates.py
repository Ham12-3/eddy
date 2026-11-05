"""Property tests for every item template (SPEC.md section 7.3, ADR-0022).

For any seed: the item builds; its answer, sent back as MathJSON, is marked correct; every
distractor is wrong, distinct, equal to its rule applied to the parameters, and recognised as
its own misconception; and the stem never contains an en or em dash.
"""

import re

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.items import ALL, Template
from eddy_maths_core.rules import RULES
from eddy_maths_core.serialize import answer_mathjson, to_mathjson
from eddy_maths_core.verify import check_answer

seeds = st.integers(min_value=0, max_value=2**31 - 1)
DASHES = re.compile("[" + chr(0x2013) + chr(0x2014) + "]")


@pytest.mark.parametrize("template", ALL, ids=lambda t: t.id)
@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(seed=seeds)
def test_every_item_is_consistent(template: Template, seed: int) -> None:
    item = template.generate(seed)
    assert item == template.generate(seed), "the same seed must give the same item"
    assert not DASHES.search(item.stem)

    own = check_answer(item, answer_mathjson(item.answer, item.answer_format))
    assert own.correct, (item.stem, item.answer, own)

    values = [d.value for d in item.distractors]
    for index, distractor in enumerate(item.distractors):
        assert equivalent(
            distractor.value, RULES[distractor.rule](item.params), ratio=template.ratio
        )
        assert not equivalent(distractor.value, item.answer, ratio=template.ratio)
        for other in values[index + 1 :]:
            assert not equivalent(distractor.value, other, ratio=template.ratio)
        result = check_answer(item, to_mathjson(distractor.value))
        assert not result.equivalent
        assert distractor.misconception in result.misconceptions, (item.stem, distractor)


@pytest.mark.parametrize("template", [t for t in ALL if t.misconceptions], ids=lambda t: t.id)
def test_every_rule_on_a_template_shows_itself_for_some_seed(template: Template) -> None:
    seen = {d.misconception for seed in range(60) for d in template.generate(seed).distractors}
    assert seen == set(template.misconceptions)


def test_every_registered_rule_is_used_by_a_template() -> None:
    used = {rule for t in ALL for rule in t.misconceptions.values()}
    assert used == set(RULES)
