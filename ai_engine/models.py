"""Domain models for the AI Engine.

These are the engine's *internal* vocabulary: languages, speakers, chat
messages, service identifiers.  Wire-level request/response contracts live in
:mod:`ai_engine.schemas`.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Languages
# --------------------------------------------------------------------------- #
class Language(str, Enum):
    """BCP-47 style codes accepted by Sarvam."""

    AUTO = "auto"
    UNKNOWN = "unknown"

    ENGLISH = "en-IN"
    HINDI = "hi-IN"
    BENGALI = "bn-IN"
    GUJARATI = "gu-IN"
    KANNADA = "kn-IN"
    MALAYALAM = "ml-IN"
    MARATHI = "mr-IN"
    ODIA = "od-IN"
    PUNJABI = "pa-IN"
    TAMIL = "ta-IN"
    TELUGU = "te-IN"
    ASSAMESE = "as-IN"
    URDU = "ur-IN"
    SANSKRIT = "sa-IN"
    NEPALI = "ne-IN"
    KONKANI = "kok-IN"
    MAITHILI = "mai-IN"
    SINDHI = "sd-IN"
    DOGRI = "doi-IN"
    KASHMIRI = "ks-IN"
    MANIPURI = "mni-IN"
    BODO = "brx-IN"
    SANTALI = "sat-IN"

    @classmethod
    def _missing_(cls, value: Any) -> "Language | None":
        if not isinstance(value, str):
            return None
        return _LANGUAGE_ALIASES.get(value.strip().lower())

    @property
    def display_name(self) -> str:
        return LANGUAGE_NAMES.get(self.value, self.value)

    @property
    def is_resolved(self) -> bool:
        """False for the sentinel values that do not name a real language."""
        return self not in (Language.AUTO, Language.UNKNOWN)


LANGUAGE_NAMES: dict[str, str] = {
    "en-IN": "English",
    "hi-IN": "Hindi",
    "bn-IN": "Bengali",
    "gu-IN": "Gujarati",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "od-IN": "Odia",
    "pa-IN": "Punjabi",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "as-IN": "Assamese",
    "ur-IN": "Urdu",
    "sa-IN": "Sanskrit",
    "ne-IN": "Nepali",
    "kok-IN": "Konkani",
    "mai-IN": "Maithili",
    "sd-IN": "Sindhi",
    "doi-IN": "Dogri",
    "ks-IN": "Kashmiri",
    "mni-IN": "Manipuri",
    "brx-IN": "Bodo",
    "sat-IN": "Santali",
}

#: Loose aliases so callers can pass "hi", "hindi", "en_IN" etc.
_LANGUAGE_ALIASES: dict[str, Language] = {}
for _code, _name in LANGUAGE_NAMES.items():
    _lang = Language(_code)
    _LANGUAGE_ALIASES[_code.lower()] = _lang
    _LANGUAGE_ALIASES[_code.lower().replace("-", "_")] = _lang
    _LANGUAGE_ALIASES[_code.split("-")[0].lower()] = _lang
    _LANGUAGE_ALIASES[_name.lower()] = _lang
_LANGUAGE_ALIASES.update({"": Language.UNKNOWN, "auto": Language.AUTO, "unknown": Language.UNKNOWN})


def normalize_language(value: str | Language | None, *, default: str | Language = Language.UNKNOWN) -> Language:
    """Best-effort coercion of anything language-shaped into a :class:`Language`."""
    if value is None:
        return Language(default) if not isinstance(default, Language) else default
    if isinstance(value, Language):
        return value
    try:
        return Language(value)
    except ValueError:
        return Language(default) if not isinstance(default, Language) else default


# --------------------------------------------------------------------------- #
# Speech / voice
# --------------------------------------------------------------------------- #
class Speaker(str, Enum):
    """Sarvam TTS voices.

    Voices are model-specific: a ``bulbul:v2`` speaker is rejected by
    ``bulbul:v3`` and vice versa.  Change ``SARVAM_TTS_MODEL`` and
    ``SARVAM_TTS_SPEAKER`` together.
    """

    # -- bulbul:v2 --
    ANUSHKA = "anushka"
    MANISHA = "manisha"
    VIDYA = "vidya"
    ARYA = "arya"
    ABHILASH = "abhilash"
    KARUN = "karun"
    HITESH = "hitesh"

    # -- bulbul:v3 --
    ADITYA = "aditya"
    RITU = "ritu"
    ASHUTOSH = "ashutosh"
    PRIYA = "priya"
    NEHA = "neha"
    RAHUL = "rahul"
    POOJA = "pooja"
    ROHAN = "rohan"
    SIMRAN = "simran"
    KAVYA = "kavya"
    AMIT = "amit"
    DEV = "dev"
    ISHITA = "ishita"
    SHREYA = "shreya"
    RATAN = "ratan"
    VARUN = "varun"
    MANAN = "manan"
    SUMIT = "sumit"
    ROOPA = "roopa"
    KABIR = "kabir"
    AAYAN = "aayan"
    SHUBH = "shubh"
    ADVAIT = "advait"
    ANAND = "anand"
    TANYA = "tanya"
    TARUN = "tarun"
    SUNNY = "sunny"
    MANI = "mani"
    GOKUL = "gokul"
    VIJAY = "vijay"
    SHRUTI = "shruti"
    SUHANI = "suhani"
    MOHIT = "mohit"
    KAVITHA = "kavitha"
    REHAN = "rehan"
    SOHAM = "soham"
    RUPALI = "rupali"
    NIHARIKA = "niharika"


BULBUL_V2_SPEAKERS = {
    Speaker.ANUSHKA,
    Speaker.MANISHA,
    Speaker.VIDYA,
    Speaker.ARYA,
    Speaker.ABHILASH,
    Speaker.KARUN,
    Speaker.HITESH,
}

FEMALE_SPEAKERS = {
    Speaker.ANUSHKA,
    Speaker.MANISHA,
    Speaker.VIDYA,
    Speaker.ARYA,
    Speaker.RITU,
    Speaker.PRIYA,
    Speaker.NEHA,
    Speaker.POOJA,
    Speaker.SIMRAN,
    Speaker.KAVYA,
    Speaker.ISHITA,
    Speaker.SHREYA,
    Speaker.ROOPA,
    Speaker.TANYA,
    Speaker.SHRUTI,
    Speaker.SUHANI,
    Speaker.KAVITHA,
    Speaker.RUPALI,
    Speaker.NIHARIKA,
}
MALE_SPEAKERS = {s for s in Speaker if s not in FEMALE_SPEAKERS}


class Gender(str, Enum):
    MALE = "Male"
    FEMALE = "Female"


class TranslationMode(str, Enum):
    FORMAL = "formal"
    MODERN_COLLOQUIAL = "modern-colloquial"
    CLASSIC_COLLOQUIAL = "classic-colloquial"
    CODE_MIXED = "code-mixed"


class OutputScript(str, Enum):
    ROMAN = "roman"
    FULLY_NATIVE = "fully-native"
    SPOKEN_FORM_IN_NATIVE = "spoken-form-in-native"


class AudioFormat(str, Enum):
    WAV = "wav"
    MP3 = "mp3"


# --------------------------------------------------------------------------- #
# Conversation
# --------------------------------------------------------------------------- #
class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    """One turn of a conversation, in the shape Sarvam's chat API expects."""

    role: Role
    content: str

    @classmethod
    def system(cls, content: str) -> "ChatMessage":
        return cls(role=Role.SYSTEM, content=content)

    @classmethod
    def user(cls, content: str) -> "ChatMessage":
        return cls(role=Role.USER, content=content)

    @classmethod
    def assistant(cls, content: str) -> "ChatMessage":
        return cls(role=Role.ASSISTANT, content=content)

    def to_wire(self) -> dict[str, str]:
        return {"role": self.role.value, "content": self.content}


