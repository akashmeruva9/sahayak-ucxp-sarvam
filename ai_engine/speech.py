"""Speech-to-text.

Wraps Sarvam's ``/speech-to-text`` (transcribe in the spoken language) and
``/speech-to-text-translate`` (transcribe straight into English).  Callers get
a :class:`SpeechResponse`; they never see a multipart form.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any, BinaryIO

from loguru import logger

from .config import Settings, get_settings
from .models import AudioInput, Language, Service, Stage, normalize_language
from .schemas import SpeechResponse, new_request_id
from .utils import (
    InvalidRequestError,
    SarvamHTTPClient,
    SpeechError,
    truncate,
    wav_duration_seconds,
)

AudioLike = bytes | bytearray | str | Path | BinaryIO | AudioInput

#: Formats Sarvam accepts.  Anything else is passed through with a warning —
#: the API is the authority, this list only drives the content-type guess.
_AUDIO_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
}


def coerce_audio(audio: AudioLike, *, filename: str | None = None) -> AudioInput:
    """Normalise bytes / path / file object into an :class:`AudioInput`."""
    if isinstance(audio, AudioInput):
        return audio

    if isinstance(audio, (bytes, bytearray)):
        name = filename or "audio.wav"
        return AudioInput(content=bytes(audio), filename=name, content_type=_content_type(name))

    if isinstance(audio, (str, Path)):
        path = Path(audio)
        if not path.is_file():
            raise InvalidRequestError(f"Audio file not found: {path}")
        name = filename or path.name
        return AudioInput(content=path.read_bytes(), filename=name, content_type=_content_type(name))

    read = getattr(audio, "read", None)
    if callable(read):
        content = read()
        if not isinstance(content, (bytes, bytearray)):
            raise InvalidRequestError("Audio file object must be opened in binary mode")
        name = filename or getattr(audio, "name", "audio.wav")
        name = Path(str(name)).name
        return AudioInput(content=bytes(content), filename=name, content_type=_content_type(name))

    raise InvalidRequestError(f"Unsupported audio input type: {type(audio).__name__}")


def _content_type(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in _AUDIO_TYPES:
        return _AUDIO_TYPES[suffix]
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


class SpeechService:
    """Speech-to-text capability."""

    def __init__(self, client: SarvamHTTPClient, settings: Settings | None = None) -> None:
        self.client = client
        self.settings = settings or get_settings()

    async def transcribe(
        self,
        audio: AudioLike,
        *,
        language: str | Language | None = None,
        filename: str | None = None,
        translate_to_english: bool = False,
        request_id: str | None = None,
    ) -> SpeechResponse:
        """Transcribe audio.

        Args:
            audio: raw bytes, a path, a binary file object or an ``AudioInput``.
            language: spoken language if known.  ``None`` asks Sarvam to detect
                it, which is how the voice pipeline discovers the language.
            translate_to_english: use ``saaras`` so the transcript comes back in
                English in a single hop (skips a separate translate call).
        """
        request_id = request_id or new_request_id()
        payload = coerce_audio(audio, filename=filename)
        if not payload.content:
            raise SpeechError("Empty audio payload", stage=Stage.TRANSCRIBE)

        # Fail fast on over-long clips: the realtime endpoints reject them, and
        # a clear message here beats an upstream 400 three retries later.
        duration = wav_duration_seconds(payload.content)
        limit = self.settings.stt_max_audio_seconds
        if duration is not None and limit and duration > limit:
            raise SpeechError(
                f"Audio is {duration:.1f}s but Sarvam's realtime speech-to-text accepts at "
                f"most {limit:.0f}s. Split the clip, or use Sarvam's batch API for long audio.",
                service=Service.STT,
                stage=Stage.TRANSCRIBE,
                details={"duration_seconds": duration, "limit_seconds": limit},
            )

        lang = normalize_language(language, default=Language.UNKNOWN)
        service = Service.STT_TRANSLATE if translate_to_english else Service.STT
        endpoint = (
            self.settings.stt_translate_endpoint if translate_to_english else self.settings.stt_endpoint
        )

        form: dict[str, Any] = {
            "model": self.settings.stt_translate_model if translate_to_english else self.settings.stt_model
        }
        if not translate_to_english:
            # "unknown" is Sarvam's auto-detect sentinel for saarika.
            form["language_code"] = lang.value if lang.is_resolved else Language.UNKNOWN.value

        logger.debug(
            f"stt.request bytes={payload.size_bytes} file={payload.filename} "
            f"model={form['model']} language={form.get('language_code', 'auto')}"
        )

        body, elapsed = await self.client.request(
            "POST",
            endpoint,
            service=service,
            files={"file": payload.to_multipart()},
            data=form,
            language=lang,
            request_id=request_id,
        )

        transcript = (body.get("transcript") or body.get("text") or "").strip()
        detected = normalize_language(
            body.get("language_code") or body.get("detected_language_code"),
            default=lang if lang.is_resolved else Language.UNKNOWN,
        )
        if not transcript:
            raise SpeechError(
                "Sarvam returned an empty transcript — the audio may be silent or unsupported",
                service=service,
                stage=Stage.TRANSCRIBE,
                details={"language": detected.value},
            )

        response = SpeechResponse(
            request_id=request_id,
            transcript=transcript,
            detected_language=detected,
            translated_in_place=translate_to_english,
            duration_seconds=duration,
            raw=body,
        )
        response.latency.record(Stage.TRANSCRIBE, elapsed)
        response.latency.total_ms = round(elapsed, 2)
        logger.info(
            f"stt.done language={detected.value} chars={len(transcript)} "
            f"latency_ms={elapsed:.0f} text=\"{truncate(transcript, 80)}\""
        )
        return response
