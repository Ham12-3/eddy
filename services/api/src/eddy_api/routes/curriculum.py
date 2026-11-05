"""Read-only curriculum: specifications, nodes, the prerequisite graph, topics and misconceptions.

Every role may read it. Nodes come from the DfE subject content (ADR-0021); exam board
specifications point at that content rather than copying it. Retired rows are never served.
Students and parents see a misconception's student wording only: the teacher wording and the
detection rules (which say how each wrong option is made) are for admins and machine callers.
"""

from collections import Counter
from datetime import date
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api.auth import ROLES, Caller, require_roles
from eddy_api.db.models import (
    CurriculumNode,
    CurriculumSpec,
    Misconception,
    NodePrerequisite,
    Topic,
    TopicNode,
)
from eddy_api.db.session import get_session

Board = Literal["DFE", "AQA", "EDEXCEL", "OCR"]
Qualification = Literal["MATHS", "ENG_LANG", "ENG_LIT"]
Strand = Literal["NUMBER", "ALGEBRA", "RATIO", "GEOMETRY", "PROBABILITY", "STATISTICS"]
Tier = Literal["FOUNDATION", "HIGHER_ONLY"]
STRAND_ORDER: tuple[Strand, ...] = (
    "NUMBER",
    "ALGEBRA",
    "RATIO",
    "GEOMETRY",
    "PROBABILITY",
    "STATISTICS",
)

router = APIRouter(prefix="/v1/curriculum", tags=["curriculum"])
AnyCaller = Annotated[Caller, Depends(require_roles(*ROLES))]
DbSession = Annotated[Session, Depends(get_session)]


class Paper(BaseModel):
    paper: str
    minutes: int
    marks: int
    tiers: list[Literal["FOUNDATION", "HIGHER"]] | None = None
    calculator: bool | None = None
    focus: str | None = None


class Spec(BaseModel):
    board: Board
    qualification: Qualification
    spec_code: str
    version: str
    title: str
    papers: list[Paper]
    valid_from: date
    valid_to: date | None


class Prerequisite(BaseModel):
    code: str
    strength: float


class NodeSummary(BaseModel):
    code: str
    title: str
    strand: Strand
    tier: Tier
    visual_suitability: int
    prerequisites: list[Prerequisite]
    misconception_count: int


class DetectionRule(BaseModel):
    type: Literal["distractor", "structure", "classifier"]
    rule: str | None = None


class MisconceptionOut(BaseModel):
    code: str
    node: str
    title: str
    student_facing_description: str
    # None for students and parents.
    teacher_description: str | None
    detection_rules: list[DetectionRule] | None
    remediation_template: str | None
    recheck_family: str | None
    evidence_source: str


class NodeDetail(NodeSummary):
    description: str
    higher_extension: str | None
    dependents: list[str]
    topics: list[str]
    misconceptions: list[MisconceptionOut]


class TopicOut(BaseModel):
    slug: str
    title: str
    sort_order: int
    scene_primitive: str
    nodes: list[str]


def _node_order(node: CurriculumNode) -> tuple[int, int]:
    strand = STRAND_ORDER.index(node.strand) if node.strand in STRAND_ORDER else len(STRAND_ORDER)
    return (strand, int(node.code[1:]))


def _content_nodes(session: Session) -> list[CurriculumNode]:
    """Nodes of the newest DfE maths subject content, in strand then statement order."""
    spec_id = session.scalar(
        select(CurriculumSpec.id)
        .where(CurriculumSpec.board == "DFE", CurriculumSpec.qualification == "MATHS")
        .order_by(CurriculumSpec.version.desc())
        .limit(1)
    )
    if spec_id is None:
        return []
    nodes = session.scalars(
        select(CurriculumNode).where(
            CurriculumNode.spec_id == spec_id, CurriculumNode.retired_at.is_(None)
        )
    )
    return sorted(nodes, key=_node_order)


def _sees_internals(caller: Caller) -> bool:
    return caller.role in ("admin", "system")


def _misconception_out(m: Misconception, code: str, caller: Caller) -> MisconceptionOut:
    rules: list[dict[str, Any]] = m.detection_rules
    internals = _sees_internals(caller)
    return MisconceptionOut(
        code=m.code,
        node=code,
        title=m.title,
        student_facing_description=m.student_facing_description,
        teacher_description=m.teacher_description if internals else None,
        detection_rules=[DetectionRule.model_validate(rule) for rule in rules]
        if internals
        else None,
        remediation_template=m.remediation_template,
        recheck_family=m.recheck_family,
        evidence_source=m.evidence_source,
    )


@router.get("/specs", operation_id="listCurriculumSpecs")
def list_specs(_: AnyCaller, session: DbSession) -> list[Spec]:
    specs = session.scalars(
        select(CurriculumSpec).order_by(
            CurriculumSpec.qualification, CurriculumSpec.board, CurriculumSpec.spec_code
        )
    )
    return [
        Spec(
            board=cast(Board, s.board),
            qualification=cast(Qualification, s.qualification),
            spec_code=s.spec_code,
            version=s.version,
            title=s.title,
            papers=[Paper.model_validate(p) for p in s.papers],
            valid_from=s.valid_from,
            valid_to=s.valid_to,
        )
        for s in specs
    ]


