"""Structured output from the generated pydantic models (`eddy_api.llm.io`).

The API's JSON Schema support leaves out numeric bounds, string lengths, patterns and array
sizes, so the schema sent to Claude drops them; the same pydantic model then validates the
answer in full, so nothing the schema left out goes unchecked.
"""

from typing import Any

from pydantic import BaseModel, ValidationError

from eddy_api.llm.client import LlmOutputError, StructuredResult

UNSUPPORTED = frozenset(
    {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
        "title",
        "default",
        "examples",
        "description",
    }
)


def _strip(node: Any, names: bool = False) -> Any:
    """Drops unsupported keywords; `names` marks a properties map, whose keys are field names."""
    if isinstance(node, dict):
        return {
            k: _strip(v, names=k == "properties" and not names)
            for k, v in node.items()
            if names or k not in UNSUPPORTED
        }
    if isinstance(node, list):
        return [_strip(v) for v in node]
    return node


def output_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON Schema without the keywords structured output does not support."""
    schema: dict[str, Any] = _strip(model.model_json_schema())
    return schema


def parse[Model: BaseModel](model: type[Model], result: StructuredResult) -> Model:
    """Validates Claude's answer against the full model, bounds included."""
    try:
        return model.model_validate(result.data)
    except ValidationError as error:
        raise LlmOutputError(
            f"The answer did not match {model.__name__}: {error.errors()[0]['msg']}", result.record
        ) from error
