"""Model routes and prices from config/models.yaml, the only place model IDs live (ADR-0005).

Each route names a model, whether it thinks (adaptive or not at all) and its effort. Sampling
settings (temperature, top_p, top_k) are refused here as well as by the API.

The file may also name one local model (ADR-0036): a GGUF file served on this computer by
llama.cpp, for the routes it can answer. Its sampling is fixed here and applied when the model
server starts; requests never carry it.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, cast

import yaml

REPO_ROOT = Path(__file__).resolve().parents[5]
MODELS_FILE = REPO_ROOT / "config" / "models.yaml"

Thinking = Literal["adaptive", "none"]
EFFORTS = ("low", "medium", "high", "xhigh", "max")
FORBIDDEN = ("temperature", "top_p", "top_k")


class ModelConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Route:
    name: str
    model: str
    thinking: Thinking
    effort: str | None


@dataclass(frozen=True)
class Price:
    """US dollars per million tokens."""

    input: float
    output: float
    cache_write: float
    cache_read: float


@dataclass(frozen=True)
class LocalModel:
    """The model the desktop app runs on the student's own computer."""

    #: The name recorded on llm_call, and the alias the model server answers to.
    model: str
    #: The GGUF file's name, inside the models folder the app ships.
    file: str
    #: Context tokens for each of the server's slots.
    context: int
    temperature: float
    #: The routes it answers. Any other route has no local model.
    routes: tuple[str, ...]


FREE = Price(input=0.0, output=0.0, cache_write=0.0, cache_read=0.0)


@dataclass(frozen=True)
class ModelConfig:
    routes: dict[str, Route]
    prices: dict[str, Price]
    usd_to_gbp: float
    local: LocalModel | None = None

    def route(self, name: str) -> Route:
        try:
            return self.routes[name]
        except KeyError:
            raise ModelConfigError(f"No route {name!r} in config/models.yaml") from None

    def price(self, model: str) -> Price:
        if self.local is not None and model == self.local.model:
            return FREE  # it runs on the student's own computer
        try:
            return self.prices[model]
        except KeyError:
            raise ModelConfigError(f"No price for {model!r} in config/models.yaml") from None


def _route(name: str, raw: dict[str, Any]) -> Route:
    for key in FORBIDDEN:
        if key in raw:
            raise ModelConfigError(f"{name}: {key} is never sent (the API rejects it)")
    unknown = set(raw) - {"model", "thinking", "effort"}
    if unknown:
        raise ModelConfigError(f"{name}: unknown settings {sorted(unknown)}")
    thinking = raw.get("thinking")
    if thinking not in ("adaptive", "none"):
        raise ModelConfigError(f"{name}: thinking must be adaptive or none")
    effort = raw.get("effort")
    if effort is not None and effort not in EFFORTS:
        raise ModelConfigError(f"{name}: effort must be one of {', '.join(EFFORTS)}")
    if thinking == "none" and effort is not None:
        raise ModelConfigError(f"{name}: a route without thinking takes no effort")
    model = raw.get("model")
    if not isinstance(model, str) or not model.startswith("claude-"):
        raise ModelConfigError(f"{name}: model must be a Claude model ID")
    return Route(name=name, model=model, thinking=cast(Thinking, thinking), effort=effort)


LOCAL_KEYS = {"model", "file", "context", "temperature", "routes"}


def _local(raw: dict[str, Any], routes: dict[str, Route]) -> LocalModel:
    unknown = set(raw) - LOCAL_KEYS
    if unknown or LOCAL_KEYS - set(raw):
        raise ModelConfigError(f"local: needs exactly {sorted(LOCAL_KEYS)}")
    model, file = raw["model"], raw["file"]
    if not isinstance(model, str) or not model or model.startswith("claude-") or len(model) > 64:
        raise ModelConfigError("local: model must be a short name that is not a Claude model ID")
    if not isinstance(file, str) or not file.endswith(".gguf") or "/" in file or "\\" in file:
        raise ModelConfigError("local: file must be the name of a .gguf file, with no folders")
    context, temperature = raw["context"], raw["temperature"]
    if not isinstance(context, int) or isinstance(context, bool) or not 2048 <= context <= 32768:
        raise ModelConfigError("local: context must be a whole number from 2048 to 32768")
    if isinstance(temperature, bool) or not isinstance(temperature, int | float):
        raise ModelConfigError("local: temperature must be a number")
    if not 0 <= temperature <= 1:
        raise ModelConfigError("local: temperature must be from 0 to 1")
    names = raw["routes"]
    if not isinstance(names, list) or not names or any(name not in routes for name in names):
        raise ModelConfigError("local: routes must list routes that exist above")
    return LocalModel(
        model=model,
        file=file,
        context=context,
        temperature=float(temperature),
        routes=tuple(names),
    )


def parse(raw: dict[str, Any]) -> ModelConfig:
    routes = {name: _route(name, value) for name, value in raw["routes"].items()}
    pricing = raw["pricing"]
    prices = {
        model: Price(
            input=float(p["input"]),
            output=float(p["output"]),
            cache_write=float(p["cache_write"]),
            cache_read=float(p["cache_read"]),
        )
        for model, p in pricing["models"].items()
    }
    for route in routes.values():
        if route.model not in prices:
            raise ModelConfigError(f"{route.name}: no price for {route.model}")
    local = _local(raw["local"], routes) if raw.get("local") is not None else None
    return ModelConfig(
        routes=routes, prices=prices, usd_to_gbp=float(pricing["usd_to_gbp"]), local=local
    )


@lru_cache
def model_config(path: Path = MODELS_FILE) -> ModelConfig:
    return parse(yaml.safe_load(path.read_bytes()))
