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
    #: Root for real connectors (Shopify, …). Normalised manifest endpoints use
    #: this as {{connector_base}}.
    connector_base_url: str = "http://127.0.0.1:8000"
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

    # --- WhatsApp transport (Twilio sandbox). Generic messaging config, not
    #     business behaviour — see PLAN.md §7 #10. Empty when unused. ---
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    #: Reply with a spoken voice note in addition to text. Off by default —
    #: text is instant and never fails; voice adds a TTS round trip + media fetch.
    whatsapp_speak: bool = False
    #: Pin the WhatsApp channel to a single business (its dedicated support line).
    #: When set, every WhatsApp turn resolves against this business — no
    #: cross-business routing. Empty ⇒ WhatsApp routes like the app.
    whatsapp_business: str = ""
    #: Send an instant "working on it…" ack while resolution runs. WhatsApp
    #: can't unsend it afterwards, so turn this OFF for a clean single-reply
    #: chat (the answer just arrives ~20 s later). ON keeps the reassurance.
    whatsapp_ack: bool = True

    @property
    def whatsapp_enabled(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token)

    @classmethod
    def from_env(cls) -> "RuntimeSettings":
        # Hosting platforms (Railway, Render, Fly, Cloud Run) inject $PORT and
        # expect the server to bind it. The runtime also calls its own mock and
        # connector routes over loopback, so if this resolves to the wrong port
        # every capability fails at `act` while /health still looks green.
        port = _env_int("UCXP_PORT", _env_int("PORT", 8000))
        return cls(
            manifests_dir=Path(_env("UCXP_MANIFESTS_DIR", str(REPO_ROOT / "manifests"))),
            mock_base_url=_env("UCXP_MOCK_BASE_URL", f"http://127.0.0.1:{port}/mock"),
            connector_base_url=_env("UCXP_CONNECTOR_BASE_URL", f"http://127.0.0.1:{port}"),
            host=_env("UCXP_HOST", "0.0.0.0"),
            port=port,
            max_history_turns=_env_int("UCXP_MAX_HISTORY_TURNS", 12),
            min_capability_confidence=float(_env("UCXP_MIN_CONFIDENCE", "0.35")),
            action_timeout_s=float(_env("UCXP_ACTION_TIMEOUT", "8")),
            compose_with_llm=_env("UCXP_COMPOSE_WITH_LLM", "auto").lower(),
            log_level=_env("UCXP_LOG_LEVEL", "INFO"),
            twilio_account_sid=_env("TWILIO_ACCOUNT_SID", ""),
            twilio_auth_token=_env("TWILIO_AUTH_TOKEN", ""),
            whatsapp_speak=_env("UCXP_WHATSAPP_SPEAK", "0").lower() in ("1", "true", "yes"),
            whatsapp_business=_env("UCXP_WHATSAPP_BUSINESS", ""),
            whatsapp_ack=_env("UCXP_WHATSAPP_ACK", "1").lower() in ("1", "true", "yes"),
        )


@lru_cache(maxsize=1)
def get_settings() -> RuntimeSettings:
    return RuntimeSettings.from_env()
