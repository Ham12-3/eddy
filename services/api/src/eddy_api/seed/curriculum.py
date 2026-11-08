"""Load and validate the curriculum YAML. Pure: no database (ADR-0021).

Every file is checked against its JSON Schema in curriculum/schemas, then the files are checked
against each other: known codes, a prerequisite graph with no cycles, every MVP node's ancestors
declared, and enough misconceptions per MVP topic. All problems are reported together.
"""

import json
import re
from collections.abc import Hashable, Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

FILES: dict[str, str] = {
    "specs": "specs.yaml",
    "nodes": "maths/nodes.yaml",
    "prerequisites": "maths/prerequisites.yaml",
    "topics": "maths/topics.yaml",
    "misconceptions": "maths/misconceptions.yaml",
    "set_texts": "english/set_texts.yaml",
    "question_types": "english/question_types.yaml",
}
# PLAN.md M2 asks for about five per MVP node; no topic ships with fewer than this. Topics that
# share a node (N1 and N2) both count its misconceptions.
MIN_MISCONCEPTIONS_PER_TOPIC = 4
# JSON Schema patterns run through re.search, where $ also matches before a final newline.
# Codes are checked again with fullmatch.
NODE_CODE = re.compile(r"[NARGPS][1-9][0-9]?")
MISCONCEPTION_CODE = re.compile(r"[A-Z][A-Z0-9_]{2,63}")

SpecKey = tuple[str, str, str]  # (board, spec_code, version)


