"""Cross-cutting plumbing: errors, retries, the HTTP client, logging, audio.

Nothing in here is Sarvam-endpoint specific — the four capability modules
(speech/translation/llm/tts) build on top of it.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import random
import re
import sys
import time
import unicodedata
import wave
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterator, Sequence, TypeVar

import httpx
from loguru import logger

from .config import Settings, get_settings
from .models import ErrorCode, Language, Service, Stage
from .schemas import ErrorDetail

T = TypeVar("T")


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class AIEngineError(Exception):
    """Base class for every error the engine raises internally.

    Orchestrator entry points convert these into :class:`ErrorDetail` so the
    caller gets a structured response instead of an exception.
    """

    code: ErrorCode = ErrorCode.UNKNOWN
    default_message = "AI engine error"

    def __init__(
        self,
        message: str | None = None,
        *,
        service: Service | str | None = None,
        stage: Stage | None = None,
        status_code: int | None = None,
        retryable: bool = False,
        attempts: int = 1,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.service = service.value if isinstance(service, Service) else service
        self.stage = stage
        self.status_code = status_code
        self.retryable = retryable
        self.attempts = attempts
        self.details = details or {}

    def to_detail(self, stage: Stage | None = None) -> ErrorDetail:
        return ErrorDetail(
            code=self.code,
            message=self.message,
            stage=stage or self.stage,
            service=self.service,
            status_code=self.status_code,
            retryable=self.retryable,
            attempts=self.attempts,
            details=self.details,
        )


class ConfigurationError(AIEngineError):
    code = ErrorCode.CONFIGURATION
    default_message = "AI engine is not configured"


class InvalidRequestError(AIEngineError):
    code = ErrorCode.INVALID_REQUEST
    default_message = "Invalid request"


class UpstreamError(AIEngineError):
    """Sarvam returned a non-2xx response."""

    code = ErrorCode.UPSTREAM
    default_message = "Sarvam API request failed"


class TimeoutError_(AIEngineError):
    code = ErrorCode.TIMEOUT
    default_message = "Sarvam API request timed out"


class RateLimitError(AIEngineError):
    code = ErrorCode.RATE_LIMITED
    default_message = "Rate limited by Sarvam"


class AuthenticationError(AIEngineError):
    code = ErrorCode.AUTHENTICATION
    default_message = "Sarvam rejected the API key"


class SpeechError(AIEngineError):
    code = ErrorCode.SPEECH_FAILED
    default_message = "Speech recognition failed"


class TranslationError(AIEngineError):
    code = ErrorCode.TRANSLATION_FAILED
    default_message = "Translation failed"


class LLMError(AIEngineError):
    code = ErrorCode.LLM_FAILED
    default_message = "LLM reasoning failed"


class TTSError(AIEngineError):
    code = ErrorCode.TTS_FAILED
    default_message = "Speech synthesis failed"


class LanguageDetectionError(AIEngineError):
    code = ErrorCode.DETECTION_FAILED
    default_message = "Language detection failed"


def to_error_detail(exc: BaseException, *, stage: Stage | None = None) -> ErrorDetail:
    """Normalise *any* exception into an :class:`ErrorDetail`."""
    if isinstance(exc, AIEngineError):
        return exc.to_detail(stage)
    return ErrorDetail(
        code=ErrorCode.UNKNOWN,
        message=f"{type(exc).__name__}: {exc}",
        stage=stage,
        retryable=False,
    )


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #
_LOGGING_READY = False


def configure_logging(settings: Settings | None = None) -> None:
    """Install the engine's loguru sinks.  Idempotent."""
    global _LOGGING_READY
    if _LOGGING_READY:
        return
    settings = settings or get_settings()
    logger.remove()
    logger.add(
        sys.stderr,
        level=settings.log_level,
        serialize=settings.log_json,
        backtrace=False,
        diagnose=False,
        format=(
            "<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | "
            "<cyan>ai_engine</cyan> | <level>{message}</level>"
        ),
    )
    if settings.log_file:
        logger.add(
            settings.log_file,
            level=settings.log_level,
            serialize=settings.log_json,
            rotation="20 MB",
            retention="7 days",
            enqueue=True,
        )
    _LOGGING_READY = True


