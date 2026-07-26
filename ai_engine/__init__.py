"""OneSupport AI Engine — one interface over every Sarvam AI capability.

The rest of the application talks to :class:`SarvamOrchestrator` and nothing
else::

    from ai_engine import SarvamOrchestrator

    async with SarvamOrchestrator() as engine:
        result = await engine.process_voice(audio_bytes)
        print(result.transcript, result.response_text, result.audio_base64)

No caller should import ``httpx``, build a Sarvam payload, or know which model
serves which capability.
"""

from .config import Settings, get_settings, reload_settings
from .models import (
    AudioFormat,
    AudioInput,
    ChatMessage,
    Gender,
    Language,
    LLMUsage,
    OutputScript,
    PromptSpec,
    Role,
    Service,
    Speaker,
    Stage,
    TranslationMode,
    normalize_language,
)
from .orchestrator import ENGINE_VERSION, SarvamOrchestrator
from .prompts import PromptManager, get_prompt_manager, reload_prompts
from .schemas import (
    DetectionResponse,
    ErrorDetail,
    HealthResponse,
    Latency,
    LLMResponse,
    SpeechResponse,
    TextResponse,
    TranslationResponse,
    TransliterationResponse,
    TTSResponse,
    VoiceResponse,
)
from .utils import (
    AIEngineError,
    AuthenticationError,
    ConfigurationError,
    InvalidRequestError,
    LanguageDetectionError,
    LLMError,
    RateLimitError,
    SpeechError,
    TranslationError,
    TTSError,
    UpstreamError,
    configure_logging,
)

__version__ = ENGINE_VERSION

__all__ = [
    # entry point
    "SarvamOrchestrator",
    # config
    "Settings",
    "get_settings",
    "reload_settings",
    "configure_logging",
    # prompts
    "PromptManager",
    "get_prompt_manager",
    "reload_prompts",
    # domain
    "AudioFormat",
    "AudioInput",
    "ChatMessage",
    "Gender",
    "Language",
    "LLMUsage",
    "OutputScript",
    "PromptSpec",
    "Role",
    "Service",
    "Speaker",
    "Stage",
    "TranslationMode",
    "normalize_language",
    # responses
    "DetectionResponse",
    "ErrorDetail",
    "HealthResponse",
    "Latency",
    "LLMResponse",
    "SpeechResponse",
    "TextResponse",
    "TranslationResponse",
    "TransliterationResponse",
    "TTSResponse",
    "VoiceResponse",
    # errors
    "AIEngineError",
    "AuthenticationError",
    "ConfigurationError",
    "InvalidRequestError",
    "LLMError",
    "LanguageDetectionError",
    "RateLimitError",
    "SpeechError",
    "TTSError",
    "TranslationError",
    "UpstreamError",
    "__version__",
]
