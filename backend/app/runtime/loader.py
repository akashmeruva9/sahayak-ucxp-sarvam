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
from .manifest_store import ManifestStoreUnavailable, fetch_manifests
from .normalize import is_published_shape, normalize


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
                # Published (Shopify-style) manifests are mapped to the internal
                # shape before validation — see runtime/normalize.py.
                internal = normalize(payload) if is_published_shape(payload) else payload
                manifest = Manifest.model_validate(internal)
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

    async def refresh_from_store(self) -> int:
        """Layer Supabase-published manifests over the local files.

        Local files are loaded first and kept as the floor, so an unreachable
        database degrades to the committed demo set rather than an empty
        directory. A published row replaces the file of the same id.

        Returns the number of manifests taken from the database.
        """
        self.reload()  # local files first — they are the fallback

        try:
            documents = await fetch_manifests(self.settings)
        except ManifestStoreUnavailable as exc:
            logger.info(f"manifests.store_skipped reason={exc} using={len(self._manifests)} local")
            return 0

        adopted = 0
        for raw in documents:
            try:
                payload = normalize(raw) if is_published_shape(raw) else raw
                manifest = Manifest.model_validate(payload)
            except ValidationError as exc:
                logger.error(
                    f"manifests.store_invalid business={raw.get('business_id')} errors={exc.error_count()}"
                )
                continue
            self._manifests[manifest.id] = manifest
            self._raw[manifest.id] = raw
            adopted += 1

        logger.info(
            f"manifests.store_loaded adopted={adopted} total={len(self._manifests)} "
            f"ids={sorted(self._manifests)}"
        )
        return adopted

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

    def full_catalogue(self) -> str:
        """Every business *with its capabilities*, for unscoped conversations.

        The general chat has no business in context, so the classifier must be
        able to answer "which business AND which capability" from one message.
        Showing only the business list means it can never return a valid
        capability id on the first turn, and the request degrades to small talk.
        """
        blocks: list[str] = []
        for manifest in self.all():
            domains = ", ".join(manifest.routing.domains[:8])
            header = f'- business_id: "{manifest.id}" — {manifest.business.name} ({manifest.business.category})'
            if domains:
                header += f"\n  handles: {domains}"
            for capability in manifest.capabilities:
                header += f'\n  · capability_id: "{capability.id}" — {capability.description}'
                if capability.required_inputs:
                    names = ", ".join(i.name for i in capability.required_inputs)
                    header += f" (inputs: {names})"
            blocks.append(header)
        return "\n".join(blocks)

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