def log_call(
    *,
    service: Service | str,
    latency_ms: float,
    success: bool,
    language: Language | str | None = None,
    endpoint: str | None = None,
    request_id: str | None = None,
    attempts: int = 1,
    error: str | None = None,
    **extra: Any,
) -> None:
    """One structured line per Sarvam call: latency, API, language, outcome."""
    service_name = service.value if isinstance(service, Service) else str(service)
    lang = language.value if isinstance(language, Language) else language
    payload = {
        "service": service_name,
        "endpoint": endpoint,
        "language": lang,
        "latency_ms": round(latency_ms, 2),
        "success": success,
        "attempts": attempts,
        "request_id": request_id,
        **extra,
    }
    line = " ".join(f"{k}={v}" for k, v in payload.items() if v is not None)
    if success:
        logger.bind(**payload).info(f"sarvam.call OK   {line}")
    else:
        logger.bind(**payload, error=error).error(f"sarvam.call FAIL {line} error={error}")


# --------------------------------------------------------------------------- #
# Latency measurement
# --------------------------------------------------------------------------- #
@dataclass
class Stopwatch:
    """Millisecond timer."""

    started: float = field(default_factory=time.perf_counter)

    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self.started) * 1000.0

    def reset(self) -> None:
        self.started = time.perf_counter()


@contextmanager
def measure(sink: list[float] | None = None) -> Iterator[Stopwatch]:
    watch = Stopwatch()
    try:
        yield watch
    finally:
        if sink is not None:
            sink.append(watch.elapsed_ms())


# --------------------------------------------------------------------------- #
# Retries
# --------------------------------------------------------------------------- #
RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 529}


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay: float = 0.5
    max_delay: float = 8.0
    jitter: float = 0.25

    @classmethod
    def from_settings(cls, settings: Settings) -> "RetryPolicy":
        return cls(
            max_attempts=max(1, settings.max_retries + 1),
            base_delay=settings.retry_base_delay,
            max_delay=settings.retry_max_delay,
            jitter=settings.retry_jitter,
        )

    def delay_for(self, attempt: int, retry_after: float | None = None) -> float:
        if retry_after is not None:
            return min(retry_after, self.max_delay)
        backoff = min(self.base_delay * (2 ** (attempt - 1)), self.max_delay)
        return backoff + random.uniform(0, self.jitter * backoff)


async def retry_async(
    operation: Callable[[], Awaitable[T]],
    *,
    policy: RetryPolicy,
    service: Service | str,
    on_retry: Callable[[int, AIEngineError, float], None] | None = None,
) -> T:
    """Run *operation*, retrying transient failures with exponential backoff."""
    last_error: AIEngineError | None = None
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return await operation()
        except AIEngineError as exc:
            exc.attempts = attempt
            last_error = exc
            if not exc.retryable or attempt >= policy.max_attempts:
                raise
            retry_after = exc.details.get("retry_after")
            delay = policy.delay_for(attempt, float(retry_after) if retry_after else None)
            service_name = service.value if isinstance(service, Service) else service
            logger.warning(
                f"sarvam.retry service={service_name} attempt={attempt}/{policy.max_attempts} "
                f"in={delay:.2f}s reason={exc.code.value}: {exc.message}"
            )
            if on_retry:
                on_retry(attempt, exc, delay)
            await asyncio.sleep(delay)
    assert last_error is not None  # pragma: no cover - loop always sets it
    raise last_error


