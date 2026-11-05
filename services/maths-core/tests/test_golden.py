"""The maths golden set stays at 100% (SPEC.md section 7.6, PLAN.md M3)."""

from pathlib import Path

from eddy_maths_core.golden import SIZE, check, check_record, record

GOLDEN = Path(__file__).resolve().parents[3] / "evals" / "golden" / "maths" / "items.jsonl"


def test_every_golden_item_verifies() -> None:
    count, problems = check(GOLDEN)
    assert count == SIZE
    assert problems == []


def test_a_changed_answer_is_caught() -> None:
    entry = record("a17-two-step", 1000)
    entry["answer"] = 999
    assert any("not marked correct" in p for p in check_record(entry))


def test_a_misattributed_distractor_is_caught() -> None:
    entry = record("n2-fraction-add-unlike", 1000)
    entry["distractors"][0]["misconception"] = "FRAC_SUB_NUM_DEN"
    assert any("not recognised" in p for p in check_record(entry))
