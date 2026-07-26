"""Configuration for the Sahayak AI Engine.

Every knob the engine has is read from the environment (``.env``) so that no
Sarvam-specific value is ever hard-coded in a caller.  Nothing in this module
knows anything about customer support, workflows or the UCXP runtime.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from dotenv import find_dotenv, load_dotenv
from pydantic import BaseModel, Field, field_validator

# Load .env once, as early as possible.  ``find_dotenv`` walks up from the CWD
# so the engine works whether it is started from the repo root or from within
# the package directory.
load_dotenv(find_dotenv(usecwd=True), override=False)


# --------------------------------------------------------------------------- #
# env helpers
# --------------------------------------------------------------------------- #
def _env(key: str, default: Any = None) -> Any:
    value = os.getenv(key)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env(key, default))
    except (TypeError, ValueError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(_env(key, default))
    except (TypeError, ValueError):
        return default


def _env_bool(key: str, default: bool) -> bool:
    raw = _env(key)
    if raw is None:
        return default
    return str(raw).lower() in {"1", "true", "yes", "y", "on"}


def _env_list(key: str, default: list[str]) -> list[str]:
    raw = _env(key)
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


DEFAULT_SUPPORTED_LANGUAGES = [
    "en-IN",
    "hi-IN",
    "bn-IN",
    "gu-IN",
    "kn-IN",
    "ml-IN",
    "mr-IN",
    "od-IN",
    "pa-IN",
    "ta-IN",
    "te-IN",
]


class Settings(BaseModel):
    """Immutable, validated view of the engine's environment."""

    model_config = {"frozen": True, "extra": "forbid"}

    # ---- credentials / transport ----------------------------------------- #
    sarvam_api_key: str = Field(default="", repr=False)
    sarvam_base_url: str = "https://api.sarvam.ai"
    request_timeout: float = 30.0
    connect_timeout: float = 10.0
    max_connections: int = 50

    # ---- retry policy ----------------------------------------------------- #
    max_retries: int = 2  # total attempts = max_retries + 1
    retry_base_delay: float = 0.5
    retry_max_delay: float = 8.0
    retry_jitter: float = 0.25

    # ---- speech to text --------------------------------------------------- #
    stt_endpoint: str = "/speech-to-text"
    stt_translate_endpoint: str = "/speech-to-text-translate"
    stt_model: str = "saarika:v2.5"
    stt_translate_model: str = "saaras:v2.5"
    #: Sarvam's realtime speech endpoints reject clips longer than this; longer
    #: audio needs their batch API. Checked up front when the duration is
    #: readable (WAV), so callers get a clear error instead of an upstream 400.
    stt_max_audio_seconds: float = 30.0

    # ---- translation ------------------------------------------------------ #
    translate_endpoint: str = "/translate"
    transliterate_endpoint: str = "/transliterate"
    lid_endpoint: str = "/text-lid"
    translate_model: str = "sarvam-translate:v1"
    translate_mode: str = "formal"
    translate_max_chars: int = 1500

    # ---- llm -------------------------------------------------------------- #
    llm_endpoint: str = "/v1/chat/completions"
    #: sarvam-30b / sarvam-105b are *reasoning* models: they spend completion
    #: tokens thinking before they emit any content, so the budget below has to
    #: cover the thinking as well as the answer. 105b finishes reliably; 30b
    #: often runs out mid-thought and returns null content.
    llm_model: str = "sarvam-105b"
    llm_temperature: float = 0.3
    llm_top_p: float = 1.0
    llm_max_tokens: int = 4096
    #: Hard ceiling for the truncation retry; also your plan's per-request cap
    #: (the "starter" tier allows 4096).
    llm_max_tokens_ceiling: int = 4096
    #: None, or one of low/medium/high.  Thinking cannot be switched off.
    llm_reasoning_effort: str | None = None
    #: Retry once with a bigger budget when the model is cut off mid-thought.
    llm_retry_on_truncation: bool = True
    llm_wiki_grounding: bool = False
    llm_max_history_turns: int = 12

    # ---- text to speech --------------------------------------------------- #
    tts_endpoint: str = "/text-to-speech"
    tts_model: str = "bulbul:v2"
    tts_speaker: str = "anushka"
    tts_pitch: float = 0.0
    tts_pace: float = 1.0
    tts_loudness: float = 1.0
    tts_sample_rate: int = 22050
    tts_max_chars: int = 1000
    tts_enable_preprocessing: bool = True

    # ---- language behaviour ----------------------------------------------- #
    default_language: str = "en-IN"
    pivot_language: str = "en-IN"  # language the LLM reasons in
    supported_languages: list[str] = Field(default_factory=lambda: list(DEFAULT_SUPPORTED_LANGUAGES))

    # ---- pipeline behaviour ----------------------------------------------- #
    #: When a non-critical stage fails (e.g. translating the answer back),
    #: return the best partial result instead of failing the whole request.
    graceful_degradation: bool = True
    #: Skip the translate hops entirely when the detected language already is
    #: the pivot language.
    skip_redundant_translation: bool = True

    # ---- prompts ----------------------------------------------------------- #
    prompts_dir: str | None = None
    prompt_hot_reload: bool = False
    default_prompt_key: str = "system"

    # ---- logging ----------------------------------------------------------- #
    log_level: str = "INFO"
    log_file: str | None = None
    log_json: bool = False
    log_payloads: bool = False  # never log transcripts/audio unless asked

    # ---- http surface (the engine's own service, not business APIs) -------- #
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    api_title: str = "Sahayak AI Engine"

    @field_validator("sarvam_base_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("log_level")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.upper()

    # ------------------------------------------------------------------ #
    @property
    def configured(self) -> bool:
        """True when an API key is present."""
        return bool(self.sarvam_api_key)

    def url(self, path: str) -> str:
        return f"{self.sarvam_base_url}/{path.lstrip('/')}"

    def is_supported(self, language_code: str) -> bool:
        return language_code in self.supported_languages

    @classmethod
    def from_env(cls) -> "Settings":
        """Build settings from the process environment."""
        return cls(
            sarvam_api_key=_env("SARVAM_API_KEY", "") or "",
            sarvam_base_url=_env("SARVAM_BASE_URL", "https://api.sarvam.ai"),
            request_timeout=_env_float("SARVAM_REQUEST_TIMEOUT", 30.0),
            connect_timeout=_env_float("SARVAM_CONNECT_TIMEOUT", 10.0),
            max_connections=_env_int("SARVAM_MAX_CONNECTIONS", 50),
            max_retries=_env_int("SARVAM_MAX_RETRIES", 2),
            retry_base_delay=_env_float("SARVAM_RETRY_BASE_DELAY", 0.5),
            retry_max_delay=_env_float("SARVAM_RETRY_MAX_DELAY", 8.0),
            retry_jitter=_env_float("SARVAM_RETRY_JITTER", 0.25),
            stt_endpoint=_env("SARVAM_STT_ENDPOINT", "/speech-to-text"),
            stt_translate_endpoint=_env("SARVAM_STT_TRANSLATE_ENDPOINT", "/speech-to-text-translate"),
            stt_model=_env("SARVAM_STT_MODEL", "saarika:v2.5"),
            stt_translate_model=_env("SARVAM_STT_TRANSLATE_MODEL", "saaras:v2.5"),
            stt_max_audio_seconds=_env_float("SARVAM_STT_MAX_AUDIO_SECONDS", 30.0),
            translate_endpoint=_env("SARVAM_TRANSLATE_ENDPOINT", "/translate"),
            transliterate_endpoint=_env("SARVAM_TRANSLITERATE_ENDPOINT", "/transliterate"),
            lid_endpoint=_env("SARVAM_LID_ENDPOINT", "/text-lid"),
            translate_model=_env("SARVAM_TRANSLATE_MODEL", "sarvam-translate:v1"),
            translate_mode=_env("SARVAM_TRANSLATE_MODE", "formal"),
            translate_max_chars=_env_int("SARVAM_TRANSLATE_MAX_CHARS", 1500),
            llm_endpoint=_env("SARVAM_LLM_ENDPOINT", "/v1/chat/completions"),
            llm_model=_env("SARVAM_LLM_MODEL", "sarvam-105b"),
            llm_temperature=_env_float("SARVAM_LLM_TEMPERATURE", 0.3),
            llm_top_p=_env_float("SARVAM_LLM_TOP_P", 1.0),
            llm_max_tokens=_env_int("SARVAM_LLM_MAX_TOKENS", 4096),
            llm_max_tokens_ceiling=_env_int("SARVAM_LLM_MAX_TOKENS_CEILING", 4096),
            llm_reasoning_effort=_env("SARVAM_LLM_REASONING_EFFORT"),
            llm_retry_on_truncation=_env_bool("SARVAM_LLM_RETRY_ON_TRUNCATION", True),
            llm_wiki_grounding=_env_bool("SARVAM_LLM_WIKI_GROUNDING", False),
            llm_max_history_turns=_env_int("SARVAM_LLM_MAX_HISTORY_TURNS", 12),
            tts_endpoint=_env("SARVAM_TTS_ENDPOINT", "/text-to-speech"),
            tts_model=_env("SARVAM_TTS_MODEL", "bulbul:v2"),
            tts_speaker=_env("SARVAM_TTS_SPEAKER", "anushka"),
            tts_pitch=_env_float("SARVAM_TTS_PITCH", 0.0),
            tts_pace=_env_float("SARVAM_TTS_PACE", 1.0),
            tts_loudness=_env_float("SARVAM_TTS_LOUDNESS", 1.0),
            tts_sample_rate=_env_int("SARVAM_TTS_SAMPLE_RATE", 22050),
            tts_max_chars=_env_int("SARVAM_TTS_MAX_CHARS", 1000),
            tts_enable_preprocessing=_env_bool("SARVAM_TTS_PREPROCESSING", True),
            default_language=_env("AI_ENGINE_DEFAULT_LANGUAGE", "en-IN"),
            pivot_language=_env("AI_ENGINE_PIVOT_LANGUAGE", "en-IN"),
            supported_languages=_env_list("AI_ENGINE_SUPPORTED_LANGUAGES", DEFAULT_SUPPORTED_LANGUAGES),
            graceful_degradation=_env_bool("AI_ENGINE_GRACEFUL_DEGRADATION", True),
            skip_redundant_translation=_env_bool("AI_ENGINE_SKIP_REDUNDANT_TRANSLATION", True),
            prompts_dir=_env("AI_ENGINE_PROMPTS_DIR"),
            prompt_hot_reload=_env_bool("AI_ENGINE_PROMPT_HOT_RELOAD", False),
            default_prompt_key=_env("AI_ENGINE_DEFAULT_PROMPT", "system"),
            log_level=_env("AI_ENGINE_LOG_LEVEL", "INFO"),
            log_file=_env("AI_ENGINE_LOG_FILE"),
            log_json=_env_bool("AI_ENGINE_LOG_JSON", False),
            log_payloads=_env_bool("AI_ENGINE_LOG_PAYLOADS", False),
            api_host=_env("AI_ENGINE_HOST", "0.0.0.0"),
            api_port=_env_int("AI_ENGINE_PORT", 8080),
            api_title=_env("AI_ENGINE_TITLE", "Sahayak AI Engine"),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings.from_env()


def reload_settings() -> Settings:
    """Re-read the environment (used by tests and by config hot-reload)."""
    get_settings.cache_clear()
    load_dotenv(find_dotenv(usecwd=True), override=True)
    return get_settings()
