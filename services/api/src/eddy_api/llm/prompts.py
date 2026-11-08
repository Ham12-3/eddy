"""The prompt registry: `prompts/<id>.md`, each with a semver version and the route it runs on.

A prompt file starts with YAML front matter:

    ---
    id: scene-spec
    version: 1.0.0
    route: scene.generate
    ---

The version goes into every `llm_call` row and every generated scene, so an eval result or a
cached scene always says which wording produced it. Change the version with the wording.
"""

import hashlib
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from eddy_api.llm.config import REPO_ROOT, model_config

PROMPTS_DIR = REPO_ROOT / "prompts"
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
PROMPT_ID = re.compile(r"^[a-z][a-z0-9-]{0,62}$")


class PromptError(ValueError):
    pass


@dataclass(frozen=True)
class Prompt:
    id: str
    version: str
    route: str
    text: str
    sha256: str


def parse_prompt(prompt_id: str, source: str) -> Prompt:
    match = re.match(r"^---\n(.*?)\n---\n(.*)$", source, flags=re.DOTALL)
    if not match:
        raise PromptError(f"{prompt_id}: no front matter")
    meta = yaml.safe_load(match.group(1)) or {}
    text = match.group(2).strip()
    if meta.get("id") != prompt_id:
        raise PromptError(f"{prompt_id}: front matter id is {meta.get('id')!r}")
    version = str(meta.get("version", ""))
    if not SEMVER.match(version):
        raise PromptError(f"{prompt_id}: version {version!r} is not semver")
    route = meta.get("route")
    if not isinstance(route, str):
        raise PromptError(f"{prompt_id}: no route")
    model_config().route(route)
    if not text:
        raise PromptError(f"{prompt_id}: empty prompt")
    digest = hashlib.sha256(text.encode()).hexdigest()
    return Prompt(id=prompt_id, version=version, route=route, text=text, sha256=digest)


@lru_cache
def load_prompt(prompt_id: str, directory: Path = PROMPTS_DIR) -> Prompt:
    if not PROMPT_ID.match(prompt_id):
        raise PromptError(f"Bad prompt id {prompt_id!r}")
    path = directory / f"{prompt_id}.md"
    # Files are LF on every platform; tolerate CRLF from an editor on Windows.
    return parse_prompt(prompt_id, path.read_bytes().decode().replace("\r\n", "\n"))
