"""Idempotent upsert of a validated curriculum, by natural key (ADR-0021).

`seed` changes only what differs from the YAML and reports every change. It never commits:
the caller commits, or rolls back for a dry run.

- Link rows (prerequisite edges, topic nodes, level descriptors) are kept exactly in step with
  the YAML, including edges that touch a node the YAML no longer has.
- Nodes, topics, misconceptions and set texts missing from the YAML are retired (`retired_at`),
  never deleted, because attempts and states may point at them. Retired rows are not served.
  A retired row that comes back to the YAML is restored.
- Specifications and question types missing from the YAML are reported as orphaned.
"""

from collections.abc import Callable, Hashable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from eddy_api.db.base import Base
from eddy_api.db.models import (
    CurriculumNode,
    CurriculumSpec,
    LevelDescriptor,
    Misconception,
    NodePrerequisite,
    QuestionType,
    SetText,
    Topic,
    TopicNode,
)
from eddy_api.seed.curriculum import Curriculum, SpecKey, SpecRow


@dataclass
class TableDiff:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    retired: list[str] = field(default_factory=list)
    orphaned: list[str] = field(default_factory=list)

    @property
    def changes(self) -> int:
        return len(self.created) + len(self.updated) + len(self.deleted) + len(self.retired)


@dataclass
class SeedReport:
    tables: dict[str, TableDiff] = field(default_factory=dict)

    def table(self, name: str) -> TableDiff:
        return self.tables.setdefault(name, TableDiff())

    @property
    def changes(self) -> int:
        return sum(diff.changes for diff in self.tables.values())

    def render(self, *, verbose: bool = False) -> str:
        lines = []
        for name, diff in self.tables.items():
            lines.append(
                f"{name}: {len(diff.created)} created, {len(diff.updated)} updated, "
                f"{len(diff.deleted)} deleted, {len(diff.retired)} retired, "
                f"{len(diff.orphaned)} orphaned"
            )
            if verbose:
                for verb, labels in (
                    ("create", diff.created),
                    ("update", diff.updated),
                    ("delete", diff.deleted),
                    ("retire", diff.retired),
                    ("orphan", diff.orphaned),
                ):
                    lines.extend(f"  {verb} {label}" for label in labels)
        lines.append(f"{self.changes} changes")
        return "\n".join(lines)


class _Retirable(Protocol):
    retired_at: datetime | None


def _upsert[K: Hashable, R: Base](
    session: Session,
    diff: TableDiff,
    existing: Mapping[K, R],
    key: K,
    label: str,
    make: Callable[..., R],
    values: Mapping[str, Any],
) -> R:
    row = existing.get(key)
    if row is None:
        row = make(**values)
        session.add(row)
        diff.created.append(label)
        return row
    changed = [name for name, value in values.items() if getattr(row, name) != value]
    for name in changed:
        setattr(row, name, values[name])
    if changed:
        diff.updated.append(f"{label} ({', '.join(changed)})")
    return row


def _retire(diff: TableDiff, rows: Iterable[tuple[str, _Retirable]], now: datetime) -> None:
    for label, row in rows:
        if row.retired_at is None:
            row.retired_at = now
            diff.retired.append(label)


def _spec_label(key: SpecKey) -> str:
    return " ".join(key)


def _seed_specs(session: Session, curriculum: Curriculum, report: SeedReport) -> dict[SpecKey, Any]:
    diff = report.table("curriculum_spec")
    existing = {
        (s.board, s.spec_code, s.version): s for s in session.scalars(select(CurriculumSpec))
    }
    ids: dict[SpecKey, Any] = {}

    def upsert(spec: SpecRow) -> None:
        row = _upsert(
            session,
            diff,
            existing,
            spec.key,
            _spec_label(spec.key),
            CurriculumSpec,
            {
                "board": spec.board,
                "qualification": spec.qualification,
                "spec_code": spec.spec_code,
                "version": spec.version,
                "title": spec.title,
                "content_spec_id": ids[spec.content] if spec.content else None,
                "papers": spec.papers,
                "valid_from": spec.valid_from,
                "valid_to": spec.valid_to,
            },
        )
        session.flush()
        ids[spec.key] = row.id

    # The DfE subject content first, so exam board specs can point at it.
    for spec in sorted(curriculum.specs, key=lambda s: s.content is not None):
        upsert(spec)
    diff.orphaned.extend(_spec_label(key) for key in existing if key not in ids)
    return ids


