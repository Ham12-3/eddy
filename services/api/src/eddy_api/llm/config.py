"""Model routes and prices from config/models.yaml, the only place model IDs live (ADR-0005).

Each route names a model, whether it thinks (adaptive or not at all) and its effort. Sampling
settings (temperature, top_p, top_k) are refused here as well as by the API.
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
class ModelConfig:
    routes: dict[str, Route]
    prices: dict[str, Price]
    usd_to_gbp: float

    def route(self, name: str) -> Route:
        try:
            return self.routes[name]
        except KeyError:
            raise ModelConfigError(f"No route {name!r} in config/models.yaml") from None

    def price(self, model: str) -> Price:
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
    return ModelConfig(routes=routes, prices=prices, usd_to_gbp=float(pricing["usd_to_gbp"]))


@lru_cache
def model_config(path: Path = MODELS_FILE) -> ModelConfig:
    return parse(yaml.safe_load(path.read_bytes()))
