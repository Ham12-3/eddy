"""The one way services/api calls Claude (SPEC.md section 10).

- The model, thinking and effort come from the route in config/models.yaml; nothing else is sent.
  No temperature, top_p or top_k, and no assistant prefill.
- Structured output through `output_config.format`, parsed and returned as a dict for the caller
  to validate (its schemas vary by scene template, so they are built at run time).
- Prompt caching: the prompt and any stable context form the system blocks, with the cache
  breakpoint on the last of them; anything about this student goes in the messages, after it.
- The SDK retries 408, 409, 429, 5xx and connection errors with backoff. What is left is mapped
  to typed errors: unavailable (try later, or fall back) or a bad request (never retried).
- Every call that returns is recorded as metadata only (`llm_call`): never prompt or response text.
"""

import json
import logging
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import anthropic

from eddy_api.llm.config import ModelConfig, model_config
from eddy_api.llm.prompts import Prompt

DEFAULT_MAX_TOKENS = 16000
MAX_RETRIES = 2
TIMEOUT_S = 90.0
log = logging.getLogger(__name__)


class LlmError(Exception):
    """A Claude call that produced nothing usable. `record` is set when the call was billed."""

    def __init__(self, message: str, record: "CallRecord | None" = None) -> None:
        super().__init__(message)
        self.record = record


class LlmUnavailableError(LlmError):
    """Rate limits, overload, server errors or the network, after the SDK's retries."""


class LlmRequestError(LlmError):
    """A request the API refused as malformed or unauthorised. Our fault: never retried."""


class LlmRefusalError(LlmError):
    """The model declined (stop_reason refusal)."""


class LlmTruncatedError(LlmError):
    """The answer hit max_tokens, so its JSON is incomplete."""


class LlmOutputError(LlmError):
    """The answer was not the JSON object the schema promised."""


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


@dataclass(frozen=True)
class CallRecord:
    route: str
    model: str
    prompt_id: str
    prompt_version: str
    usage: Usage
    latency_ms: int
    cost_gbp: float
    stop_reason: str | None
    student_id: uuid.UUID | None


@dataclass(frozen=True)
class StructuredResult:
    data: dict[str, Any]
    #: The JSON exactly as the model wrote it, to send back in a follow-up turn.
    text: str
    record: CallRecord


Recorder = Callable[[CallRecord], None]


def cost_gbp(config: ModelConfig, model: str, usage: Usage) -> float:
    price = config.price(model)
    dollars = (
        usage.input_tokens * price.input
        + usage.output_tokens * price.output
        + usage.cache_read_tokens * price.cache_read
        + usage.cache_write_tokens * price.cache_write
    ) / 1_000_000
    return round(dollars * config.usd_to_gbp, 6)


def _usage(response: Any) -> Usage:
    usage = response.usage
    return Usage(
        input_tokens=int(usage.input_tokens or 0),
        output_tokens=int(usage.output_tokens or 0),
        cache_read_tokens=int(getattr(usage, "cache_read_input_tokens", 0) or 0),
        cache_write_tokens=int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
    )


class LlmClient:
    def __init__(
        self,
        sdk: anthropic.Anthropic,
        *,
        config: ModelConfig | None = None,
        recorder: Recorder | None = None,
    ) -> None:
        self._sdk = sdk
        self._config = config or model_config()
        self._recorder = recorder

    @classmethod
    def from_key(cls, api_key: str, *, recorder: Recorder | None = None) -> "LlmClient":
        if not api_key:
            raise LlmRequestError("ANTHROPIC_API_KEY is not set (services/api/.env)")
        sdk = anthropic.Anthropic(api_key=api_key, max_retries=MAX_RETRIES, timeout=TIMEOUT_S)
        return cls(sdk, recorder=recorder)

    def request(
        self,
        *,
        prompt: Prompt,
        context: Sequence[str],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> dict[str, Any]:
        """The exact keyword arguments sent to the Messages API (tests read them)."""
        route = self._config.route(prompt.route)
        system: list[dict[str, Any]] = [{"type": "text", "text": prompt.text}]
        system += [{"type": "text", "text": block} for block in context]
        system[-1]["cache_control"] = {"type": "ephemeral"}
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if route.effort:
            output_config["effort"] = route.effort
        kwargs: dict[str, Any] = {
            "model": route.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            "output_config": output_config,
        }
        if route.thinking == "adaptive":
            kwargs["thinking"] = {"type": "adaptive"}
        if messages and messages[-1].get("role") == "assistant":
            raise LlmRequestError("No assistant prefill: the last message must be the user's")
        return kwargs

    def structured(
        self,
        *,
        prompt: Prompt,
        context: Sequence[str],
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        student_id: uuid.UUID | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> StructuredResult:
        kwargs = self.request(
            prompt=prompt, context=context, messages=messages, schema=schema, max_tokens=max_tokens
        )
        start = time.perf_counter()
        try:
            response = self._sdk.messages.create(**kwargs)
        except (
            anthropic.RateLimitError,
            anthropic.InternalServerError,
            anthropic.APIConnectionError,
        ) as error:
            raise LlmUnavailableError(type(error).__name__) from error
        except anthropic.APIStatusError as error:
            if error.status_code == 429 or error.status_code >= 500:
                raise LlmUnavailableError(f"HTTP {error.status_code}") from error
            raise LlmRequestError(f"HTTP {error.status_code}: {error.message}") from error
        latency_ms = round((time.perf_counter() - start) * 1000)

        usage = _usage(response)
        record = CallRecord(
            route=prompt.route,
            model=kwargs["model"],
            prompt_id=prompt.id,
            prompt_version=prompt.version,
            usage=usage,
            latency_ms=latency_ms,
            cost_gbp=cost_gbp(self._config, kwargs["model"], usage),
            stop_reason=response.stop_reason,
            student_id=student_id,
        )
        if self._recorder:
            try:
                self._recorder(record)
            except Exception:
                # The answer is paid for: keep it, and say the record is missing.
                log.exception("llm_call was not recorded for %s", prompt.route)

        if response.stop_reason == "refusal":
            raise LlmRefusalError("The model declined this request", record)
        if response.stop_reason == "max_tokens":
            raise LlmTruncatedError("The answer hit max_tokens", record)
        text = next((block.text for block in response.content if block.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise LlmOutputError("The answer was not JSON", record) from error
        if not isinstance(data, dict):
            raise LlmOutputError("The answer was not a JSON object", record)
        return StructuredResult(data=data, text=text, record=record)
