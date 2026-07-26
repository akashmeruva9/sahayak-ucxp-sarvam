"""LLM access for the runtime.

Every call goes through :class:`ai_engine.SarvamOrchestrator`. The runtime never
imports httpx, never names a model, and never sees a retry — PLAN.md §2 rule 1.
LangGraph orchestrates; the AI Engine reasons.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from loguru import logger

from ai_engine import SarvamOrchestrator

from .renderer import render

PROMPTS_DIR = Path(__file__).parent / "prompts"

_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


@lru_cache(maxsize=16)
def load_prompt(name: str) -> str:
    """Read a prompt template from ``runtime/prompts`` (kept out of the code)."""
    path = PROMPTS_DIR / f"{name}.md"
    if not path.is_file():
        raise FileNotFoundError(f"Prompt '{name}' not found at {path}")
    return path.read_text(encoding="utf-8").strip()


def build_prompt(name: str, **variables: Any) -> str:
    """Render a runtime prompt. Blanks are fine here — prompts tolerate them."""
    return render(load_prompt(name), variables, strict=False)


def extract_json(content: str) -> dict[str, Any] | None:
    """Pull a JSON object out of an LLM reply.

    Reasoning models wrap output in fences or add a sentence of preamble, so
    try the fence, then the raw string, then the outermost braces.
    """
    if not content:
        return None

    candidates: list[str] = []
    fence = _JSON_FENCE.search(content)
    if fence:
        candidates.append(fence.group(1))
    candidates.append(content.strip())
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


async def think_json(
    engine: SarvamOrchestrator,
    prompt: str,
    *,
    step: str,
    user_text: str = "",
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Run a prompt expecting strict JSON back. Returns ``{}`` on any failure.

    Never raises: a classifier that falls over should degrade into "ask the
    user", not a 500.
    """
    response = await engine.reason(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_text or "Respond with the JSON object now."},
        ],
        max_tokens=max_tokens,
    )
    if not response.success:
        logger.error(f"llm.{step}.failed error={response.error}")
        return {}

    parsed = extract_json(response.content)
    if parsed is None:
        logger.warning(f"llm.{step}.unparseable content={response.content[:160]!r}")
        return {}
    logger.info(f"llm.{step}.ok keys={sorted(parsed)}")
    return parsed


async def think_text(
    engine: SarvamOrchestrator,
    prompt: str,
    *,
    step: str,
    user_text: str = "",
    max_tokens: int | None = None,
) -> str:
    """Run a prompt expecting prose. Returns ``""`` on failure so callers fall back."""
    response = await engine.reason(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_text or "Write the reply now."},
        ],
        max_tokens=max_tokens,
    )
    if not response.success:
        logger.error(f"llm.{step}.failed error={response.error}")
        return ""
    return response.content.strip()
