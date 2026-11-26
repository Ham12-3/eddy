"""The local model (ADR-0036): the same structured calls as llm/client.py, answered on the
student's own computer by llama.cpp's server. Nothing leaves the machine.

- The model, its file, context size and temperature come from the `local` block of
  config/models.yaml. The temperature is given to the model server when it starts
  (`server_args`); a request carries no sampling settings and no assistant prefill.
- Structured output through `response_format` with the caller's JSON schema: the server turns it
  into a grammar, so the answer is always that JSON shape.
- Only the routes the local block lists are answered, and only text: no images.
- Errors are the same types as the Claude client raises, so callers fall back the same way.
  A local model never reports a refusal: there is no `LlmRefusalError` from here.
- Every call that returns is recorded as metadata only (`llm_call`), at no cost.

`python -m eddy_api.llm.local serve --server PATH --models DIR [--port N]` starts the model server
with these settings (the desktop app does the same).
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx

from eddy_api.llm.client import (
    DEFAULT_MAX_TOKENS,
    CallRecord,
    LlmOutputError,
    LlmRequestError,
    LlmTruncatedError,
    LlmUnavailableError,
    Recorder,
    StructuredResult,
    Usage,
)
from eddy_api.llm.config import LocalModel, ModelConfig, model_config
from eddy_api.llm.prompts import Prompt

#: A small model on a laptop processor is slow: allow a long answer before giving up.
TIMEOUT_S = 300.0
DEFAULT_PORT = 8330
#: One slot each for the tutor and the two safety prompts, so each keeps its prompt cached.
SLOTS = 3
log = logging.getLogger(__name__)


def server_args(local: LocalModel, models_dir: Path, port: int = DEFAULT_PORT) -> list[str]:
    """The arguments llama.cpp's server is started with for this model."""
    return [
        "--model",
        str(models_dir / local.file),
        "--alias",
        local.model,
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--parallel",
        str(SLOTS),
        # The server shares its context between the slots.
        "--ctx-size",
        str(local.context * SLOTS),
        "--temp",
        str(local.temperature),
        # No thinking out loud: the answer is the JSON object, straight away.
        "--reasoning-budget",
        "0",
        "--no-webui",
    ]


def _usage(body: dict[str, Any]) -> Usage:
    usage = body.get("usage") or {}
    cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
    prompt = int(usage.get("prompt_tokens") or 0)
    return Usage(
        input_tokens=max(prompt - int(cached or 0), 0),
        output_tokens=int(usage.get("completion_tokens") or 0),
        cache_read_tokens=int(cached or 0),
        cache_write_tokens=0,
    )


class LocalLlmClient:
    def __init__(
        self,
        http: httpx.Client,
        *,
        config: ModelConfig | None = None,
        recorder: Recorder | None = None,
    ) -> None:
        self._http = http
        self._config = config or model_config()
        self._recorder = recorder

    @classmethod
    def from_url(cls, base_url: str, *, recorder: Recorder | None = None) -> "LocalLlmClient":
        return cls(httpx.Client(base_url=base_url, timeout=TIMEOUT_S), recorder=recorder)

    def request(
        self,
        *,
        prompt: Prompt,
        context: Sequence[str],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = DEFAULT_MAX_TOKENS,
        route_name: str | None = None,
    ) -> dict[str, Any]:
        """The exact JSON body sent to the model server (tests read it)."""
        local = self._config.local
        if local is None:
            raise LlmRequestError("config/models.yaml names no local model")
        route = route_name or prompt.route
        if route not in local.routes:
            raise LlmRequestError(f"{route} has no local model")
        if any(not isinstance(message.get("content"), str) for message in messages):
            raise LlmRequestError("The local model reads text only")
        if messages and messages[-1].get("role") == "assistant":
            raise LlmRequestError("No assistant prefill: the last message must be the user's")
        system = "\n\n".join([prompt.text, *context])
        return {
            "model": local.model,
            "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, *messages],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "answer", "strict": True, "schema": schema},
            },
        }

    def structured(
        self,
        *,
        prompt: Prompt,
        context: Sequence[str],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        student_id: uuid.UUID | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        route_name: str | None = None,
    ) -> StructuredResult:
        body = self.request(
            prompt=prompt,
            context=context,
            messages=messages,
            schema=schema,
            max_tokens=max_tokens,
            route_name=route_name,
        )
        start = time.perf_counter()
        try:
            response = self._http.post("/v1/chat/completions", json=body)
        except httpx.HTTPError as error:
            raise LlmUnavailableError(type(error).__name__) from error
        if response.status_code >= 500:
            raise LlmUnavailableError(f"HTTP {response.status_code}")
        if response.status_code >= 400:
            raise LlmRequestError(f"HTTP {response.status_code}: {response.text[:200]}")
        latency_ms = round((time.perf_counter() - start) * 1000)
        try:
            answer = response.json()
            choice = answer["choices"][0]
            text = choice["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise LlmUnavailableError("The model server sent an answer it should not") from error

        record = CallRecord(
            route=route_name or prompt.route,
            model=body["model"],
            prompt_id=prompt.id,
            prompt_version=prompt.version,
            usage=_usage(answer),
            latency_ms=latency_ms,
            cost_gbp=0.0,
            stop_reason=choice.get("finish_reason"),
            student_id=student_id,
        )
        if self._recorder:
            try:
                self._recorder(record)
            except Exception:
                log.exception("llm_call was not recorded for %s", prompt.route)

        if choice.get("finish_reason") == "length":
            raise LlmTruncatedError("The answer hit max_tokens", record)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise LlmOutputError("The answer was not JSON", record) from error
        if not isinstance(data, dict):
            raise LlmOutputError("The answer was not a JSON object", record)
        return StructuredResult(data=data, text=text, record=record)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Start the local model server.")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--server", type=Path, required=True, help="llama.cpp's llama-server")
    serve.add_argument("--models", type=Path, required=True, help="the folder with the GGUF file")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    local = model_config().local
    if local is None:
        print("config/models.yaml names no local model", file=sys.stderr)
        return 2
    if not (args.models / local.file).is_file():
        print(f"{local.file} is not in {args.models}", file=sys.stderr)
        return 2
    command = [str(args.server), *server_args(local, args.models, args.port)]
    # The paths come from the person running this, and the settings from config/models.yaml.
    return subprocess.call(command, env=os.environ.copy())  # noqa: S603


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
