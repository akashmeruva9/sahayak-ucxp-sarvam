"""Public contracts of the AI Engine.

Everything the rest of Sahayak sees comes back as one of these models.
Callers never touch a Sarvam payload: they read these fields.

All responses share the same envelope::

    success        bool
    request_id     str        correlation id for logs
    latency        Latency    per-stage breakdown in milliseconds
    error          ErrorDetail | None
"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .models import AudioFormat, ErrorCode, Language, LLMUsage, Role, Stage


def new_request_id() -> str:
    return uuid.uuid4().hex


# --------------------------------------------------------------------------- #
# Common pieces
# --------------------------------------------------------------------------- #
class ErrorDetail(BaseModel):
    """Structured error returned instead of raising into the caller."""

    code: ErrorCode = ErrorCode.UNKNOWN
    message: str = ""
    stage: Stage | None = None
    service: str | None = None
    status_code: int | None = None
    retryable: bool = False
    attempts: int = 1
    details: dict[str, Any] = Field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover - convenience only
        where = f" [{self.stage.value}]" if self.stage else ""
        return f"{self.code.value}{where}: {self.message}"


class Latency(BaseModel):
    """Milliseconds spent per pipeline stage.  ``None`` means "did not run"."""

    detect_ms: float | None = None
    stt_ms: float | None = None
    translate_in_ms: float | None = None
    llm_ms: float | None = None
    translate_out_ms: float | None = None
    tts_ms: float | None = None
    total_ms: float = 0.0

    def record(self, stage: Stage, value: float) -> None:
        setattr(self, _STAGE_FIELDS[stage], round(value, 2))

    def add(self, stage: Stage, value: float) -> None:
        """Accumulate (used when a stage runs more than once, e.g. chunked TTS)."""
        field = _STAGE_FIELDS[stage]
        current = getattr(self, field) or 0.0
        setattr(self, field, round(current + value, 2))

    @property
    def breakdown(self) -> dict[str, float]:
        return {k: v for k, v in self.model_dump().items() if v is not None and k != "total_ms"}


_STAGE_FIELDS: dict[Stage, str] = {
    Stage.DETECT: "detect_ms",
    Stage.TRANSCRIBE: "stt_ms",
    Stage.TRANSLATE_IN: "translate_in_ms",
    Stage.REASON: "llm_ms",
    Stage.TRANSLATE_OUT: "translate_out_ms",
    Stage.SYNTHESIZE: "tts_ms",
}


class BaseResponse(BaseModel):
    """Envelope shared by every engine response."""

    model_config = ConfigDict(use_enum_values=False)

    success: bool = True
    request_id: str = Field(default_factory=new_request_id)
    latency: Latency = Field(default_factory=Latency)
    error: ErrorDetail | None = None

    @property
    def failed(self) -> bool:
        return not self.success

    def fail(self, error: ErrorDetail) -> "BaseResponse":
        self.success = False
        self.error = error
        return self


# --------------------------------------------------------------------------- #
# Per-capability responses
# --------------------------------------------------------------------------- #
class SpeechResponse(BaseResponse):
    """Result of speech-to-text."""

    transcript: str = ""
    detected_language: Language = Language.UNKNOWN
    #: True when Sarvam's speech-to-text-translate model was used (English out).
    translated_in_place: bool = False
    duration_seconds: float | None = None
    raw: dict[str, Any] = Field(default_factory=dict, exclude=True)


class TranslationResponse(BaseResponse):
    """Result of a text translation."""

    text: str = ""  # translated output
    source_text: str = ""
    source_language: Language = Language.UNKNOWN
    target_language: Language = Language.UNKNOWN
    #: True when the hop was a no-op because source == target.
    skipped: bool = False
    chunks: int = 1


class TransliterationResponse(BaseResponse):
    """Result of script conversion (same language, different script)."""

    text: str = ""
    source_text: str = ""
    source_language: Language = Language.UNKNOWN
    target_language: Language = Language.UNKNOWN


class DetectionResponse(BaseResponse):
    """Result of language identification."""

    language: Language = Language.UNKNOWN
    script: str | None = None
    text: str = ""
    #: "sarvam-lid" | "script-heuristic" | "caller" | "speech-to-text"
    source: str = "sarvam-lid"


class LLMResponse(BaseResponse):
    """Result of a reasoning call."""

    content: str = ""
    model: str = ""
    finish_reason: str | None = None
    usage: LLMUsage = Field(default_factory=LLMUsage)
    messages: list[dict[str, str]] = Field(default_factory=list, exclude=True)
    #: Chain of thought from the reasoning models. Kept for debugging, excluded
    #: from serialisation — it is long and must never reach an end user.
    reasoning: str = Field(default="", exclude=True)


class TTSResponse(BaseResponse):
    """Result of speech synthesis."""

    audio_base64: str = ""
    audio_format: AudioFormat = AudioFormat.WAV
    sample_rate: int = 22050
    language: Language = Language.UNKNOWN
    speaker: str = ""
    chunks: int = 1

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_base64)


class TextResponse(BaseResponse):
    """Full text pipeline: detect -> translate -> reason -> translate back."""

    input_text: str = ""
    detected_language: Language = Language.UNKNOWN
    translated_input: str = ""  # user text in the pivot language
    llm_response: str = ""  # answer in the pivot language
    response_text: str = ""  # answer in the user's language (what you show)
    model: str = ""
    usage: LLMUsage = Field(default_factory=LLMUsage)
    #: Stages that failed but were tolerated because of graceful degradation.
    degraded_stages: list[Stage] = Field(default_factory=list)


class VoiceResponse(BaseResponse):
    """Full voice pipeline: audio in, audio out."""

    detected_language: Language = Language.UNKNOWN
    transcript: str = ""  # what the user said, their language
    translated_text: str = ""  # transcript in the pivot language
    llm_response: str = ""  # answer in the pivot language
    response_text: str = ""  # answer in the user's language
    audio_base64: str = ""  # spoken answer
    audio_format: AudioFormat = AudioFormat.WAV
    sample_rate: int = 22050
    speaker: str = ""
    model: str = ""
    usage: LLMUsage = Field(default_factory=LLMUsage)
    degraded_stages: list[Stage] = Field(default_factory=list)

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_base64)


class HealthResponse(BaseModel):
    status: str = "ok"
    engine: str = "ai_engine"
    version: str = "1.0.0"
    configured: bool = False
    pivot_language: str = "en-IN"
    supported_languages: list[str] = Field(default_factory=list)
    prompts: list[str] = Field(default_factory=list)
    models: dict[str, str] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Request contracts (used by the engine's own HTTP surface)
# --------------------------------------------------------------------------- #
class ConversationTurn(BaseModel):
    role: Role
    content: str


class TextRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str | None = Field(default=None, description="Skip detection by passing e.g. 'hi-IN'.")
    target_language: str | None = Field(default=None, description="Reply language; defaults to detected.")
    prompt_key: str | None = None
    prompt_variables: dict[str, Any] = Field(default_factory=dict)
    history: list[ConversationTurn] = Field(default_factory=list)
    temperature: float | None = None
    max_tokens: int | None = None
    session_id: str | None = None


class VoiceRequest(BaseModel):
    """Voice pipeline options.  Audio itself is uploaded separately."""

    language: str | None = None
    target_language: str | None = None
    prompt_key: str | None = None
    prompt_variables: dict[str, Any] = Field(default_factory=dict)
    history: list[ConversationTurn] = Field(default_factory=list)
    speaker: str | None = None
    speak_response: bool = True
    temperature: float | None = None
    max_tokens: int | None = None
    session_id: str | None = None


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1)
    target_language: str
    source_language: str | None = None
    mode: str | None = None


class TransliterateRequest(BaseModel):
    text: str = Field(min_length=1)
    target_language: str
    source_language: str | None = None
    spoken_form: bool = False


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str | None = None
    speaker: str | None = None
    pace: float | None = None
    pitch: float | None = None
    loudness: float | None = None


class ReasonRequest(BaseModel):
    text: str | None = None
    messages: list[ConversationTurn] = Field(default_factory=list)
    prompt_key: str | None = None
    prompt_variables: dict[str, Any] = Field(default_factory=dict)
    temperature: float | None = None
    max_tokens: int | None = None


__all__ = [
    "BaseResponse",
    "ConversationTurn",
    "DetectionResponse",
    "ErrorDetail",
    "HealthResponse",
    "LLMResponse",
    "Latency",
    "ReasonRequest",
    "SpeakRequest",
    "SpeechResponse",
    "TTSResponse",
    "TextRequest",
    "TextResponse",
    "TranslateRequest",
    "TranslationResponse",
    "TransliterateRequest",
    "TransliterationResponse",
    "VoiceRequest",
    "VoiceResponse",
    "new_request_id",
]