# --------------------------------------------------------------------------- #
# HTTP client
# --------------------------------------------------------------------------- #
class SarvamHTTPClient:
    """Thin async wrapper over ``httpx`` that owns auth, retries and logging.

    This is the *only* place in the codebase that talks to ``api.sarvam.ai``.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.policy = RetryPolicy.from_settings(self.settings)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self.settings.sarvam_base_url,
            timeout=httpx.Timeout(
                self.settings.request_timeout,
                connect=self.settings.connect_timeout,
            ),
            limits=httpx.Limits(max_connections=self.settings.max_connections),
            transport=transport,
            headers={"User-Agent": "onesupport-ai-engine/1.0"},
        )

    # -- lifecycle ------------------------------------------------------- #
    async def aclose(self) -> None:
        if self._owns_client and not self._client.is_closed:
            await self._client.aclose()

    async def __aenter__(self) -> "SarvamHTTPClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    # -- auth ------------------------------------------------------------- #
    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        if not self.settings.sarvam_api_key:
            raise ConfigurationError(
                "SARVAM_API_KEY is not set. Add it to your .env before calling the engine."
            )
        headers = {
            # Sarvam's REST endpoints use the subscription-key header; the
            # OpenAI-compatible /v1 endpoints accept a bearer token. Sending
            # both keeps one client working across the whole surface.
            "api-subscription-key": self.settings.sarvam_api_key,
            "Authorization": f"Bearer {self.settings.sarvam_api_key}",
        }
        if extra:
            headers.update(extra)
        return headers

    # -- core request ------------------------------------------------------ #
    async def request(
        self,
        method: str,
        path: str,
        *,
        service: Service,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        language: Language | str | None = None,
        request_id: str | None = None,
    ) -> tuple[dict[str, Any], float]:
        """Perform a request with retries.  Returns ``(payload, latency_ms)``."""
        attempts_seen = {"n": 0}
        overall = Stopwatch()

        async def _once() -> tuple[dict[str, Any], float]:
            attempts_seen["n"] += 1
            watch = Stopwatch()
            try:
                response = await self._client.request(
                    method,
                    path,
                    json=json,
                    data=data,
                    files=files,
                    headers=self._headers(headers),
                    timeout=timeout or self.settings.request_timeout,
                )
            except httpx.TimeoutException as exc:
                raise TimeoutError_(
                    f"{service.value} timed out after {timeout or self.settings.request_timeout}s",
                    service=service,
                    retryable=True,
                    details={"path": path},
                ) from exc
            except httpx.HTTPError as exc:
                raise UpstreamError(
                    f"{service.value} transport error: {exc}",
                    service=service,
                    retryable=True,
                    details={"path": path},
                ) from exc

            elapsed = watch.elapsed_ms()
            if response.status_code >= 400:
                raise self._error_for(response, service)
            return self._parse(response, service), elapsed

        try:
            payload, elapsed = await retry_async(_once, policy=self.policy, service=service)
        except AIEngineError as exc:
            log_call(
                service=service,
                endpoint=path,
                latency_ms=overall.elapsed_ms(),  # wall time incl. retries+backoff
                success=False,
                language=language,
                request_id=request_id,
                attempts=attempts_seen["n"],
                error=exc.message,
            )
            raise
        log_call(
            service=service,
            endpoint=path,
            latency_ms=elapsed,
            success=True,
            language=language,
            request_id=request_id,
            attempts=attempts_seen["n"],
        )
        return payload, elapsed

    # -- helpers ------------------------------------------------------------ #
    @staticmethod
    def _parse(response: httpx.Response, service: Service) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamError(
                f"{service.value} returned a non-JSON response",
                service=service,
                status_code=response.status_code,
                retryable=False,
                details={"body": response.text[:500]},
            ) from exc
        if not isinstance(payload, dict):
            return {"data": payload}
        return payload

    @staticmethod
    def _error_for(response: httpx.Response, service: Service) -> AIEngineError:
        status = response.status_code
        message = _extract_error_message(response)
        details: dict[str, Any] = {"status": status, "body": response.text[:500]}
        retry_after = response.headers.get("retry-after")
        if retry_after:
            details["retry_after"] = retry_after

        if status in (401, 403):
            return AuthenticationError(message, service=service, status_code=status, details=details)
        if status == 429:
            return RateLimitError(
                message, service=service, status_code=status, retryable=True, details=details
            )
        if status == 422 or 400 <= status < 500:
            return UpstreamError(
                message,
                service=service,
                status_code=status,
                retryable=status in RETRYABLE_STATUS,
                details=details,
            )
        return UpstreamError(message, service=service, status_code=status, retryable=True, details=details)


def _extract_error_message(response: httpx.Response) -> str:
    """Pull the most human-useful message out of a Sarvam error body."""
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}: {response.text[:200] or response.reason_phrase}"
    if isinstance(body, dict):
        for key in ("error", "detail", "message"):
            value = body.get(key)
            if isinstance(value, str) and value:
                return f"HTTP {response.status_code}: {value}"
            if isinstance(value, dict):
                inner = value.get("message") or value.get("detail") or value.get("code")
                if inner:
                    return f"HTTP {response.status_code}: {inner}"
            if isinstance(value, list) and value:
                return f"HTTP {response.status_code}: {value[0]}"
    return f"HTTP {response.status_code}: {str(body)[:200]}"


# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।॥;:])\s+|\n+")


def chunk_text(text: str, max_chars: int) -> list[str]:
    """Split *text* into <= ``max_chars`` pieces, preferring sentence borders."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    pieces: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            pieces.append(sentence)
            continue
        # A single sentence longer than the limit: fall back to word packing.
        current = ""
        for word in sentence.split(" "):
            candidate = f"{current} {word}".strip()
            if len(candidate) > max_chars:
                if current:
                    pieces.append(current)
                current = word[:max_chars]
                for start in range(max_chars, len(word), max_chars):
                    pieces.append(word[start : start + max_chars])
                    current = ""
            else:
                current = candidate
        if current:
            pieces.append(current)

    # Greedily re-pack neighbouring sentences to minimise round trips.
    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        candidate = f"{buffer} {piece}".strip()
        if buffer and len(candidate) > max_chars:
            chunks.append(buffer)
            buffer = piece
        else:
            buffer = candidate
    if buffer:
        chunks.append(buffer)
    return chunks


