"""Prompt management.

Prompts live as files in ``ai_engine/prompt_library`` (override with
``AI_ENGINE_PROMPTS_DIR``), never inline in code, so they can be edited,
versioned and reviewed without touching Python.  New prompts are added by
dropping a new ``.md`` file in the directory — or at runtime via
:meth:`PromptManager.register`.

File format::

    ---
    kind: business
    version: 2
    description: Tone and boundaries for the support persona
    variables: brand, escalation_email
    ---
    You are the voice of {{brand}} ...

Placeholders use ``{{name}}`` (not ``{}``) so prompt bodies can contain JSON
examples without escaping.
"""

from __future__ import annotations

import re
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from loguru import logger

from .config import Settings, get_settings
from .models import Language, PromptSpec, normalize_language
from .utils import InvalidRequestError

DEFAULT_PROMPT_DIR = Path(__file__).parent / "prompt_library"
_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_PROMPT_SUFFIXES = {".md", ".txt", ".prompt"}


class PromptManager:
    """Loads, renders and composes prompt templates."""

    def __init__(
        self,
        directory: str | Path | None = None,
        *,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        configured = directory or self.settings.prompts_dir
        self.directory = Path(configured) if configured else DEFAULT_PROMPT_DIR
        self._prompts: dict[str, PromptSpec] = {}
        self._lock = threading.RLock()
        self.reload()

    # -- loading ---------------------------------------------------------- #
    def reload(self) -> None:
        """Re-read every prompt file from disk."""
        with self._lock:
            loaded: dict[str, PromptSpec] = {}
            # Built-ins from the packaged library first, then the override dir,
            # so a project-supplied file with the same key wins.
            search_dirs = [DEFAULT_PROMPT_DIR]
            if self.directory != DEFAULT_PROMPT_DIR:
                search_dirs.append(self.directory)

            for directory in search_dirs:
                if not directory.is_dir():
                    logger.warning(f"prompts.dir_missing path={directory}")
                    continue
                for path in sorted(directory.iterdir()):
                    if path.suffix.lower() not in _PROMPT_SUFFIXES or path.name.startswith("_"):
                        continue
                    try:
                        spec = self._parse(path)
                    except OSError as exc:  # pragma: no cover - unreadable file
                        logger.error(f"prompts.load_failed file={path.name} error={exc}")
                        continue
                    loaded[spec.key] = spec

            # Keep prompts registered at runtime across a reload.
            for key, spec in self._prompts.items():
                if spec.kind == "runtime":
                    loaded.setdefault(key, spec)

            self._prompts = loaded
            logger.info(f"prompts.loaded count={len(loaded)} keys={sorted(loaded)}")

    @staticmethod
    def _parse(path: Path) -> PromptSpec:
        raw = path.read_text(encoding="utf-8")
        meta: dict[str, str] = {}
        match = _FRONTMATTER.match(raw)
        body = raw
        if match:
            body = raw[match.end() :]
            for line in match.group(1).splitlines():
                if ":" not in line or line.strip().startswith("#"):
                    continue
                key, _, value = line.partition(":")
                meta[key.strip().lower()] = value.strip().strip("\"'")

        template = body.strip()
        declared = [v.strip() for v in meta.get("variables", "").strip("[]").split(",") if v.strip()]
        return PromptSpec(
            key=meta.get("key") or path.stem,
            kind=meta.get("kind", "system"),
            version=meta.get("version", "1"),
            description=meta.get("description", ""),
            template=template,
            variables=declared or sorted(set(_PLACEHOLDER.findall(template))),
        )

    # -- access ------------------------------------------------------------ #
    def _maybe_hot_reload(self) -> None:
        if self.settings.prompt_hot_reload:
            self.reload()

    def keys(self) -> list[str]:
        self._maybe_hot_reload()
        return sorted(self._prompts)

    def all(self) -> dict[str, PromptSpec]:
        self._maybe_hot_reload()
        return dict(self._prompts)

    def has(self, key: str) -> bool:
        return key in self._prompts

    def get(self, key: str) -> PromptSpec:
        self._maybe_hot_reload()
        try:
            return self._prompts[key]
        except KeyError:
            raise InvalidRequestError(
                f"Unknown prompt '{key}'. Available prompts: {sorted(self._prompts)}"
            ) from None

    def register(self, key: str, template: str, *, description: str = "", version: str = "1") -> PromptSpec:
        """Add or replace a prompt at runtime (survives :meth:`reload`)."""
        spec = PromptSpec(
            key=key,
            kind="runtime",
            version=version,
            description=description,
            template=template.strip(),
            variables=sorted(set(_PLACEHOLDER.findall(template))),
        )
        with self._lock:
            self._prompts[key] = spec
        logger.info(f"prompts.registered key={key} version={version}")
        return spec

    # -- rendering ---------------------------------------------------------- #
    def render(self, key: str, /, **variables: Any) -> str:
        """Render a single prompt.  Unknown placeholders resolve to ``""``."""
        return self.render_template(self.get(key).template, **variables)

    @staticmethod
    def render_template(template: str, /, **variables: Any) -> str:
        missing: list[str] = []

        def substitute(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in variables or variables[name] is None:
                missing.append(name)
                return ""
            return str(variables[name])

        rendered = _PLACEHOLDER.sub(substitute, template)
        if missing:
            logger.debug(f"prompts.unfilled variables={sorted(set(missing))}")
        # Collapse blank lines left behind by empty substitutions.
        return re.sub(r"\n{3,}", "\n\n", rendered).strip()

    def compose(self, keys: Iterable[str], /, **variables: Any) -> str:
        """Join several prompts (system + business + workflow) into one string."""
        parts = [self.render(key, **variables) for key in keys if key]
        return "\n\n".join(part for part in parts if part)

    # -- convenience used by the orchestrator ------------------------------- #
    def system_prompt(
        self,
        keys: Iterable[str] | str | None = None,
        *,
        response_language: str | Language | None = None,
        user_language: str | Language | None = None,
        **variables: Any,
    ) -> str:
        """Build the system message for a reasoning call.

        ``keys`` defaults to the configured default prompt.  The engine always
        tells the model which language to answer in, because the pipeline
        translates that answer afterwards.
        """
        if keys is None:
            keys = [self.settings.default_prompt_key]
        elif isinstance(keys, str):
            keys = [keys]

        reply_lang = normalize_language(response_language or self.settings.pivot_language)
        user_lang = normalize_language(user_language, default=Language.UNKNOWN)
        return self.compose(
            keys,
            response_language=reply_lang.display_name,
            response_language_code=reply_lang.value,
            user_language=user_lang.display_name if user_lang.is_resolved else "unspecified",
            user_language_code=user_lang.value,
            **variables,
        )


@lru_cache(maxsize=1)
def get_prompt_manager() -> PromptManager:
    """Process-wide prompt manager."""
    return PromptManager()


def reload_prompts() -> PromptManager:
    manager = get_prompt_manager()
    manager.reload()
    return manager