class CurriculumError(Exception):
    """The curriculum files are invalid. `problems` holds one line per problem."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


class _Loader(yaml.SafeLoader):
    """SafeLoader that keeps dates as strings and rejects duplicate keys and aliases.

    PyYAML would otherwise turn 2015-09-01 into a date (which no JSON Schema accepts) and let a
    repeated key silently replace the first, losing data. The files need no anchors or aliases.
    """

    def compose_node(self, parent: yaml.Node | None, index: Any) -> yaml.Node | None:
        if self.check_event(yaml.AliasEvent):
            event = self.peek_event()  # type: ignore[no-untyped-call]
            raise yaml.composer.ComposerError(
                None, None, "anchors and aliases are not allowed", event.start_mark
            )
        return super().compose_node(parent, index)

    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Hashable, Any]:
        seen: set[Hashable] = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, Hashable) or isinstance(key, (list, dict)):
                raise yaml.constructor.ConstructorError(
                    None, None, "keys must be plain values", key_node.start_mark
                )
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark
                )
            seen.add(key)
        return super().construct_mapping(node, deep=deep)


_Loader.yaml_implicit_resolvers = {
    first: [r for r in resolvers if r[0] != "tag:yaml.org,2002:timestamp"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


@dataclass(frozen=True)
class SpecRow:
    board: str
    qualification: str
    spec_code: str
    version: str
    title: str
    content: SpecKey | None
    papers: list[dict[str, Any]]
    valid_from: date
    valid_to: date | None

    @property
    def key(self) -> SpecKey:
        return (self.board, self.spec_code, self.version)


@dataclass(frozen=True)
class NodeRow:
    code: str
    strand: str
    tier: str
    visual: int
    title: str
    description: str
    higher: str | None


@dataclass(frozen=True)
class EdgeRow:
    node: str
    prerequisite: str
    strength: float


@dataclass(frozen=True)
class TopicRow:
    slug: str
    title: str
    sort_order: int
    primitive: str
    nodes: tuple[str, ...]


@dataclass(frozen=True)
class MisconceptionRow:
    code: str
    node: str
    title: str
    student: str
    teacher: str
    detect: list[dict[str, str]]
    scene: str
    recheck: str
    evidence: str


@dataclass(frozen=True)
class SetTextRow:
    board: str
    category: str
    title: str
    author: str
    copyright: str
    display: str
    notes: str | None


@dataclass(frozen=True)
class QuestionTypeRow:
    spec: SpecKey
    paper: int
    number: str
    marks: int
    aos: tuple[str, ...]
    minutes: int
    task: str
    # Level descriptors, level 1 first; empty for points-based questions.
    levels: tuple[str, ...]


@dataclass(frozen=True)
class Curriculum:
    specs: tuple[SpecRow, ...]
    node_spec: SpecKey
    nodes: tuple[NodeRow, ...]
    edges: tuple[EdgeRow, ...]
    # Every node that declares its prerequisites, including roots that declare none.
    declared: frozenset[str]
    topics: tuple[TopicRow, ...]
    misconceptions: tuple[MisconceptionRow, ...]
    set_texts: tuple[SetTextRow, ...]
    question_types: tuple[QuestionTypeRow, ...]

    @property
    def mvp_nodes(self) -> frozenset[str]:
        return frozenset(code for topic in self.topics for code in topic.nodes)

    def prerequisites_of(self, code: str) -> list[str]:
        return [edge.prerequisite for edge in self.edges if edge.node == code]

    def ancestors(self, codes: Iterable[str]) -> set[str]:
        """Every node reachable through prerequisite edges, not including `codes` themselves."""
        found: set[str] = set()
        stack = [p for code in codes for p in self.prerequisites_of(code)]
        while stack:
            code = stack.pop()
            if code not in found:
                found.add(code)
                stack.extend(self.prerequisites_of(code))
        return found


def default_root() -> Path:
    return Path.cwd() / "curriculum"


def _schema_registry(root: Path) -> tuple[Registry, dict[str, dict[str, Any]]]:
    schemas: dict[str, dict[str, Any]] = {}
    registry: Registry = Registry()
    for path in sorted((root / "schemas").glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        schemas[path.name.removesuffix(".schema.json")] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return registry, schemas


def read_files(root: Path) -> dict[str, Any]:
    """Parse every curriculum file and check it against its schema."""
    registry, schemas = _schema_registry(root)
    problems: list[str] = []
    documents: dict[str, Any] = {}
    for name, relative in FILES.items():
        path = root / relative
        try:
            with path.open(encoding="utf-8") as handle:
                document = yaml.load(handle, Loader=_Loader)  # noqa: S506 (a SafeLoader subclass)
        except (OSError, yaml.YAMLError) as error:
            problems.append(f"{relative}: {error}")
            continue
        schema = schemas.get(name)
        if schema is None:
            problems.append(f"{relative}: no schema at schemas/{name}.schema.json")
            continue
        validator = Draft202012Validator(schema, registry=registry)
        for issue in sorted(validator.iter_errors(document), key=lambda e: list(e.path)):
            where = "/".join(str(part) for part in issue.path) or "(root)"
            problems.append(f"{relative}: {where}: {issue.message}")
        documents[name] = document
    if problems:
        raise CurriculumError(problems)
    return documents


def _spec_key(ref: Mapping[str, str]) -> SpecKey:
    return (ref["board"], ref["spec_code"], ref["version"])


def build(documents: Mapping[str, Any]) -> Curriculum:
    """Turn schema-valid documents into rows. Cross-file checks happen in `check`."""
    specs = tuple(
        SpecRow(
            board=s["board"],
            qualification=s["qualification"],
            spec_code=s["spec_code"],
            version=s["version"],
            title=s["title"],
            content=_spec_key(s["content"]) if "content" in s else None,
            papers=s["papers"],
            valid_from=date.fromisoformat(s["valid_from"]),
            valid_to=date.fromisoformat(s["valid_to"]) if "valid_to" in s else None,
        )
        for s in documents["specs"]["specs"]
    )
    nodes = tuple(
        NodeRow(
            code=n["code"],
            strand=strand,
            tier=n["tier"],
            visual=n["visual"],
            title=n["title"],
            description=n["description"],
            higher=n.get("higher"),
        )
        for strand, entries in documents["nodes"]["strands"].items()
        for n in entries
    )
    edge_map: dict[str, list[dict[str, Any]]] = documents["prerequisites"]["edges"]
    edges = tuple(
        EdgeRow(node=code, prerequisite=p["code"], strength=float(p["strength"]))
        for code, prerequisites in edge_map.items()
        for p in prerequisites
    )
    topics = tuple(
        TopicRow(
            slug=t["slug"],
            title=t["title"],
            sort_order=index,
            primitive=t["primitive"],
            nodes=tuple(t["nodes"]),
        )
        for index, t in enumerate(documents["topics"]["topics"], start=1)
    )
    misconceptions = tuple(
        MisconceptionRow(
            code=m["code"],
            node=m["node"],
            title=m["title"],
            student=m["student"],
            teacher=m["teacher"],
            detect=m["detect"],
            scene=m["scene"],
            recheck=m["recheck"],
            evidence=m["evidence"],
        )
        for m in documents["misconceptions"]["misconceptions"]
    )
    set_texts = tuple(
        SetTextRow(
            board=t["board"],
            category=t["category"],
            title=t["title"],
            author=t["author"],
            copyright=t["copyright"],
            display=t["display"],
            notes=t.get("notes"),
        )
        for t in documents["set_texts"]["set_texts"]
    )
    level_sets: dict[str, list[str]] = documents["question_types"]["level_sets"]
    question_types = tuple(
        QuestionTypeRow(
            spec=_spec_key(q["spec"]),
            paper=q["paper"],
            number=q["number"],
            marks=q["marks"],
            aos=tuple(q["aos"]),
            minutes=q["minutes"],
            task=q["task"],
            levels=tuple(level_sets.get(q["levels"], ())) if "levels" in q else (),
        )
        for q in documents["question_types"]["question_types"]
    )
    return Curriculum(
        specs=specs,
        node_spec=_spec_key(documents["nodes"]["spec"]),
        nodes=nodes,
        edges=edges,
        declared=frozenset(edge_map),
        topics=topics,
        misconceptions=misconceptions,
        set_texts=set_texts,
        question_types=question_types,
    )


def _duplicates(values: Iterable[Hashable]) -> list[Hashable]:
    seen: set[Hashable] = set()
    repeated: list[Hashable] = []
    for value in values:
        if value in seen and value not in repeated:
            repeated.append(value)
        seen.add(value)
    return repeated


def find_cycle(edges: Iterable[EdgeRow]) -> list[str] | None:
    """A prerequisite cycle as [a, b, ..., a], or None when the graph is a DAG."""
    graph: dict[str, list[str]] = {}
    for edge in edges:
        graph.setdefault(edge.node, []).append(edge.prerequisite)
    state: dict[str, int] = {}  # 1 while on the current path, 2 once fully explored
    for start in sorted(graph):
        if state.get(start):
            continue
        path = [start]
        iterators = [iter(graph.get(start, []))]
        state[start] = 1
        while iterators:
            following = next(iterators[-1], None)
            if following is None:
                state[path.pop()] = 2
                iterators.pop()
            elif state.get(following) == 1:
                return [*path[path.index(following) :], following]
            elif not state.get(following):
                state[following] = 1
                path.append(following)
                iterators.append(iter(graph.get(following, [])))
    return None


def check(curriculum: Curriculum) -> list[str]:
    """Cross-file problems; an empty list means the curriculum is consistent."""
    problems: list[str] = []
    specs = {spec.key: spec for spec in curriculum.specs}
    codes = {node.code for node in curriculum.nodes}

    for key in _duplicates(spec.key for spec in curriculum.specs):
        problems.append(f"specs.yaml: duplicate spec {key}")
    for spec in curriculum.specs:
        if spec.content is None and spec.board != "DFE" and spec.qualification == "MATHS":
            problems.append(f"specs.yaml: {spec.key} needs `content` (the DfE subject content)")
        if spec.content is not None:
            target = specs.get(spec.content)
            if target is None:
                problems.append(f"specs.yaml: {spec.key} content {spec.content} is not a spec")
            elif target.content is not None:
                problems.append(f"specs.yaml: {spec.key} content must not itself have content")
    if curriculum.node_spec not in specs:
        problems.append(f"maths/nodes.yaml: spec {curriculum.node_spec} is not in specs.yaml")

    for code in _duplicates(node.code for node in curriculum.nodes):
        problems.append(f"maths/nodes.yaml: duplicate node {code}")
    referenced = (
        [node.code for node in curriculum.nodes]
        + [code for edge in curriculum.edges for code in (edge.node, edge.prerequisite)]
        + [code for topic in curriculum.topics for code in topic.nodes]
        + [m.node for m in curriculum.misconceptions]
    )
    for code in sorted({c for c in referenced if not NODE_CODE.fullmatch(c)}):
        problems.append(f"curriculum: {code!r} is not a node code")
    for m in curriculum.misconceptions:
        if not MISCONCEPTION_CODE.fullmatch(m.code):
            problems.append(f"maths/misconceptions.yaml: {m.code!r} is not a misconception code")

    for code in sorted(curriculum.declared - codes):
        problems.append(f"maths/prerequisites.yaml: unknown node {code}")
    for edge in curriculum.edges:
        if edge.prerequisite not in codes:
            problems.append(
                f"maths/prerequisites.yaml: {edge.node} needs unknown {edge.prerequisite}"
            )
        if edge.prerequisite == edge.node:
            problems.append(f"maths/prerequisites.yaml: {edge.node} needs itself")
    for pair in _duplicates((edge.node, edge.prerequisite) for edge in curriculum.edges):
        problems.append(f"maths/prerequisites.yaml: repeated edge {pair}")
    cycle = find_cycle(curriculum.edges)
    if cycle:
        problems.append(f"maths/prerequisites.yaml: cycle {' > '.join(cycle)}")
    else:
        closure = curriculum.mvp_nodes | curriculum.ancestors(curriculum.mvp_nodes)
        for code in sorted(closure - curriculum.declared):
            problems.append(
                f"maths/prerequisites.yaml: {code} is an MVP node or ancestor and must declare "
                "its prerequisites (an empty list for a root)"
            )

    for slug in _duplicates(topic.slug for topic in curriculum.topics):
        problems.append(f"maths/topics.yaml: duplicate topic {slug}")
    for topic in curriculum.topics:
        for code in topic.nodes:
            if code not in codes:
                problems.append(f"maths/topics.yaml: {topic.slug} has unknown node {code}")

    allowed = curriculum.mvp_nodes | curriculum.ancestors(curriculum.mvp_nodes)
    for code in _duplicates(m.code for m in curriculum.misconceptions):
        problems.append(f"maths/misconceptions.yaml: duplicate code {code}")
    for m in curriculum.misconceptions:
        if m.node not in codes:
            problems.append(f"maths/misconceptions.yaml: {m.code} has unknown node {m.node}")
        elif m.node not in allowed:
            problems.append(
                f"maths/misconceptions.yaml: {m.code} node {m.node} is not an MVP node or ancestor"
            )
        if not m.recheck.startswith(f"{m.node}."):
            problems.append(
                f"maths/misconceptions.yaml: {m.code} recheck {m.recheck} must start with {m.node}."
            )
    for topic in curriculum.topics:
        count = sum(1 for m in curriculum.misconceptions if m.node in topic.nodes)
        if count < MIN_MISCONCEPTIONS_PER_TOPIC:
            problems.append(
                f"maths/misconceptions.yaml: topic {topic.slug} has {count} misconceptions, "
                f"fewer than {MIN_MISCONCEPTIONS_PER_TOPIC}"
            )

    for pair in _duplicates((t.board, t.title) for t in curriculum.set_texts):
        problems.append(f"english/set_texts.yaml: duplicate set text {pair}")

    for q in curriculum.question_types:
        owner = specs.get(q.spec)
        if owner is None:
            problems.append(f"english/question_types.yaml: unknown spec {q.spec}")
        elif owner.qualification == "MATHS":
            problems.append(f"english/question_types.yaml: {q.spec} is not an English spec")
    for triple in _duplicates((q.spec, q.paper, q.number) for q in curriculum.question_types):
        problems.append(f"english/question_types.yaml: duplicate question type {triple}")
    return problems


def check_level_references(documents: Mapping[str, Any]) -> list[str]:
    sets = documents["question_types"]["level_sets"]
    return [
        f"english/question_types.yaml: paper {q['paper']} question {q['number']} uses "
        f"unknown level set {q['levels']}"
        for q in documents["question_types"]["question_types"]
        if "levels" in q and q["levels"] not in sets
    ]


def load(root: Path | None = None) -> Curriculum:
    """Read, validate and cross-check the curriculum. Raises CurriculumError on any problem."""
    documents = read_files(root or default_root())
    problems = check_level_references(documents)
    try:
        curriculum = build(documents)
    except ValueError as error:  # an impossible date such as 2015-13-45
        raise CurriculumError([*problems, f"curriculum: {error}"]) from error
    problems += check(curriculum)
    if problems:
        raise CurriculumError(problems)
    return curriculum
