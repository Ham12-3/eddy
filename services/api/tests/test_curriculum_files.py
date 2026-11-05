"""The curriculum YAML is valid and consistent. No database needed; CI runs these on every push."""

import re
import shutil
from pathlib import Path

import pytest

from eddy_api.seed.__main__ import main
from eddy_api.seed.curriculum import CurriculumError, EdgeRow, find_cycle, load

CURRICULUM = Path(__file__).resolve().parents[3] / "curriculum"
DFE_RANGES = {"N": 16, "A": 25, "R": 16, "G": 25, "P": 9, "S": 6}


@pytest.fixture
def copy(tmp_path: Path) -> Path:
    """A writable copy of the curriculum, for planting faults."""
    target = tmp_path / "curriculum"
    shutil.copytree(CURRICULUM, target)
    return target


def edit(root: Path, relative: str, old: str, new: str) -> None:
    path = root / relative
    content = path.read_bytes().decode("utf-8")
    assert old in content, f"{old!r} not in {relative}"
    path.write_bytes(content.replace(old, new, 1).encode("utf-8"))


def problems(root: Path) -> list[str]:
    with pytest.raises(CurriculumError) as caught:
        load(root)
    return caught.value.problems


def test_the_curriculum_is_valid() -> None:
    curriculum = load(CURRICULUM)
    assert len(curriculum.misconceptions) >= 60
    assert len(curriculum.topics) == 13


def test_nodes_are_exactly_the_dfe_statements() -> None:
    codes = {node.code for node in load(CURRICULUM).nodes}
    expected = {f"{letter}{n}" for letter, top in DFE_RANGES.items() for n in range(1, top + 1)}
    assert codes == expected


def test_every_mvp_node_and_ancestor_declares_prerequisites() -> None:
    curriculum = load(CURRICULUM)
    closure = curriculum.mvp_nodes | curriculum.ancestors(curriculum.mvp_nodes)
    assert closure <= curriculum.declared


def test_every_distractor_rule_is_named_for_maths_core() -> None:
    rules = {
        rule["rule"]
        for m in load(CURRICULUM).misconceptions
        for rule in m.detect
        if rule["type"] == "distractor"
    }
    # maths-core (M3) must implement every one of these names.
    assert all(re.fullmatch(r"[a-z][a-z0-9_]+", rule) for rule in rules)
    assert len(rules) >= 60


def test_find_cycle_returns_the_cycle() -> None:
    edges = [EdgeRow("B", "A", 1.0), EdgeRow("C", "B", 1.0), EdgeRow("A", "C", 1.0)]
    cycle = find_cycle(edges)
    assert cycle is not None
    assert cycle[0] == cycle[-1]
    assert set(cycle) == {"A", "B", "C"}
    assert find_cycle(edges[:2]) is None


def test_a_planted_cycle_fails(copy: Path) -> None:
    # N9 builds on N6, which builds on N2, which builds on N1: N1 needing N9 closes a loop.
    edit(copy, "maths/prerequisites.yaml", "  N1: []", "  N1:\n    - { code: N9, strength: 0.5 }")
    found = problems(copy)
    assert any("cycle" in p and "N1" in p and "N9" in p for p in found), found


def test_an_unknown_prerequisite_fails(copy: Path) -> None:
    edit(
        copy,
        "maths/prerequisites.yaml",
        "{ code: N1, strength: 0.5 }",
        "{ code: N99, strength: 0.5 }",
    )
    found = problems(copy)
    assert any("does not match" in p or "unknown" in p for p in found), found


def test_an_undeclared_ancestor_fails(copy: Path) -> None:
    edit(copy, "maths/prerequisites.yaml", "  G1: []\n", "")
    assert any("G1 is an MVP node or ancestor" in p for p in problems(copy))


def test_a_schema_error_names_the_file_and_path(copy: Path) -> None:
    edit(
        copy,
        "maths/misconceptions.yaml",
        "    evidence: brief-s2\n",
        "",
    )
    found = problems(copy)
    assert any(
        p.startswith("maths/misconceptions.yaml: misconceptions/") and "'evidence'" in p
        for p in found
    ), found


def test_a_duplicate_key_fails(copy: Path) -> None:
    edit(copy, "maths/prerequisites.yaml", "  G1: []\n", "  G1: []\n  G1: []\n")
    assert any("duplicate key 'G1'" in p for p in problems(copy))


def test_an_in_copyright_text_cannot_be_shown_in_full(copy: Path) -> None:
    edit(
        copy,
        "english/set_texts.yaml",
        "author: J. B. Priestley\n    copyright: IN_COPYRIGHT\n    display: REFERENCE_ONLY",
        "author: J. B. Priestley\n    copyright: IN_COPYRIGHT\n    display: FULL_TEXT",
    )
    assert any(p.startswith("english/set_texts.yaml: set_texts/") for p in problems(copy))


def test_a_misconception_on_an_unrelated_node_fails(copy: Path) -> None:
    edit(copy, "maths/misconceptions.yaml", "    node: S4\n", "    node: S6\n")
    assert any("not an MVP node or ancestor" in p for p in problems(copy))


def test_an_en_dash_in_student_text_fails(copy: Path) -> None:
    edit(copy, "maths/misconceptions.yaml", "On a number line", "On a number line " + chr(0x2013))
    assert any("does not match" in p for p in problems(copy))


def test_an_unknown_level_set_fails(copy: Path) -> None:
    edit(copy, "english/question_types.yaml", "levels: summary\n", "levels: summarise\n")
    assert any("unknown level set summarise" in p for p in problems(copy))


def test_the_check_command(copy: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--check", "--curriculum", str(CURRICULUM)]) == 0
    assert "is valid" in capsys.readouterr().out
    edit(copy, "maths/prerequisites.yaml", "  G1: []\n", "")
    assert main(["--check", "--curriculum", str(copy)]) == 1
    assert "G1 is an MVP node or ancestor" in capsys.readouterr().err


def test_anchors_and_aliases_are_refused(copy: Path) -> None:
    edit(copy, "maths/prerequisites.yaml", "  N1: []", "  N1: &empty []\n  N3x: *empty")
    assert any("aliases are not allowed" in p for p in problems(copy))


def test_a_code_with_a_trailing_newline_is_refused(copy: Path) -> None:
    edit(copy, "maths/nodes.yaml", "    - code: N16\n", '    - code: "N16\\n"\n')
    assert any("is not a node code" in p for p in problems(copy))


def test_an_impossible_date_is_a_problem_not_a_crash(copy: Path) -> None:
    edit(copy, "specs.yaml", "valid_from: 2015-09-01", "valid_from: 2015-13-45")
    assert any("month must be in 1..12" in p for p in problems(copy))