# --------------------------------------------------------------------------- #
# Services & pipeline stages (used for logging + structured errors)
# --------------------------------------------------------------------------- #
class Service(str, Enum):
    STT = "speech_to_text"
    STT_TRANSLATE = "speech_to_text_translate"
    TRANSLATE = "translation"
    TRANSLITERATE = "transliteration"
    LID = "language_detection"
    LLM = "llm"
    TTS = "text_to_speech"


class Stage(str, Enum):
    DETECT = "detect_language"
    TRANSCRIBE = "speech_to_text"
    TRANSLATE_IN = "translate_to_pivot"
    REASON = "llm_reasoning"
    TRANSLATE_OUT = "translate_from_pivot"
    SYNTHESIZE = "text_to_speech"


class ErrorCode(str, Enum):
    CONFIGURATION = "configuration_error"
    UPSTREAM = "upstream_error"
    TIMEOUT = "timeout"
    RATE_LIMITED = "rate_limited"
    AUTHENTICATION = "authentication_error"
    INVALID_REQUEST = "invalid_request"
    SPEECH_FAILED = "speech_failed"
    TRANSLATION_FAILED = "translation_failed"
    LLM_FAILED = "llm_failed"
    TTS_FAILED = "tts_failed"
    DETECTION_FAILED = "language_detection_failed"
    UNKNOWN = "unknown_error"


class AudioInput(BaseModel):
    """Audio handed to the engine, normalised to raw bytes."""

    content: bytes
    filename: str = "audio.wav"
    content_type: str = "audio/wav"

    model_config = {"arbitrary_types_allowed": True}

    @property
    def size_bytes(self) -> int:
        return len(self.content)

    def to_multipart(self) -> tuple[str, bytes, str]:
        return (self.filename, self.content, self.content_type)


class LLMUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_wire(cls, payload: dict[str, Any] | None) -> "LLMUsage":
        payload = payload or {}
        return cls(
            prompt_tokens=int(payload.get("prompt_tokens") or 0),
            completion_tokens=int(payload.get("completion_tokens") or 0),
            total_tokens=int(payload.get("total_tokens") or 0),
        )


class PromptSpec(BaseModel):
    """A prompt template loaded from the prompt library."""

    key: str
    kind: str = "system"
    version: str = "1"
    description: str = ""
    template: str
    variables: list[str] = Field(default_factory=list)
