"""Runtime configuration. Nothing business-specific may appear here."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from pydantic import BaseModel

load_dotenv(find_dotenv(usecwd=True), override=False)

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(key: str, default: str) -> str:
    value = os.getenv(key)
    return value.strip() if value and value.strip() else default


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env(key, str(default)))
    except ValueError:
        return default


class RuntimeSettings(BaseModel):
    """Every knob the UCXP runtime has."""

    model_config = {"frozen": True}

    manifests_dir: Path = REPO_ROOT / "manifests"
    #: Where the mock business APIs live. Manifests reference this as {{mock_base}}.
    mock_base_url: str = "http://127.0.0.1:8000/mock"
    host: str = "0.0.0.0"
    port: int = 8000
    #: Conversation turns kept for context.
    max_history_turns: int = 12
    #: Confidence below which we ask instead of acting.
    min_capability_confidence: float = 0.35
    action_timeout_s: float = 8.0
    #: When the third LLM prompt (respond.md) runs.
    #:   auto   — only when the manifest has no usable response template
    #:            (small talk, an action failure, a render error). Fast, and the
    #:            wording of a completed job stays deterministic.
    #:   always — every turn. Warmer phrasing, but adds a full reasoning round
    #:            trip (~7-20 s with sarvam-105b).
    #:   never  — template only; falls back to a fixed line when none renders.
    compose_with_llm: str = "auto"
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "RuntimeSettings":
        port = _env_int("UCXP_PORT", 8000)
        return cls(
            manifests_dir=Path(_env("UCXP_MANIFESTS_DIR", str(REPO_ROOT / "manifests"))),
            mock_base_url=_env("UCXP_MOCK_BASE_URL", f"http://127.0.0.1:{port}/mock"),
            host=_env("UCXP_HOST", "0.0.0.0"),
            port=port,
            max_history_turns=_env_int("UCXP_MAX_HISTORY_TURNS", 12),
            min_capability_confidence=float(_env("UCXP_MIN_CONFIDENCE", "0.35")),
            action_timeout_s=float(_env("UCXP_ACTION_TIMEOUT", "8")),
            compose_with_llm=_env("UCXP_COMPOSE_WITH_LLM", "auto").lower(),
            log_level=_env("UCXP_LOG_LEVEL", "INFO"),
        )


@lru_cache(maxsize=1)
def get_settings() -> RuntimeSettings:
    return RuntimeSettings.from_env()
