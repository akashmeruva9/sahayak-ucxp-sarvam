"""Manifest loading.

Reads `manifests/*.json` into validated :class:`Manifest` objects. Adding a
business means adding a file here — the runtime is never edited.
"""

from __future__ import annotations

import json
from pathlib import Path

from loguru import logger
from pydantic import ValidationError

from ..config import RuntimeSettings, get_settings
from ..schemas.manifest import Manifest


class ManifestRegistry:
    """All loaded manifests, indexed for routing."""

    def __init__(self, settings: RuntimeSettings | None = None) -> None:
        self.settings = settings or get_settings()
        self._manifests: dict[str, Manifest] = {}
        self._raw: dict[str, dict] = {}
        self.reload()

    # -- loading -------------------------------------------------------- #
    def reload(self) -> None:
        directory = self.settings.manifests_dir
        loaded: dict[str, Manifest] = {}
        raw: dict[str, dict] = {}

        if not directory.is_dir():
            logger.error(f"manifests.dir_missing path={directory}")
            self._manifests, self._raw = loaded, raw
            return

        for path in sorted(directory.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                manifest = Manifest.model_validate(payload)
            except (OSError, json.JSONDecodeError) as exc:
                logger.error(f"manifests.unreadable file={path.name} error={exc}")
                continue
            except ValidationError as exc:
                # A malformed manifest must be loud: it silently removes a
                # business from the demo otherwise.
                logger.error(f"manifests.invalid file={path.name} errors={exc.error_count()}")
                continue
            loaded[manifest.id] = manifest
            raw[manifest.id] = payload

        self._manifests, self._raw = loaded, raw
        logger.info(
            f"manifests.loaded count={len(loaded)} ids={sorted(loaded)} "
            f"capabilities={sum(len(m.capabilities) for m in loaded.values())}"
        )

    # -- access ---------------------------------------------------------- #
    def ids(self) -> list[str]:
        return sorted(self._manifests)

    def all(self) -> list[Manifest]:
        return [self._manifests[i] for i in self.ids()]

    def get(self, business_id: str | None) -> Manifest | None:
        if not business_id:
            return None
        return self._manifests.get(business_id)

    def raw(self, business_id: str) -> dict | None:
        """The original JSON — judges ask to see a manifest verbatim."""
        return self._raw.get(business_id)

    # -- routing --------------------------------------------------------- #
    def match_alias(self, text: str) -> str | None:
        """Cheap, deterministic business match on an explicit brand mention.

        Runs before any LLM call: if the user named the business, there is
        nothing to infer. The longest alias wins, so a two-word brand beats the
        single word it contains.
        """
        haystack = (text or "").lower()
        best: tuple[int, str] | None = None
        for manifest in self._manifests.values():
            for alias in [manifest.business.name, *manifest.routing.aliases]:
                needle = alias.lower().strip()
                if needle and needle in haystack:
                    if best is None or len(needle) > best[0]:
                        best = (len(needle), manifest.id)
        return best[1] if best else None

    def routing_catalogue(self) -> str:
        """Business candidates for the classifier — built from manifest data."""
        lines: list[str] = []
        for manifest in self.all():
            domains = ", ".join(manifest.routing.domains[:10])
            lines.append(f'- id: "{manifest.id}" — {manifest.business.name} ({manifest.business.category})')
            if domains:
                lines.append(f"  handles: {domains}")
        return "\n".join(lines)


_registry: ManifestRegistry | None = None


def get_registry() -> ManifestRegistry:
    global _registry
    if _registry is None:
        _registry = ManifestRegistry()
    return _registry
