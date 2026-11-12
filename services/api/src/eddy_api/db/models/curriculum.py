"""Curriculum, the question bank and misconceptions. Seeded from /curriculum YAML (ADR-0021)."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk

BOARDS = ("DFE", "AQA", "EDEXCEL", "OCR")
QUALIFICATIONS = ("MATHS", "ENG_LANG", "ENG_LIT")
STRANDS = ("NUMBER", "ALGEBRA", "RATIO", "GEOMETRY", "PROBABILITY", "STATISTICS")
TIERS = ("FOUNDATION", "HIGHER_ONLY")
COMMAND_WORDS = (
    "CALCULATE",
    "WORK_OUT",
    "SHOW_THAT",
    "EXPLAIN",
    "ESTIMATE",
    "SIMPLIFY",
    "EXPAND",
    "FACTORISE",
    "SOLVE",
    "WRITE",
    "COMPLETE",
)
PROVENANCES = ("TEMPLATE", "LLM_ASSISTED", "HUMAN")


class CurriculumSpec(Base):
    """A specification: the DfE subject content, or an exam board's specification built on it."""

    __tablename__ = "curriculum_spec"
    __table_args__ = (UniqueConstraint("board", "spec_code", "version"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    board: Mapped[str] = mapped_column(checked_enum("board", *BOARDS))
    qualification: Mapped[str] = mapped_column(checked_enum("qualification", *QUALIFICATIONS))
    spec_code: Mapped[str] = mapped_column(String(32))
    version: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    # Exam board specifications point at the DfE subject content their nodes come from.
    content_spec_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("curriculum_spec.id")
    )
    # Paper structure, timings, marks and calculator rules, in our own words.
    papers: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)


class CurriculumNode(Base):
    """One DfE subject content statement, such as N2 or A17."""

    __tablename__ = "curriculum_node"
    __table_args__ = (
        UniqueConstraint("spec_id", "code"),
        CheckConstraint("visual_suitability BETWEEN 1 AND 3", name="visual_suitability"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    spec_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_spec.id"))
    code: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    strand: Mapped[str] = mapped_column(checked_enum("strand", *STRANDS))
    tier: Mapped[str] = mapped_column(checked_enum("tier", *TIERS))
    # The part of a Foundation statement that only Higher students study, if any.
    higher_extension: Mapped[str | None] = mapped_column(Text)
    visual_suitability: Mapped[int] = mapped_column(SmallInteger)
    exam_weight_hint: Mapped[float | None] = mapped_column(Numeric(4, 2))
    # Set by the seed when the node leaves the YAML; retired rows are kept but never served.
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NodePrerequisite(Base):
    """An edge of the prerequisite DAG: `node` builds on `prerequisite_node`."""

    __tablename__ = "node_prerequisite"
    __table_args__ = (
        CheckConstraint("node_id <> prerequisite_node_id", name="not_self"),
        CheckConstraint("strength > 0 AND strength <= 1", name="strength"),
    )

    node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("curriculum_node.id", ondelete="CASCADE"), primary_key=True
    )
    prerequisite_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("curriculum_node.id", ondelete="CASCADE"), primary_key=True
    )
    strength: Mapped[float] = mapped_column(Float)


class Topic(Base):
    """One of the MVP's learning topics (SPEC.md section 2.2), grouping one or more nodes."""

    __tablename__ = "topic"

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(SmallInteger)
    scene_primitive: Mapped[str] = mapped_column(String(64))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TopicNode(Base):
    __tablename__ = "topic_node"

    topic_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("topic.id", ondelete="CASCADE"), primary_key=True
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("curriculum_node.id", ondelete="CASCADE"), primary_key=True
    )


class Misconception(Base):
    __tablename__ = "misconception"

    id: Mapped[uuid.UUID] = uuid_pk()
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_node.id"))
    code: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(Text)
    student_facing_description: Mapped[str] = mapped_column(Text)
    teacher_description: Mapped[str] = mapped_column(Text)
    # Rule language (ADR-0022): distractor, structure and classifier rules, run by maths-core.
    detection_rules: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    remediation_template: Mapped[str | None] = mapped_column(String(128))
    recheck_family: Mapped[str | None] = mapped_column(String(128))
    evidence_source: Mapped[str] = mapped_column(Text)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ItemFamily(Base):
    """Items generated from the same template; used for reviews and re-check items."""

    __tablename__ = "item_family"

    id: Mapped[uuid.UUID] = uuid_pk()
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_node.id"))
    key: Mapped[str] = mapped_column(String(128), unique=True)
    template_id: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text)


class Item(Base):
    """A question in the bank. Every value is verified by maths-core (cas_verified_at)."""

    __tablename__ = "item"
    __table_args__ = (CheckConstraint("marks BETWEEN 1 AND 6", name="marks"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_node.id"))
    family_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("item_family.id"))
    template_id: Mapped[str] = mapped_column(String(128))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # maths-core regenerates the item from its template and seed (M7).
    seed: Mapped[int | None] = mapped_column(Integer)
    stem_markdown: Mapped[str] = mapped_column(Text)
    answer_canonical: Mapped[str] = mapped_column(Text)
    answer_format: Mapped[dict[str, Any]] = mapped_column(JSONB)
    calculator_allowed: Mapped[bool] = mapped_column(Boolean)
    command_word: Mapped[str] = mapped_column(checked_enum("command_word", *COMMAND_WORDS))
    marks: Mapped[int] = mapped_column(SmallInteger)
    elo_difficulty: Mapped[float] = mapped_column(Float, default=1500.0)
    # [{value, misconception_code}], each equal to its misconception rule applied to params.
    distractors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    cas_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provenance: Mapped[str] = mapped_column(checked_enum("provenance", *PROVENANCES))
    attempts_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at()
