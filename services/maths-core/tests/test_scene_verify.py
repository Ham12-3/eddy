"""POST /v1/scenes/verify: one served scene checked like the scene golden set (ADR-0030)."""

import copy
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from eddy_maths_core.config import Settings, get_settings
from eddy_maths_core.main import create_app

SECRET = "test-service-token-that-is-long-enough-1234"
HEADERS = {"X-Service-Token": SECRET}
SPECS = Path(__file__).resolve().parents[3] / "evals" / "golden" / "scenes" / "specs.jsonl"


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(maths_core_service_token=SECRET)
    with TestClient(app) as test_client:
        yield test_client


def _record(template: str) -> dict[str, Any]:
    for line in SPECS.read_bytes().decode().splitlines():
        record = json.loads(line)
        if record["template"] == template:
            return {k: record[k] for k in ("spec", "answer", "predicted", "claims", "labels")}
    raise AssertionError(template)


def test_needs_the_token(client: TestClient) -> None:
    body = _record("number_line.compare_negatives")
    assert client.post("/v1/scenes/verify", json=body).status_code == 401


def test_a_reviewed_scene_is_verified(client: TestClient) -> None:
    body = _record("probability_tree.multiply_along")
    result = client.post("/v1/scenes/verify", json=body, headers=HEADERS).json()
    assert result == {"verified": True, "problems": []}


def test_a_number_nothing_checks_is_caught(client: TestClient) -> None:
    body = _record("number_line.compare_negatives")
    tampered = copy.deepcopy(body)
    tampered["spec"]["beats"][-1]["narration"] = "So the answer is 97, the smaller number."
    result = client.post("/v1/scenes/verify", json=tampered, headers=HEADERS).json()
    assert result["verified"] is False
    assert any("states 97" in problem for problem in result["problems"])


def test_a_wrong_answer_is_caught(client: TestClient) -> None:
    body = _record("bar_model.share_in_ratio")
    tampered = copy.deepcopy(body)
    tampered["answer"] = 1
    result = client.post("/v1/scenes/verify", json=tampered, headers=HEADERS).json()
    assert result["verified"] is False
    assert any("correct answer" in problem for problem in result["problems"])


def test_malformed_specs_fail_closed(client: TestClient) -> None:
    body = _record("number_line.compare_negatives")
    body["spec"] = {"beats": "not a list"}
    result = client.post("/v1/scenes/verify", json=body, headers=HEADERS).json()
    assert result == {"verified": False, "problems": ["That could not be checked."]}


@pytest.mark.parametrize(
    ("left", "right", "same"),
    [
        (["Rational", 1, 2], {"num": "0.5"}, True),
        (-2, ["Negate", 2], True),
        (["List", 18, 27], ["List", 18, 27], True),
        (7800, {"num": "0.0078"}, False),
        ("x", ["Unknown", "not allowed"], False),
    ],
)
def test_answers_equivalent(client: TestClient, left: Any, right: Any, same: bool) -> None:
    body = {"left": left, "right": right}
    result = client.post("/v1/answers/equivalent", json=body, headers=HEADERS).json()
    assert result == {"equivalent": same}