@router.get("/nodes", operation_id="listCurriculumNodes")
def list_nodes(_: AnyCaller, session: DbSession) -> list[NodeSummary]:
    nodes = _content_nodes(session)
    codes = {node.id: node.code for node in nodes}
    prerequisites: dict[str, list[Prerequisite]] = {code: [] for code in codes.values()}
    for edge in session.scalars(select(NodePrerequisite)):
        if edge.node_id in codes and edge.prerequisite_node_id in codes:
            prerequisites[codes[edge.node_id]].append(
                Prerequisite(code=codes[edge.prerequisite_node_id], strength=edge.strength)
            )
    counts = Counter(
        codes.get(node_id)
        for node_id in session.scalars(
            select(Misconception.node_id).where(Misconception.retired_at.is_(None))
        )
    )
    return [
        NodeSummary(
            code=node.code,
            title=node.title,
            strand=cast(Strand, node.strand),
            tier=cast(Tier, node.tier),
            visual_suitability=node.visual_suitability,
            prerequisites=prerequisites[node.code],
            misconception_count=counts[node.code],
        )
        for node in nodes
    ]


@router.get(
    "/nodes/{code}",
    operation_id="getCurriculumNode",
    responses={404: {"description": "No node has this code."}},
)
def get_node(code: str, caller: AnyCaller, session: DbSession) -> NodeDetail:
    nodes = _content_nodes(session)
    codes = {node.id: node.code for node in nodes}
    node = next((n for n in nodes if n.code == code), None)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No node has this code.")
    edges = list(
        session.scalars(
            select(NodePrerequisite).where(
                (NodePrerequisite.node_id == node.id)
                | (NodePrerequisite.prerequisite_node_id == node.id)
            )
        )
    )
    prerequisites = [
        Prerequisite(code=codes[e.prerequisite_node_id], strength=e.strength)
        for e in edges
        if e.node_id == node.id and e.prerequisite_node_id in codes
    ]
    order = {n.code: _node_order(n) for n in nodes}
    dependents = sorted(
        (
            codes[e.node_id]
            for e in edges
            if e.prerequisite_node_id == node.id and e.node_id in codes
        ),
        key=order.__getitem__,
    )
    topics = session.scalars(
        select(Topic.slug)
        .join(TopicNode, TopicNode.topic_id == Topic.id)
        .where(TopicNode.node_id == node.id, Topic.retired_at.is_(None))
        .order_by(Topic.sort_order)
    )
    misconceptions = session.scalars(
        select(Misconception)
        .where(Misconception.node_id == node.id, Misconception.retired_at.is_(None))
        .order_by(Misconception.code)
    )
    rows = [_misconception_out(m, node.code, caller) for m in misconceptions]
    return NodeDetail(
        code=node.code,
        title=node.title,
        strand=cast(Strand, node.strand),
        tier=cast(Tier, node.tier),
        visual_suitability=node.visual_suitability,
        prerequisites=prerequisites,
        misconception_count=len(rows),
        description=node.description,
        higher_extension=node.higher_extension,
        dependents=dependents,
        topics=list(topics),
        misconceptions=rows,
    )


@router.get("/topics", operation_id="listCurriculumTopics")
def list_topics(_: AnyCaller, session: DbSession) -> list[TopicOut]:
    codes = {node.id: node.code for node in _content_nodes(session)}
    links: dict[Any, list[str]] = {}
    for link in session.scalars(select(TopicNode)):
        if link.node_id in codes:
            links.setdefault(link.topic_id, []).append(codes[link.node_id])
    order = {code: index for index, code in enumerate(codes.values())}
    return [
        TopicOut(
            slug=topic.slug,
            title=topic.title,
            sort_order=topic.sort_order,
            scene_primitive=topic.scene_primitive,
            nodes=sorted(links.get(topic.id, []), key=order.__getitem__),
        )
        for topic in session.scalars(
            select(Topic).where(Topic.retired_at.is_(None)).order_by(Topic.sort_order)
        )
    ]


@router.get("/misconceptions", operation_id="listMisconceptions")
def list_misconceptions(
    caller: AnyCaller,
    session: DbSession,
    node: Annotated[str | None, Query(description="Only this node's misconceptions.")] = None,
) -> list[MisconceptionOut]:
    codes = {n.id: n.code for n in _content_nodes(session)}
    query = (
        select(Misconception).where(Misconception.retired_at.is_(None)).order_by(Misconception.code)
    )
    if node is not None:
        wanted = [node_id for node_id, code in codes.items() if code == node]
        query = query.where(Misconception.node_id.in_(wanted))
    return [
        _misconception_out(m, codes[m.node_id], caller)
        for m in session.scalars(query)
        if m.node_id in codes
    ]
