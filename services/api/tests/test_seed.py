"""The seed is an idempotent upsert by natural key, with a dry run that writes nothing."""

import dataclasses
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from eddy_api.config import Settings
from eddy_api.db.base import Base
from eddy_api.db.models import CurriculumNode, CurriculumSpec, Misconception, NodePrerequisite
from eddy_api.seed import __main__ as seed_command
from eddy_api.seed.curriculum import Curriculum, load
from eddy_api.seed.upsert import seed

CURRICULUM = Path(__file__).resolve().parents[3] / "curriculum"


def count(session: Session, model: type[Base]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_the_second_run_reports_zero_changes(db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    first = seed(db_session, curriculum)
    assert first.table("curriculum_node").created == [n.code for n in curriculum.nodes]
    assert count(db_session, NodePrerequisite) == len(curriculum.edges)

    # Reload every row from the database, so the comparison sees stored values, not cached ones.
    db_session.expire_all()
    second = seed(db_session, curriculum)
    assert second.changes == 0, second.render(verbose=True)


def test_a_dry_run_writes_nothing(db_session: Session) -> None:
    report = seed(db_session, load(CURRICULUM))
    assert report.changes > 0
    db_session.rollback()
    assert count(db_session, CurriculumSpec) == 0
    assert count(db_session, Misconception) == 0


def test_a_changed_title_is_one_update(db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    seed(db_session, curriculum)
    nodes = tuple(
        dataclasses.replace(n, title="Fractions, decimals and integers") if n.code == "N2" else n
        for n in curriculum.nodes
    )
    report = seed(db_session, dataclasses.replace(curriculum, nodes=nodes))
    assert report.changes == 1
    assert report.table("curriculum_node").updated == ["N2 (title)"]
    title = db_session.scalar(select(CurriculumNode.title).where(CurriculumNode.code == "N2"))
    assert title == "Fractions, decimals and integers"


def test_a_removed_edge_is_deleted(db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    seed(db_session, curriculum)
    edges = tuple(e for e in curriculum.edges if (e.node, e.prerequisite) != ("A9", "A17"))
    report = seed(db_session, dataclasses.replace(curriculum, edges=edges))
    assert report.changes == 1
    assert report.table("node_prerequisite").deleted == ["A9 needs A17"]


def test_a_removed_misconception_is_retired_then_restored(db_session: Session) -> None:
    curriculum: Curriculum = load(CURRICULUM)
    seed(db_session, curriculum)
    kept = tuple(m for m in curriculum.misconceptions if m.code != "MODE_AS_FREQUENCY")
    report = seed(db_session, dataclasses.replace(curriculum, misconceptions=kept))
    assert report.changes == 1
    assert report.table("misconception").retired == ["MODE_AS_FREQUENCY"]
    retired = db_session.scalar(
        select(Misconception.retired_at).where(Misconception.code == "MODE_AS_FREQUENCY")
    )
    assert retired is not None
    assert count(db_session, Misconception) == len(curriculum.misconceptions)

    restored = seed(db_session, curriculum)
    assert restored.table("misconception").updated == ["MODE_AS_FREQUENCY (retired_at)"]
    assert restored.changes == 1


def test_a_removed_node_is_retired_and_its_edges_deleted(db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    seed(db_session, curriculum)
    smaller = dataclasses.replace(
        curriculum,
        nodes=tuple(n for n in curriculum.nodes if n.code != "N5"),
        edges=tuple(e for e in curriculum.edges if "N5" not in (e.node, e.prerequisite)),
        declared=curriculum.declared - {"N5"},
    )
    report = seed(db_session, smaller)
    assert report.table("curriculum_node").retired == ["N5"]
    assert report.table("node_prerequisite").deleted == ["P7 needs N5"]
    assert report.changes == 2
    assert seed(db_session, smaller).changes == 0


def test_removed_links_and_levels_are_deleted(db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    seed(db_session, curriculum)
    topics = tuple(
        dataclasses.replace(t, nodes=("R4", "R5", "R6")) if t.slug == "ratio" else t
        for t in curriculum.topics
    )
    question_types = tuple(
        dataclasses.replace(q, levels=q.levels[:4]) if len(q.levels) == 6 else q
        for q in curriculum.question_types
    )
    report = seed(
        db_session,
        dataclasses.replace(curriculum, topics=topics, question_types=question_types),
    )
    assert report.table("topic_node").deleted == ["ratio R7"]
    shortened = sum(1 for q in curriculum.question_types if len(q.levels) == 6)
    assert len(report.table("level_descriptor").deleted) == 2 * shortened
    assert report.changes == 1 + 2 * shortened


def test_the_command_refuses_a_remote_database(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    remote = Settings(database_url=SecretStr("postgresql+psycopg://eddy:x@db.example.com/eddy"))
    monkeypatch.setattr(seed_command, "get_settings", lambda: remote)
    assert seed_command.main(["--curriculum", str(CURRICULUM)]) == 2
    assert "Refusing" in capsys.readouterr().err


def test_the_command_dry_run_writes_nothing(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(seed_command, "session_factory", lambda: lambda: db_session)
    assert seed_command.main(["--dry-run", "--curriculum", str(CURRICULUM)]) == 0
    assert "Dry run: nothing was written." in capsys.readouterr().out
    assert count(db_session, CurriculumSpec) == 0
