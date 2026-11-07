"""The Claude client: routes from config/models.yaml, the prompt registry, the exact request, typed
errors and cost records. A fake SDK stands in for the API, so nothing here calls Claude."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest

from eddy_api.llm.client import (
    CallRecord,
    LlmClient,
    LlmOutputError,
    LlmRefusalError,
    LlmRequestError,
    LlmTruncatedError,
    LlmUnavailableError,
    Usage,
    cost_gbp,
)
from eddy_api.llm.config import ModelConfigError, model_config, parse
from eddy_api.llm.prompts import PromptError, load_prompt, parse_prompt

SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}


class FakeMessages:
    def __init__(self, outcome: Any) -> None:
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def response(text: str, stop: str = "end_turn") -> SimpleNamespace:
    return SimpleNamespace(
        stop_reason=stop,
        content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=text),
        ],
        usage=SimpleNamespace(
            input_tokens=1000,
            output_tokens=2000,
            cache_read_input_tokens=3000,
            cache_creation_input_tokens=0,
        ),
    )


def client(outcome: Any, records: list[CallRecord] | None = None) -> tuple[LlmClient, FakeMessages]:
    messages = FakeMessages(outcome)
    sdk = SimpleNamespace(messages=messages)
    recorder = records.append if records is not None else None
    return LlmClient(sdk, recorder=recorder), messages  # type: ignore[arg-type]


def http_error(cls: type[anthropic.APIStatusError], status: int) -> anthropic.APIStatusError:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("failed", response=httpx2.Response(status, request=request), body=None)


def call(llm: LlmClient, messages: list[dict[str, Any]] | None = None) -> Any:
    return llm.structured(
        prompt=load_prompt("scene-spec"),
        context=["<scene_template>stable</scene_template>"],
        messages=messages or [{"role": "user", "content": "data"}],
        schema=SCHEMA,
    )


def test_routes_come_from_the_model_config() -> None:
    config = model_config()
    route = config.route("scene.generate")
    assert route.model.startswith("claude-")
    assert route.thinking == "adaptive"
    assert config.route("safety.input").effort is None
    with pytest.raises(ModelConfigError):
        config.route("nope")


@pytest.mark.parametrize(
    ("route", "message"),
    [
        ({"model": "claude-x", "thinking": "adaptive", "temperature": 0.2}, "temperature"),
        ({"model": "claude-x", "thinking": "none", "effort": "low"}, "takes no effort"),
        ({"model": "claude-x", "thinking": "enabled"}, "adaptive or none"),
        ({"model": "gpt-4", "thinking": "none"}, "Claude model"),
    ],
)
def test_bad_routes_are_refused(route: dict[str, Any], message: str) -> None:
    raw = {
        "routes": {"r": route},
        "pricing": {
            "usd_to_gbp": 0.8,
            "models": {
                route["model"]: {"input": 1, "output": 1, "cache_write": 1, "cache_read": 1}
            },
        },
    }
    with pytest.raises(ModelConfigError, match=message):
        parse(raw)


def test_prompts_have_semver_and_a_known_route(tmp_path: Path) -> None:
    for prompt_id in ("scene-spec", "scene-critique"):
        prompt = load_prompt(prompt_id)
        assert prompt.version.count(".") == 2
        model_config().route(prompt.route)
    with pytest.raises(PromptError, match="semver"):
        parse_prompt("x", "---\nid: x\nversion: 1.0\nroute: scene.generate\n---\nHello")
    with pytest.raises(PromptError, match="front matter id"):
        parse_prompt("x", "---\nid: y\nversion: 1.0.0\nroute: scene.generate\n---\nHello")
    with pytest.raises(ModelConfigError):
        parse_prompt("x", "---\nid: x\nversion: 1.0.0\nroute: nowhere\n---\nHello")


def test_the_request_follows_the_rules() -> None:
    llm, messages = client(response("{}"))
    call(llm)
    sent = messages.calls[0]
    assert not {"temperature", "top_p", "top_k"} & set(sent)
    assert sent["model"] == model_config().route("scene.generate").model
    assert sent["thinking"] == {"type": "adaptive"}
    assert sent["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert sent["output_config"]["effort"] == model_config().route("scene.generate").effort
    # Prompt first, stable context next, and the cache breakpoint on the last system block.
    assert "cache_control" not in sent["system"][0]
    assert sent["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert sent["messages"][-1]["role"] == "user"


def test_no_assistant_prefill() -> None:
    llm, _ = client(response("{}"))
    with pytest.raises(LlmRequestError, match="prefill"):
        call(llm, [{"role": "user", "content": "a"}, {"role": "assistant", "content": "{"}])


def test_a_good_answer_is_parsed_and_recorded() -> None:
    records: list[CallRecord] = []
    llm, _ = client(response(json.dumps({"beats": []})), records)
    result = call(llm)
    assert result.data == {"beats": []}
    [record] = records
    assert record.prompt_id == "scene-spec"
    assert record.usage.cache_read_tokens == 3000
    assert record.cost_gbp == cost_gbp(model_config(), record.model, record.usage)
    assert record.cost_gbp > 0


def test_cost_counts_cached_tokens_at_their_own_price() -> None:
    config = model_config()
    model = config.route("scene.generate").model
    price = config.price(model)
    usage = Usage(
        input_tokens=0, output_tokens=0, cache_read_tokens=1_000_000, cache_write_tokens=0
    )
    assert cost_gbp(config, model, usage) == round(price.cache_read * config.usd_to_gbp, 6)


@pytest.mark.parametrize(
    ("outcome", "error"),
    [
        (response("{}", stop="refusal"), LlmRefusalError),
        (response('{"beats": [', stop="max_tokens"), LlmTruncatedError),
        (response("not json"), LlmOutputError),
        (response("[1, 2]"), LlmOutputError),
        (http_error(anthropic.RateLimitError, 429), LlmUnavailableError),
        (http_error(anthropic.InternalServerError, 500), LlmUnavailableError),
        (http_error(anthropic.BadRequestError, 400), LlmRequestError),
        (http_error(anthropic.AuthenticationError, 401), LlmRequestError),
    ],
)
def test_failures_become_typed_errors(outcome: Any, error: type[Exception]) -> None:
    llm, _ = client(outcome)
    with pytest.raises(error):
        call(llm)


def test_a_missing_key_is_a_clear_error() -> None:
    with pytest.raises(LlmRequestError, match="ANTHROPIC_API_KEY"):
        LlmClient.from_key("")


def test_billed_failures_carry_their_cost_record() -> None:
    llm, _ = client(response('{"beats": [', stop="max_tokens"))
    with pytest.raises(LlmTruncatedError) as caught:
        call(llm)
    assert caught.value.record is not None
    assert caught.value.record.cost_gbp > 0


def test_a_recorder_failure_never_loses_a_paid_answer() -> None:
    def broken(_: CallRecord) -> None:
        raise RuntimeError("database is full")

    messages = FakeMessages(response(json.dumps({"beats": []})))
    llm = LlmClient(SimpleNamespace(messages=messages), recorder=broken)  # type: ignore[arg-type]
    assert call(llm).data == {"beats": []}


@pytest.mark.parametrize(
    ("url", "zdr", "key", "enabled"),
    [
        ("postgresql+psycopg://e:e@127.0.0.1:5442/eddy", False, "sk", True),
        ("postgresql+psycopg://e:e@localhost/eddy", False, "sk", True),
        ("postgresql+psycopg://e:e@db.example.org/eddy", False, "sk", False),
        ("postgresql+psycopg://e:e@127.0.0.1/eddy?host=db.example.org", False, "sk", False),
        ("postgresql+psycopg://e:e@localhost/eddy?hostaddr=10.0.0.5", False, "sk", False),
        ("postgresql+psycopg://e:e@db.example.org/eddy", True, "sk", True),
        ("postgresql+psycopg://e:e@127.0.0.1/eddy", True, "", False),
    ],
)
def test_tier_l_needs_a_key_and_zdr_or_a_local_database(
    url: str, zdr: bool, key: str, enabled: bool
) -> None:
    from pydantic import SecretStr

    from eddy_api.config import Settings, tier_l_enabled

    settings = Settings(
        database_url=SecretStr(url), anthropic_zdr_confirmed=zdr, anthropic_api_key=SecretStr(key)
    )
    assert tier_l_enabled(settings) is enabled
