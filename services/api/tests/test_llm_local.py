"""The local model client (ADR-0036): the `local` block of config/models.yaml, the exact request
sent to the model server, typed errors and free cost records. A mock transport stands in for the
server, so nothing here starts a model."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from eddy_api.config import Settings, tier_l_enabled
from eddy_api.llm.client import (
    CallRecord,
    LlmOutputError,
    LlmRequestError,
    LlmTruncatedError,
    LlmUnavailableError,
)
from eddy_api.llm.config import ModelConfigError, model_config, parse
from eddy_api.llm.local import SLOTS, LocalLlmClient, server_args
from eddy_api.llm.prompts import load_prompt

SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}
USER = [{"role": "user", "content": "<student_message>hello</student_message>"}]


def answer(text: str, finish: str = "stop") -> dict[str, Any]:
    return {
        "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": text}}],
        "usage": {
            "prompt_tokens": 700,
            "completion_tokens": 60,
            "prompt_tokens_details": {"cached_tokens": 600},
        },
    }


def client(
    outcome: httpx.Response | Exception, records: list[CallRecord] | None = None
) -> tuple[LocalLlmClient, list[httpx.Request]]:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    http = httpx.Client(base_url="http://127.0.0.1:8330", transport=httpx.MockTransport(handler))
    recorder = records.append if records is not None else None
    return LocalLlmClient(http, recorder=recorder), sent


def call(llm: LocalLlmClient, **overrides: Any) -> Any:
    arguments: dict[str, Any] = {
        "prompt": load_prompt("safety-input"),
        "context": [],
        "messages": USER,
        "schema": SCHEMA,
        "max_tokens": 1024,
    }
    return llm.structured(**(arguments | overrides))


def test_the_shipped_config_names_a_local_model_for_the_tutor_routes() -> None:
    local = model_config().local
    assert local is not None
    assert local.file.endswith(".gguf")
    assert not local.model.startswith("claude-")
    assert set(local.routes) == {"tutor.turn", "safety.input", "safety.output"}
    # It runs on the student's own computer, so its calls cost nothing.
    assert model_config().price(local.model).output == 0


def test_the_request_carries_the_schema_and_no_sampling_settings() -> None:
    llm, sent = client(httpx.Response(200, json=answer("{}")))
    call(llm, context=["Stable context."])
    body = json.loads(sent[0].content)
    assert sent[0].url.path == "/v1/chat/completions"
    assert set(body) == {"model", "max_tokens", "messages", "response_format"}
    assert body["model"] == model_config().local.model  # type: ignore[union-attr]
    assert body["response_format"]["json_schema"]["schema"] == SCHEMA
    system = body["messages"][0]
    assert system["role"] == "system"
    assert system["content"].startswith(load_prompt("safety-input").text)
    assert system["content"].endswith("Stable context.")
    assert body["messages"][1:] == USER


def test_an_answer_is_parsed_and_recorded_at_no_cost() -> None:
    records: list[CallRecord] = []
    llm, _ = client(httpx.Response(200, json=answer('{"ok": true}')), records)
    result = call(llm)
    assert result.data == {"ok": True}
    assert result.text == '{"ok": true}'
    (record,) = records
    assert record.route == "safety.input"
    assert record.cost_gbp == 0
    assert (record.usage.input_tokens, record.usage.cache_read_tokens) == (100, 600)
    assert record.usage.output_tokens == 60


@pytest.mark.parametrize(
    ("outcome", "error"),
    [
        (httpx.Response(200, json=answer('{"ok": tr', finish="length")), LlmTruncatedError),
        (httpx.Response(200, json=answer("not json")), LlmOutputError),
        (httpx.Response(200, json=answer("[1, 2]")), LlmOutputError),
        (httpx.Response(200, json={"unexpected": True}), LlmUnavailableError),
        (httpx.Response(503, text="loading model"), LlmUnavailableError),
        (httpx.Response(400, text="bad schema"), LlmRequestError),
        (httpx.ConnectError("refused"), LlmUnavailableError),
        (httpx.ReadTimeout("too slow"), LlmUnavailableError),
    ],
)
def test_failures_are_the_same_typed_errors_as_claude(
    outcome: httpx.Response | Exception, error: type[Exception]
) -> None:
    llm, _ = client(outcome)
    with pytest.raises(error):
        call(llm)


def test_a_truncated_answer_is_still_recorded() -> None:
    records: list[CallRecord] = []
    llm, _ = client(httpx.Response(200, json=answer("{", finish="length")), records)
    with pytest.raises(LlmTruncatedError) as raised:
        call(llm)
    assert raised.value.record is records[0]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"prompt": "scene-spec"}, "no local model"),
        ({"route_name": "eval.judge"}, "no local model"),
        (
            {"messages": [{"role": "user", "content": [{"type": "image", "source": {}}]}]},
            "text only",
        ),
        ({"messages": [*USER, {"role": "assistant", "content": "{"}]}, "prefill"),
    ],
)
def test_what_the_local_model_cannot_do_is_refused_before_anything_is_sent(
    overrides: dict[str, Any], message: str
) -> None:
    llm, sent = client(httpx.Response(200, json=answer("{}")))
    if isinstance(overrides.get("prompt"), str):
        overrides = overrides | {"prompt": load_prompt(overrides["prompt"])}
    with pytest.raises(LlmRequestError, match=message):
        call(llm, **overrides)
    assert sent == []


def test_a_recorder_failure_never_loses_an_answer() -> None:
    def broken(_: CallRecord) -> None:
        raise RuntimeError("database is full")

    http = httpx.Client(
        base_url="http://127.0.0.1:8330",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=answer('{"a": 1}'))),
    )
    assert call(LocalLlmClient(http, recorder=broken)).data == {"a": 1}


def raw_config(local: Any) -> dict[str, Any]:
    return {
        "routes": {"tutor.turn": {"model": "claude-x", "thinking": "none"}},
        "pricing": {
            "usd_to_gbp": 0.8,
            "models": {"claude-x": {"input": 1, "output": 1, "cache_write": 1, "cache_read": 1}},
        },
        "local": local,
    }


GOOD = {
    "model": "small-model-q4",
    "file": "small-model.gguf",
    "context": 8192,
    "temperature": 0.2,
    "routes": ["tutor.turn"],
}


def test_a_config_without_a_local_model_still_loads() -> None:
    config = parse({k: v for k, v in raw_config(None).items() if k != "local"})
    assert config.local is None
    llm = LocalLlmClient(httpx.Client(), config=config)
    with pytest.raises(LlmRequestError, match="no local model"):
        call(llm)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"model": "claude-opus-4-8"}, "not a Claude model"),
        ({"file": "models/small.gguf"}, "no folders"),
        ({"file": "..\\small.gguf"}, "no folders"),
        ({"file": "small.bin"}, ".gguf"),
        ({"context": 512}, "context"),
        ({"temperature": 1.5}, "temperature"),
        ({"temperature": True}, "temperature"),
        ({"routes": ["scene.generate"]}, "routes"),
        ({"routes": []}, "routes"),
        ({"top_p": 0.9}, "exactly"),
    ],
)
def test_a_bad_local_block_is_refused(change: dict[str, Any], message: str) -> None:
    with pytest.raises(ModelConfigError, match=message):
        parse(raw_config(GOOD | change))


def test_sampling_is_set_when_the_server_starts() -> None:
    local = parse(raw_config(GOOD)).local
    assert local is not None
    args = server_args(local, Path("models"), port=9000)
    pairs = dict(zip(args[::2], args[1::2], strict=False))
    assert pairs["--model"] == str(Path("models") / "small-model.gguf")
    assert pairs["--alias"] == "small-model-q4"
    assert pairs["--host"] == "127.0.0.1"  # never reachable from another computer
    assert pairs["--port"] == "9000"
    assert pairs["--temp"] == "0.2"
    assert pairs["--ctx-size"] == str(8192 * SLOTS)
    assert pairs["--reasoning-budget"] == "0"


def test_tier_l_scenes_stay_off_on_the_local_model() -> None:
    settings = Settings(
        llm_provider="local",
        anthropic_api_key=SecretStr("sk"),
        anthropic_zdr_confirmed=True,
        eddy_environment="development",
    )
    assert tier_l_enabled(settings) is False
