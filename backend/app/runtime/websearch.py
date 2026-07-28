"""Web search for businesses that have no UCXP manifest.

When a customer names a business we don't serve, the honest answer is "they
haven't published a manifest" — but we can still be useful: look them up and
hand over what we find, then invite them to onboard.

Provider-agnostic on purpose. Tavily, Brave and Serper all return the same
three fields we care about, so whichever key is present is the one we use.
No key ⇒ the feature is simply off and the runtime says so plainly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from ..config import RuntimeSettings


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str

    def as_line(self) -> str:
        return f"- {self.title} ({self.url})\n  {self.snippet}"


class SearchUnavailable(RuntimeError):
    """No provider is configured, or the provider refused."""


def _tavily(payload: dict[str, Any]) -> list[SearchResult]:
    return [
        SearchResult(r.get("title", ""), r.get("url", ""), (r.get("content") or "")[:400])
        for r in payload.get("results", [])
    ]


def _brave(payload: dict[str, Any]) -> list[SearchResult]:
    return [
        SearchResult(r.get("title", ""), r.get("url", ""), (r.get("description") or "")[:400])
        for r in (payload.get("web", {}) or {}).get("results", [])
    ]


def _serper(payload: dict[str, Any]) -> list[SearchResult]:
    return [
        SearchResult(r.get("title", ""), r.get("link", ""), (r.get("snippet") or "")[:400])
        for r in payload.get("organic", [])
    ]


async def search(query: str, settings: RuntimeSettings, *, limit: int = 4) -> list[SearchResult]:
    """Run *query* against whichever provider is configured.

    Raises :class:`SearchUnavailable` when nothing is set up, so the caller can
    say "I can't look that up" rather than silently returning nothing.
    """
    provider = settings.search_provider
    if provider == "none":
        raise SearchUnavailable("no search provider configured")

    timeout = settings.search_timeout_s
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "tavily":
                response = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": settings.tavily_api_key,
                        "query": query,
                        "max_results": limit,
                        "search_depth": "basic",
                    },
                )
                response.raise_for_status()
                results = _tavily(response.json())
            elif provider == "brave":
                response = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query, "count": limit},
                    headers={
                        "X-Subscription-Token": settings.brave_api_key,
                        "Accept": "application/json",
                    },
                )
                response.raise_for_status()
                results = _brave(response.json())
            elif provider == "serper":
                response = await client.post(
                    "https://google.serper.dev/search",
                    json={"q": query, "num": limit},
                    headers={"X-API-KEY": settings.serper_api_key},
                )
                response.raise_for_status()
                results = _serper(response.json())
            else:  # pragma: no cover - guarded by config validation
                raise SearchUnavailable(f"unknown search provider {provider!r}")
    except httpx.HTTPError as exc:
        logger.warning(f"websearch.failed provider={provider} error={exc}")
        raise SearchUnavailable(str(exc)) from exc

    results = [r for r in results if r.title and r.url][:limit]
    logger.info(f"websearch.done provider={provider} query={query!r} results={len(results)}")
    return results


def as_context(results: list[SearchResult]) -> str:
    return "\n".join(r.as_line() for r in results) or "(nothing found)"