def seed(session: Session, curriculum: Curriculum) -> SeedReport:
    """Bring the database in line with `curriculum` and report what changed. Does not commit."""
    report = SeedReport()
    now = datetime.now(UTC)
    spec_ids = _seed_specs(session, curriculum, report)

    # Nodes belong to the DfE subject content (ADR-0021). Every node of that spec is loaded,
    # retired ones included, so edges touching them can be found and removed.
    node_spec_id = spec_ids[curriculum.node_spec]
    diff = report.table("curriculum_node")
    existing_nodes = {
        n.code: n
        for n in session.scalars(
            select(CurriculumNode).where(CurriculumNode.spec_id == node_spec_id)
        )
    }
    wanted_codes = {node.code for node in curriculum.nodes}
    for node in curriculum.nodes:
        existing_nodes[node.code] = _upsert(
            session,
            diff,
            existing_nodes,
            node.code,
            node.code,
            CurriculumNode,
            {
                "spec_id": node_spec_id,
                "code": node.code,
                "title": node.title,
                "description": node.description,
                "strand": node.strand,
                "tier": node.tier,
                "higher_extension": node.higher,
                "visual_suitability": node.visual,
                "retired_at": None,
            },
        )
    _retire(diff, ((c, n) for c, n in existing_nodes.items() if c not in wanted_codes), now)
    session.flush()
    ids = {code: row.id for code, row in existing_nodes.items()}
    codes_by_id = {row_id: code for code, row_id in ids.items()}

    diff = report.table("node_prerequisite")
    spec_node_ids = list(codes_by_id)
    existing_edges = {
        (
            codes_by_id.get(e.node_id, str(e.node_id)),
            codes_by_id.get(e.prerequisite_node_id, str(e.prerequisite_node_id)),
        ): e
        for e in session.scalars(
            select(NodePrerequisite).where(
                or_(
                    NodePrerequisite.node_id.in_(spec_node_ids),
                    NodePrerequisite.prerequisite_node_id.in_(spec_node_ids),
                )
            )
        )
    }
    wanted_edges = set()
    for edge in curriculum.edges:
        pair = (edge.node, edge.prerequisite)
        wanted_edges.add(pair)
        _upsert(
            session,
            diff,
            existing_edges,
            pair,
            f"{edge.node} needs {edge.prerequisite}",
            NodePrerequisite,
            {
                "node_id": ids[edge.node],
                "prerequisite_node_id": ids[edge.prerequisite],
                "strength": edge.strength,
            },
        )
    for pair, edge_row in existing_edges.items():
        if pair not in wanted_edges:
            session.delete(edge_row)
            diff.deleted.append(f"{pair[0]} needs {pair[1]}")

    diff = report.table("topic")
    existing_topics = {t.slug: t for t in session.scalars(select(Topic))}
    topic_ids: dict[str, Any] = {}
    for topic in curriculum.topics:
        topic_row = _upsert(
            session,
            diff,
            existing_topics,
            topic.slug,
            topic.slug,
            Topic,
            {
                "slug": topic.slug,
                "title": topic.title,
                "sort_order": topic.sort_order,
                "scene_primitive": topic.primitive,
                "retired_at": None,
            },
        )
        session.flush()
        topic_ids[topic.slug] = topic_row.id
    _retire(diff, ((s, t) for s, t in existing_topics.items() if s not in topic_ids), now)

    diff = report.table("topic_node")
    slugs_by_id = {topic_id: slug for slug, topic_id in topic_ids.items()}
    existing_links = {
        (slugs_by_id[link.topic_id], codes_by_id.get(link.node_id, str(link.node_id))): link
        for link in session.scalars(
            select(TopicNode).where(TopicNode.topic_id.in_(list(slugs_by_id)))
        )
    }
    wanted_links = set()
    for topic in curriculum.topics:
        for code in topic.nodes:
            pair = (topic.slug, code)
            wanted_links.add(pair)
            _upsert(
                session,
                diff,
                existing_links,
                pair,
                f"{topic.slug} {code}",
                TopicNode,
                {"topic_id": topic_ids[topic.slug], "node_id": ids[code]},
            )
    for pair, link in existing_links.items():
        if pair not in wanted_links:
            session.delete(link)
            diff.deleted.append(f"{pair[0]} {pair[1]}")

    diff = report.table("misconception")
    existing_misconceptions = {m.code: m for m in session.scalars(select(Misconception))}
    for m in curriculum.misconceptions:
        _upsert(
            session,
            diff,
            existing_misconceptions,
            m.code,
            m.code,
            Misconception,
            {
                "node_id": ids[m.node],
                "code": m.code,
                "title": m.title,
                "student_facing_description": m.student,
                "teacher_description": m.teacher,
                "detection_rules": m.detect,
                "remediation_template": m.scene,
                "recheck_family": m.recheck,
                "evidence_source": m.evidence,
                "retired_at": None,
            },
        )
    wanted_misconceptions = {m.code for m in curriculum.misconceptions}
    _retire(
        diff,
        ((c, m) for c, m in existing_misconceptions.items() if c not in wanted_misconceptions),
        now,
    )

    diff = report.table("set_text")
    existing_texts = {(t.board, t.title): t for t in session.scalars(select(SetText))}
    for text in curriculum.set_texts:
        _upsert(
            session,
            diff,
            existing_texts,
            (text.board, text.title),
            f"{text.board} {text.title}",
            SetText,
            {
                "board": text.board,
                "title": text.title,
                "author": text.author,
                "category": text.category,
                "copyright_status": text.copyright,
                "display_policy": text.display,
                "notes": text.notes,
                "retired_at": None,
            },
        )
    wanted_texts = {(t.board, t.title) for t in curriculum.set_texts}
    _retire(
        diff,
        ((f"{b} {t}", row) for (b, t), row in existing_texts.items() if (b, t) not in wanted_texts),
        now,
    )

    diff = report.table("question_type")
    levels_diff = report.table("level_descriptor")
    existing_types = {
        (q.spec_id, q.paper, q.number): q for q in session.scalars(select(QuestionType))
    }
    wanted_types = set()
    for q in curriculum.question_types:
        key = (spec_ids[q.spec], q.paper, q.number)
        wanted_types.add(key)
        label = f"{_spec_label(q.spec)} paper {q.paper} question {q.number}"
        type_row = _upsert(
            session,
            diff,
            existing_types,
            key,
            label,
            QuestionType,
            {
                "spec_id": spec_ids[q.spec],
                "paper": q.paper,
                "number": q.number,
                "marks": q.marks,
                "aos": list(q.aos),
                "suggested_minutes": q.minutes,
                "task_summary_own_words": q.task,
            },
        )
        session.flush()
        existing_levels = {
            d.level: d
            for d in session.scalars(
                select(LevelDescriptor).where(LevelDescriptor.question_type_id == type_row.id)
            )
        }
        for level, summary in enumerate(q.levels, start=1):
            _upsert(
                session,
                levels_diff,
                existing_levels,
                level,
                f"{label} level {level}",
                LevelDescriptor,
                {"question_type_id": type_row.id, "level": level, "summary_own_words": summary},
            )
        for level, descriptor in existing_levels.items():
            if level > len(q.levels):
                session.delete(descriptor)
                levels_diff.deleted.append(f"{label} level {level}")
    diff.orphaned.extend(
        f"{spec_id} paper {paper} question {number}"
        for spec_id, paper, number in existing_types
        if (spec_id, paper, number) not in wanted_types
    )

    session.flush()
    return report
