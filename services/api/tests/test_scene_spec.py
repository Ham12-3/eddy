"""The generated SceneSpec models agree with the JSON Schema packages/schemas emits."""

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import ValidationError

from eddy_api.scenes.spec import SceneSpec

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/schemas/generated/scene-spec.schema.json")
    .read_bytes()
    .decode()
)

EXAMPLE: dict[str, Any] = {
    "schema": "scene-spec/1",
    "template": "bar_model.share_in_ratio@1",
    "misconception": "RATIO_DIVIDE_BY_EACH_PART",
    "params": {"total": 45, "ratio": [2, 3], "unit": "GBP"},
    "studentAnswer": ["List", 22.5, 15],
    "correctAnswer": ["List", 18, 27],
    "beats": [
        {
            "kind": "show_given",
            "focus": ["total", "ratio"],
            "narration": "We need to share £45 in the ratio 2 to 3.",
        },
        {
            "kind": "reveal_correct",
            "focus": ["answer"],
            "narration": "So 2 parts is £18 and 3 parts is £27.",
        },
    ],
}


def variant(**changes: Any) -> dict[str, Any]:
    return {**EXAMPLE, **changes}


CASES: list[tuple[str, dict[str, Any], bool]] = [
    ("the SPEC example", EXAMPLE, True),
    ("an unknown key", variant(x=10), False),
    ("a colour on a beat", variant(beats=[{**EXAMPLE["beats"][0], "colour": "#f00"}]), False),
    ("seven beats", variant(beats=[EXAMPLE["beats"][0]] * 7), False),
    ("an unknown beat kind", variant(beats=[{**EXAMPLE["beats"][0], "kind": "explode"}]), False),
    ("a bad element id", variant(beats=[{**EXAMPLE["beats"][0], "focus": ["Bar parts"]}]), False),
    ("no beats", variant(beats=[]), False),
    ("a template without a version", variant(template="bar_model.share"), False),
    ("a lowercase misconception", variant(misconception="ratio_slip"), False),
    ("another schema version", variant(schema="scene-spec/2"), False),
    ("nested MathJSON", variant(studentAnswer=["Divide", ["Add", 1, 2], {"num": "3"}]), True),
]


@pytest.mark.parametrize(("name", "document", "valid"), CASES, ids=[c[0] for c in CASES])
def test_pydantic_agrees_with_the_json_schema(
    name: str, document: dict[str, Any], valid: bool
) -> None:
    schema_ok = jsonschema.Draft202012Validator(SCHEMA).is_valid(document)
    try:
        SceneSpec.model_validate(document)
        pydantic_ok = True
    except ValidationError:
        pydantic_ok = False
    assert (schema_ok, pydantic_ok) == (valid, valid), name


def test_round_trip_keeps_the_wire_names_and_whole_numbers() -> None:
    spec = SceneSpec.model_validate(EXAMPLE)
    # Compared as text: 13 must come back as 13, not 13.0 (the cache key hashes this JSON).
    assert json.dumps(spec.model_dump(mode="json", by_alias=True), sort_keys=True) == json.dumps(
        EXAMPLE, sort_keys=True
    )


def test_a_version_in_non_ascii_digits_is_refused() -> None:
    with pytest.raises(ValidationError):
        SceneSpec.model_validate(variant(template="bar_model.share_in_ratio@" + chr(0x661)))