#: Unicode block -> language, used when Sarvam's LID is unavailable/ambiguous.
_SCRIPT_TO_LANGUAGE: dict[str, Language] = {
    "DEVANAGARI": Language.HINDI,
    "BENGALI": Language.BENGALI,
    "GUJARATI": Language.GUJARATI,
    "GURMUKHI": Language.PUNJABI,
    "KANNADA": Language.KANNADA,
    "MALAYALAM": Language.MALAYALAM,
    "ORIYA": Language.ODIA,
    "TAMIL": Language.TAMIL,
    "TELUGU": Language.TELUGU,
    "ARABIC": Language.URDU,
    "LATIN": Language.ENGLISH,
}


def guess_language_from_script(text: str) -> Language:
    """Cheap offline fallback: pick the language of the dominant script."""
    counts: dict[str, int] = {}
    for char in text or "":
        if not char.isalpha():
            continue
        try:
            name = unicodedata.name(char)
        except ValueError:
            continue
        script = name.split(" ")[0]
        counts[script] = counts.get(script, 0) + 1
    if not counts:
        return Language.UNKNOWN
    dominant = max(counts, key=counts.__getitem__)
    return _SCRIPT_TO_LANGUAGE.get(dominant, Language.UNKNOWN)


def truncate(text: str, limit: int = 120) -> str:
    text = (text or "").replace("\n", " ")
    return text if len(text) <= limit else f"{text[:limit]}…"


# --------------------------------------------------------------------------- #
# Audio helpers
# --------------------------------------------------------------------------- #
def encode_audio(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def decode_audio(payload: str) -> bytes:
    try:
        return base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise TTSError(f"Sarvam returned audio that is not valid base64: {exc}") from exc


def merge_wav_base64(chunks: Sequence[str]) -> str:
    """Concatenate base64 WAV clips into one clip.

    Sarvam returns one clip per synthesis request; long answers are chunked, so
    the caller would otherwise receive several files.  If the clips turn out to
    be incompatible (different sample rates) we return the first one rather
    than emitting corrupt audio.
    """
    clips = [c for c in chunks if c]
    if not clips:
        return ""
    if len(clips) == 1:
        return clips[0]

    buffer = io.BytesIO()
    writer: wave.Wave_write | None = None
    try:
        for clip in clips:
            with wave.open(io.BytesIO(decode_audio(clip)), "rb") as reader:
                params = reader.getparams()
                if writer is None:
                    writer = wave.open(buffer, "wb")
                    writer.setnchannels(params.nchannels)
                    writer.setsampwidth(params.sampwidth)
                    writer.setframerate(params.framerate)
                writer.writeframes(reader.readframes(reader.getnframes()))
        if writer is not None:
            writer.close()
        return encode_audio(buffer.getvalue())
    except (wave.Error, EOFError, TTSError) as exc:
        logger.warning(f"audio.merge failed ({exc}); returning first chunk only")
        if writer is not None:
            try:
                writer.close()
            except Exception:  # pragma: no cover - best effort cleanup
                pass
        return clips[0]


def wav_duration_seconds(data: bytes) -> float | None:
    """Duration of a WAV payload, or ``None`` if it is not a readable WAV."""
    try:
        with wave.open(io.BytesIO(data), "rb") as reader:
            rate = reader.getframerate()
            return round(reader.getnframes() / rate, 3) if rate else None
    except (wave.Error, EOFError):
        return None
