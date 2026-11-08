"""The HTTP routes: generation, answer checks, steps and claims, behind the service token."""

import asyncio
from collections.abc import Iterator, MutableMapping
from typing import Any

import pytest
from fastapi.testclient import TestClient

from eddy_maths_core.config import Settings, get_settings
from eddy_maths_core.limits import MAX_BODY_BYTES, BodyLimit
from eddy_maths_core.main import create_app

SECRET = "test-service-token-that-is-long-enough-1234"
HEADERS = {"X-Service-Token": SECRET}


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(maths_core_service_token=SECRET)
    with TestClient(app) as test_client:
        yield test_client


def test_every_route_needs_the_token(client: TestClient) -> None:
    assert client.get("/v1/templates").status_code == 401
    assert (
        client.post("/v1/items", json={"template_id": "a17-two-step", "seed": 1}).status_code == 401
    )


def test_templates_are_listed(client: TestClient) -> None:
    templates = client.get("/v1/templates", headers=HEADERS).json()
    assert len(templates) >= 66
    two_step = next(t for t in templates if t["id"] == "a17-two-step")
    assert two_step["misconceptions"] == ["EQ_DIVIDE_ONE_TERM"]


def test_generate_then_check(client: TestClient) -> None:
    request = {"template_id": "n2-fraction-add-unlike", "seed": 7}
    item = client.post("/v1/items", json=request, headers=HEADERS).json()
    assert item["stem_markdown"].startswith("Work out")
    assert item["answer"]["latex"].startswith("\\frac")

    right = client.post(
        "/v1/answers/check",
        json=request | {"response": item["answer"]["mathjson"]},
        headers=HEADERS,
    ).json()
    assert right["correct"] is True

    distractor = item["distractors"][0]
    wrong = client.post(
        "/v1/answers/check",
        json=request | {"response": distractor["value"]["mathjson"]},
        headers=HEADERS,
    ).json()
    assert wrong["correct"] is False
    assert wrong["misconceptions"] == [distractor["misconception"]]


def test_unreadable_answers_are_explained(client: TestClient) -> None:
    body = {"template_id": "a17-two-step", "seed": 1, "response": ["Error", "'missing'"]}
    result = client.post("/v1/answers/check", json=body, headers=HEADERS).json()
    assert result["correct"] is False
    assert result["unreadable"]


def test_unknown_template_is_404(client: TestClient) -> None:
    body = {"template_id": "no-such-template", "seed": 1}
    assert client.post("/v1/items", json=body, headers=HEADERS).status_code == 404


def test_steps_and_claims(client: TestClient) -> None:
    steps = {"steps": [["Equal", ["Multiply", 2, "x"], 8], ["Equal", "x", 5]]}
    assert client.post("/v1/steps/check", json=steps, headers=HEADERS).json()["first_invalid"] == 1

    item = client.post(
        "/v1/items", json={"template_id": "a17-one-step-add", "seed": 2}, headers=HEADERS
    ).json()
    claims = {
        "claims": [
            {"role": "claim", "expr": ["Equal", ["Add", 2, 2], 4]},
            {"role": "given", "expr": ["Equal", "x", item["answer"]["mathjson"]]},
        ],
        "item": {"template_id": "a17-one-step-add", "seed": 2},
    }
    result = client.post("/v1/claims/verify", json=claims, headers=HEADERS).json()
    assert result["all_verified"] is True
    assert result["leaks_answer"] is True


def test_large_bodies_are_refused(client: TestClient) -> None:
    padding = "x" * (MAX_BODY_BYTES + 1)
    body = {"template_id": "a17-two-step", "seed": 1, "response": padding}
    assert client.post("/v1/answers/check", json=body, headers=HEADERS).status_code == 413


def test_docs_and_schema_are_not_served(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_a_chunked_body_is_counted_not_trusted() -> None:
    """No Content-Length, as with Transfer-Encoding: chunked; the bytes are counted as they come."""
    sent: list[MutableMapping[str, Any]] = []
    chunks = [b"x" * 1000] * (MAX_BODY_BYTES // 1000 + 2)

    async def app(_scope: Any, receive: Any, _send: Any) -> None:
        while True:  # an app that reads the whole body, as FastAPI does
            message = await receive()
            if not message.get("more_body"):
                return

    async def receive() -> dict[str, Any]:
        body = chunks.pop() if chunks else b""
        return {"type": "http.request", "body": body, "more_body": bool(chunks)}

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(message)

    scope = {"type": "http", "headers": [(b"transfer-encoding", b"chunked")]}
    asyncio.run(BodyLimit(app)(scope, receive, send))
    assert sent[0]["status"] == 413


def test_length_and_chunking_together_are_refused(client: TestClient) -> None:
    response = client.post(
        "/v1/answers/check",
        content=b"{}",
        headers=HEADERS | {"content-length": "2", "transfer-encoding": "chunked"},
    )
    assert response.status_code == 400


def test_an_unexpected_error_fails_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("eddy_maths_core.api.check_answer", broken)
    body = {"template_id": "a17-two-step", "seed": 1, "response": 4}
    result = client.post("/v1/answers/check", json=body, headers=HEADERS).json()
    assert result["correct"] is False
    assert result["unreadable"] == "That could not be checked."
