"""Text-to-speech.

Wraps Sarvam's ``/text-to-speech`` (``bulbul``).  Long answers are chunked to
respect the per-request character limit and the returned WAV clips are merged
back into a single base64 payload so callers get exactly one audio file.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from .config import Settings, get_settings
from .models import (
    BULBUL_V2_SPEAKERS,
    FEMALE_SPEAKERS,
    AudioFormat,
    Gender,
    Language,
    Service,
    Speaker,
    Stage,
    normalize_language,
)
from .schemas import TTSResponse, new_request_id
from .utils import SarvamHTTPClient, TTSError, chunk_text, merge_wav_base64, truncate


def resolve_speaker(speaker: str | Speaker | None, *, default: str) -> Speaker:
    """Coerce a speaker name, falling back to the configured default."""
    for candidate in (speaker, default, Speaker.ANUSHKA.value):
        if candidate is None:
            continue
        if isinstance(candidate, Speaker):
            return candidate
        try:
            return Speaker(str(candidate).strip().lower())
        except ValueError:
            logger.warning(f"tts.unknown_speaker speaker={candidate!r} falling back")
    return Speaker.ANUSHKA


class TTSService:
    """Speech synthesis capability."""

    def __init__(self, client: SarvamHTTPClient, settings: Settings | None = None) -> None:
        self.client = client
        self.settings = settings or get_settings()

    async def synthesize(
        self,
        text: str,
        *,
        language: str | Language | None = None,
        speaker: str | Speaker | None = None,
        pitch: float | None = None,
        pace: float | None = None,
        loudness: float | None = None,
        sample_rate: int | None = None,
        model: str | None = None,
        request_id: str | None = None,
    ) -> TTSResponse:
        """Speak *text* and return one base64 WAV clip."""
        request_id = request_id or new_request_id()
        text = (text or "").strip()
        if not text:
            raise TTSError("Cannot synthesize empty text", stage=Stage.SYNTHESIZE)

        target = normalize_language(language, default=self.settings.default_language)
        if not target.is_resolved:
            target = normalize_language(self.settings.default_language)
        voice = resolve_speaker(speaker, default=self.settings.tts_speaker)
        rate = sample_rate or self.settings.tts_sample_rate

        chunks = chunk_text(text, self.settings.tts_max_chars)
        clips: list[str] = []
        total_latency = 0.0

        for index, chunk in enumerate(chunks):
            payload: dict[str, Any] = {
                "text": chunk,
                "target_language_code": target.value,
                "speaker": voice.value,
                "model": model or self.settings.tts_model,
                "pitch": self.settings.tts_pitch if pitch is None else pitch,
                "pace": self.settings.tts_pace if pace is None else pace,
                "loudness": self.settings.tts_loudness if loudness is None else loudness,
                "speech_sample_rate": rate,
                "enable_preprocessing": self.settings.tts_enable_preprocessing,
            }
            body, elapsed = await self.client.request(
                "POST",
                self.settings.tts_endpoint,
                service=Service.TTS,
                json=payload,
                language=target,
                request_id=request_id,
            )
            total_latency += elapsed

            audios = body.get("audios") or ([body["audio"]] if body.get("audio") else [])
            if not audios:
                raise TTSError(
                    "Sarvam returned no audio",
                    service=Service.TTS,
                    stage=Stage.SYNTHESIZE,
                    details={"chunk": index, "language": target.value},
                )
            clips.extend(a for a in audios if a)

        merged = merge_wav_base64(clips)
        response = TTSResponse(
            request_id=request_id,
            audio_base64=merged,
            audio_format=AudioFormat.WAV,
            sample_rate=rate,
            language=target,
            speaker=voice.value,
            chunks=len(chunks),
        )
        response.latency.record(Stage.SYNTHESIZE, total_latency)
        response.latency.total_ms = round(total_latency, 2)
        logger.info(
            f"tts.done language={target.value} speaker={voice.value} chunks={len(chunks)} "
            f"bytes_b64={len(merged)} latency_ms={total_latency:.0f} text=\"{truncate(text, 60)}\""
        )
        return response

    def speaker_for_gender(self, gender: str | Gender | None) -> Speaker:
        """Pick a default voice for a requested gender."""
        if gender is None:
            return resolve_speaker(None, default=self.settings.tts_speaker)
        value = gender.value if isinstance(gender, Gender) else str(gender)
        return Speaker.ANUSHKA if value.lower().startswith("f") else Speaker.ABHILASH

    @staticmethod
    def available_speakers() -> dict[str, dict[str, list[str]]]:
        """Voices, grouped by model — they are not interchangeable."""

        def split(pool: set[Speaker]) -> dict[str, list[str]]:
            return {
                "female": sorted(s.value for s in pool if s in FEMALE_SPEAKERS),
                "male": sorted(s.value for s in pool if s not in FEMALE_SPEAKERS),
            }

        return {
            "bulbul:v2": split(BULBUL_V2_SPEAKERS),
            "bulbul:v3": split({s for s in Speaker if s not in BULBUL_V2_SPEAKERS}),
        }
