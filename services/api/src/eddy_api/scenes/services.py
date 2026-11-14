"""Clients for the scene engine and maths-core (ADR-0030; the tutor uses maths-core too, M7).

- workers/scene-check: the scene engine (TypeScript). Context, assembly with every engine check,
  and keyframes for the background critique.
- services/maths-core: verifies every claim, both answers and every number the narration states.

Both are private and take a shared service token. Any failure raises SceneServiceError, and the
caller falls back to the Tier D scene.
"""

import time
from dataclasses import dataclass
from typing import Any

import httpx

from eddy_api.config import Settings

FAST_TIMEOUT_S = 10.0
KEYFRAME_TIMEOUT_S = 300.0

JsonValue = Any


class SceneServiceError(Exception):
    """A service failed or refused. `status` is its HTTP status, or None when unreachable."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _post(client: httpx.Client, path: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        response = client.post(path, json=body, timeout=timeout)
    except httpx.HTTPError as error:
        raise SceneServiceError(f"{path}: {type(error).__name__}") from error
    data = _json(response)
    if response.status_code != 200:
        detail = data.get("detail", "") if isinstance(data, dict) else ""
        raise SceneServiceError(
            f"{path}: HTTP {response.status_code} {detail}"[:300], response.status_code
        )
    if not isinstance(data, dict):
        raise SceneServiceError(f"{path}: expected a JSON object", response.status_code)
    return data


@dataclass
class SceneCheckClient:
    client: httpx.Client

    @classmethod
    def from_settings(cls, settings: Settings) -> "SceneCheckClient":
        token = settings.scene_check_service_token.get_secret_value()
        return cls(
            httpx.Client(base_url=settings.scene_check_base_url, headers={"X-Service-Token": token})
        )

    def context(
        self, template: str, item: dict[str, JsonValue], answer: JsonValue
    ) -> dict[str, Any]:
        body = {"template": template, "item": item, "studentAnswer": answer}
        return _post(self.client, "/v1/scenes/context", body, FAST_TIMEOUT_S)

    def check(
        self,
        template: str,
        item: dict[str, JsonValue],
        answer: JsonValue,
        beats: list[dict[str, Any]],
    ) -> dict[str, Any]:
        body = {"template": template, "item": item, "studentAnswer": answer, "beats": beats}
        return _post(self.client, "/v1/scenes/check", body, FAST_TIMEOUT_S)

    def keyframes(self, template: str, spec: dict[str, Any]) -> dict[str, Any]:
        body = {"template": template, "spec": spec}
        return _post(self.client, "/v1/scenes/keyframes", body, KEYFRAME_TIMEOUT_S)

    def healthy(self) -> bool:
        try:
            return self.client.get("/health", timeout=FAST_TIMEOUT_S).status_code == 200
        except httpx.HTTPError:
            return False


TEMPLATES_TTL_S = 300
_TEMPLATES: dict[str, tuple[float, list[dict[str, Any]]]] = {}


@dataclass
class MathsCoreClient:
    client: httpx.Client

    @classmethod
    def from_settings(cls, settings: Settings) -> "MathsCoreClient":
        token = settings.maths_core_service_token.get_secret_value()
        return cls(
            httpx.Client(base_url=settings.maths_core_base_url, headers={"X-Service-Token": token})
        )

    def verify_scene(
        self,
        *,
        spec: dict[str, Any],
        answer: JsonValue,
        predicted: JsonValue,
        claims: list[JsonValue],
        labels: list[str],
    ) -> dict[str, Any]:
        body = {
            "spec": spec,
            "answer": answer,
            "predicted": predicted,
            "claims": claims,
            "labels": labels,
        }
        return _post(self.client, "/v1/scenes/verify", body, FAST_TIMEOUT_S)

    def templates(self) -> list[dict[str, Any]]:
        """Every item template. They change only when maths-core is deployed, so the list is kept
        for TEMPLATES_TTL_S (the plan and progress pages ask for it on every load)."""
        cached = _TEMPLATES.get(str(self.client.base_url))
        if cached and time.monotonic() - cached[0] < TEMPLATES_TTL_S:
            return cached[1]
        try:
            response = self.client.get("/v1/templates", timeout=FAST_TIMEOUT_S)
        except httpx.HTTPError as error:
            raise SceneServiceError(f"/v1/templates: {type(error).__name__}") from error
        data = _json(response)
        if response.status_code != 200 or not isinstance(data, list):
            raise SceneServiceError("/v1/templates: bad response", response.status_code)
        _TEMPLATES[str(self.client.base_url)] = (time.monotonic(), data)
        return data

    def item(self, template_id: str, seed: int) -> dict[str, Any]:
        """A generated item, answer included: services/api keeps it server-side."""
        body = {"template_id": template_id, "seed": seed}
        return _post(self.client, "/v1/items", body, FAST_TIMEOUT_S)

    def check_answer(self, template_id: str, seed: int, response: JsonValue) -> dict[str, Any]:
        body = {"template_id": template_id, "seed": seed, "response": response}
        return _post(self.client, "/v1/answers/check", body, FAST_TIMEOUT_S)

    def verify_claims(
        self, claims: list[dict[str, Any]], template_id: str, seed: int
    ) -> dict[str, Any]:
        body = {"claims": claims, "item": {"template_id": template_id, "seed": seed}}
        return _post(self.client, "/v1/claims/verify", body, FAST_TIMEOUT_S)

    def equivalent(self, left: JsonValue, right: JsonValue) -> bool:
        body = {"left": left, "right": right}
        return bool(
            _post(self.client, "/v1/answers/equivalent", body, FAST_TIMEOUT_S)["equivalent"]
        )
