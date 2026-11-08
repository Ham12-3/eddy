"""The read-only curriculum API, over a seeded throwaway database."""

import base64
import dataclasses
import time
from collections.abc import Iterator
from pathlib import Path
from typing import get_args

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from eddy_api.auth import ROLES, Role
from eddy_api.config import Settings, get_settings
from eddy_api.db.models.curriculum import STRANDS
from eddy_api.db.session import get_session
from eddy_api.main import create_app
from eddy_api.routes.curriculum import STRAND_ORDER, Strand
from eddy_api.seed.curriculum import load
from eddy_api.seed.upsert import seed

CURRICULUM = Path(__file__).resolve().parents[3] / "curriculum"
_KEY = ec.generate_private_key(ec.SECP256R1())
_PUBLIC_B64 = base64.b64encode(
    _KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
).decode()


def headers(role: Role = "student") -> dict[str, str]:
    now = int(time.time())
    claims = {
        "iss": "eddy-web",
        "aud": "eddy-api",
        "sub": "user-1",
        "role": role,
        "iat": now,
        "exp": now + 60,
    }
    return {"Authorization": f"Bearer {jwt.encode(claims, _KEY, algorithm='ES256')}"}


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    seed(db_session, load(CURRICULUM))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64
    )
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client


def test_the_strand_type_matches_the_model() -> None:
    assert get_args(Strand) == STRANDS == STRAND_ORDER


def test_topics_come_in_order_with_their_nodes(client: TestClient) -> None:
    topics = client.get("/v1/curriculum/topics", headers=headers()).json()
    assert [t["sort_order"] for t in topics] == list(range(1, 14))
    assert topics[0]["slug"] == "negative-numbers"
    ratio = next(t for t in topics if t["slug"] == "ratio")
    assert ratio["nodes"] == ["R4", "R5", "R6", "R7"]


def test_nodes_list_every_statement_with_prerequisites(client: TestClient) -> None:
    nodes = client.get("/v1/curriculum/nodes", headers=headers()).json()
    assert len(nodes) == 97
    assert [n["code"] for n in nodes[:3]] == ["N1", "N2", "N3"]
    n2 = next(n for n in nodes if n["code"] == "N2")
    assert n2["prerequisites"] == [{"code": "N1", "strength": 0.5}]
    assert n2["misconception_count"] == 9


def test_a_node_shows_its_neighbours_topics_and_misconceptions(client: TestClient) -> None:
    node = client.get("/v1/curriculum/nodes/A9", headers=headers()).json()
    assert {p["code"] for p in node["prerequisites"]} == {"A8", "A2", "A17"}
    assert node["dependents"] == ["A10"]
    assert node["topics"] == ["straight-line-graphs"]
    codes = [m["code"] for m in node["misconceptions"]]
    assert codes == sorted(codes)
    assert "PARALLEL_BY_INTERCEPT" in codes


def test_an_unknown_node_is_404(client: TestClient) -> None:
    assert client.get("/v1/curriculum/nodes/X1", headers=headers()).status_code == 404


def test_misconceptions_filter_by_node(client: TestClient) -> None:
    rows = client.get("/v1/curriculum/misconceptions?node=G20", headers=headers("admin")).json()
    assert len(rows) == 4
    assert all(row["node"] == "G20" for row in rows)
    classifier = next(row for row in rows if row["code"] == "PYTH_WRONG_HYPOTENUSE")
    assert classifier["detection_rules"] == [
        {"type": "distractor", "rule": "pythagoras_subtract_for_hypotenuse"},
        {"type": "classifier", "rule": None},
    ]


def test_specs_include_the_exam_boards(client: TestClient) -> None:
    specs = client.get("/v1/curriculum/specs", headers=headers()).json()
    assert {(s["board"], s["spec_code"]) for s in specs} >= {
        ("DFE", "GCSE-MATHS"),
        ("AQA", "8300"),
        ("EDEXCEL", "1MA1"),
        ("OCR", "J560"),
    }


@pytest.mark.parametrize("role", ROLES)
def test_every_role_may_read(client: TestClient, role: Role) -> None:
    assert client.get("/v1/curriculum/topics", headers=headers(role)).status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/v1/curriculum/specs",
        "/v1/curriculum/nodes",
        "/v1/curriculum/nodes/N1",
        "/v1/curriculum/topics",
        "/v1/curriculum/misconceptions",
    ],
)
def test_a_token_is_required(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 401


@pytest.mark.parametrize(("role", "sees"), [("student", False), ("parent", False), ("admin", True)])
def test_only_admins_see_teacher_wording_and_rules(
    client: TestClient, role: Role, sees: bool
) -> None:
    rows = client.get("/v1/curriculum/misconceptions?node=N2", headers=headers(role)).json()
    assert rows
    assert all((row["teacher_description"] is not None) == sees for row in rows)
    assert all((row["detection_rules"] is not None) == sees for row in rows)
    assert all(row["student_facing_description"] for row in rows)


def test_retired_rows_are_not_served(client: TestClient, db_session: Session) -> None:
    curriculum = load(CURRICULUM)
    without_s4 = tuple(m for m in curriculum.misconceptions if m.node != "S4")
    seed(db_session, dataclasses.replace(curriculum, misconceptions=without_s4))
    rows = client.get("/v1/curriculum/misconceptions?node=S4", headers=headers()).json()
    assert rows == []
    nodes = client.get("/v1/curriculum/nodes", headers=headers()).json()
    assert next(n for n in nodes if n["code"] == "S4")["misconception_count"] == 0
