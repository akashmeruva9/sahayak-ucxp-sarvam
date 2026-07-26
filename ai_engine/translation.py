"""Translation and language identification.

Wraps Sarvam's ``/translate`` and ``/text-lid``.  Handles chunking for long
inputs, no-op hops (source == target) and a script-based offline fallback when
language identification is unavailable.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from .config import Settings, get_settings
from .models import Language, Service, Stage, TranslationMode, normalize_language
from .schemas import (
    DetectionResponse,
    TranslationResponse,
    TransliterationResponse,
    new_request_id,
)
from .utils import (
    AIEngineError,
    SarvamHTTPClient,
    TranslationError,
    chunk_text,
    guess_language_from_script,
    truncate,
)


class TranslationService:
    """Translation + language detection capability."""

    def __init__(self, client: SarvamHTTPClient, settings: Settings | None = None) -> None:
        self.client = client
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ #
    # Language identification
    # ------------------------------------------------------------------ #
    async def detect(
        self,
        text: str,
        *,
        request_id: str | None = None,
        fallback: str | Language | None = None,
    ) -> DetectionResponse:
        """Identify the language of *text*.

        Never raises: if Sarvam's LID is unavailable or inconclusive we fall
        back to the dominant Unicode script, then to the configured default.
        Language detection is too cheap a stage to fail a whole pipeline over.
        """
        request_id = request_id or new_request_id()
        default = normalize_language(fallback or self.settings.default_language)
        text = (text or "").strip()
        if not text:
            return DetectionResponse(request_id=request_id, language=default, text=text, source="default")

        try:
            body, elapsed = await self.client.request(
                "POST",
                self.settings.lid_endpoint,
                service=Service.LID,
                json={"input": text},
                request_id=request_id,
            )
            detected = normalize_language(body.get("language_code"), default=Language.UNKNOWN)
            script = body.get("script_code")
            source = "sarvam-lid"
        except AIEngineError as exc:
            logger.warning(f"lid.failed falling_back_to_script error={exc.message}")
            detected, script, elapsed, source = Language.UNKNOWN, None, 0.0, "script-heuristic"

        if not detected.is_resolved:
            guessed = guess_language_from_script(text)
            detected = guessed if guessed.is_resolved else default
            source = "script-heuristic" if guessed.is_resolved else "default"

        response = DetectionResponse(
            request_id=request_id,
            language=detected,
            script=script,
            text=text,
            source=source,
        )
        response.latency.record(Stage.DETECT, elapsed)
        response.latency.total_ms = round(elapsed, 2)
        logger.info(f"lid.done language={detected.value} source={source} latency_ms={elapsed:.0f}")
        return response

    # ------------------------------------------------------------------ #
    # Translation
    # ------------------------------------------------------------------ #
    async def translate(
        self,
        text: str,
        *,
        target_language: str | Language,
        source_language: str | Language | None = None,
        mode: str | TranslationMode | None = None,
        stage: Stage = Stage.TRANSLATE_IN,
        request_id: str | None = None,
    ) -> TranslationResponse:
        """Translate *text* into ``target_language``.

        ``source_language=None`` lets Sarvam auto-detect.  Long inputs are split
        on sentence boundaries and reassembled.
        """
        request_id = request_id or new_request_id()
        text = (text or "").strip()
        target = normalize_language(target_language, default=self.settings.pivot_language)
        source = normalize_language(source_language, default=Language.AUTO)

        if not text:
            raise TranslationError("Cannot translate empty text", stage=stage)
        if not target.is_resolved:
            raise TranslationError(f"Invalid target language: {target_language!r}", stage=stage)

        # /translate rejects "auto" — it wants a real source code — so resolve
        # an unknown source with language identification first.
        detect_latency = 0.0
        if not source.is_resolved:
            detection = await self.detect(text, request_id=request_id)
            source = detection.language
            detect_latency = detection.latency.detect_ms or 0.0
            logger.debug(f"translate.source_resolved language={source.value} via={detection.source}")

        # No-op hop: nothing to gain from a round trip.
        if self.settings.skip_redundant_translation and source == target:
            logger.debug(f"translate.skipped language={target.value} (source == target)")
            skipped = TranslationResponse(
                request_id=request_id,
                text=text,
                source_text=text,
                source_language=source,
                target_language=target,
                skipped=True,
            )
            skipped.latency.record(stage, detect_latency)
            skipped.latency.total_ms = round(detect_latency, 2)
            return skipped

        chunks = chunk_text(text, self.settings.translate_max_chars)
        translated_parts: list[str] = []
        detected_source = source
        total_latency = detect_latency

        for index, chunk in enumerate(chunks):
            payload: dict[str, Any] = {
                "input": chunk,
                "source_language_code": detected_source.value
                if detected_source.is_resolved
                else self.settings.default_language,
                "target_language_code": target.value,
                "model": self.settings.translate_model,
                "mode": (mode.value if isinstance(mode, TranslationMode) else mode)
                or self.settings.translate_mode,
                "enable_preprocessing": True,
            }
            body, elapsed = await self.client.request(
                "POST",
                self.settings.translate_endpoint,
                service=Service.TRANSLATE,
                json=payload,
                language=target,
                request_id=request_id,
            )
            total_latency += elapsed

            part = (body.get("translated_text") or body.get("output") or "").strip()
            if not part:
                raise TranslationError(
                    "Sarvam returned an empty translation",
                    service=Service.TRANSLATE,
                    stage=stage,
                    details={"chunk": index, "target": target.value},
                )
            translated_parts.append(part)

            if index == 0:
                # Reuse the detected source for the remaining chunks so a long
                # message cannot flip languages half way through.
                detected_source = normalize_language(
                    body.get("source_language_code"), default=detected_source
                )

        translated = " ".join(translated_parts)
        response = TranslationResponse(
            request_id=request_id,
            text=translated,
            source_text=text,
            source_language=detected_source,
            target_language=target,
            chunks=len(chunks),
        )
        response.latency.record(stage, total_latency)
        response.latency.total_ms = round(total_latency, 2)
        logger.info(
            f"translate.done {detected_source.value}->{target.value} chunks={len(chunks)} "
            f"latency_ms={total_latency:.0f} text=\"{truncate(translated, 80)}\""
        )
        return response

    # ------------------------------------------------------------------ #
    # Transliteration (same language, different script)
    # ------------------------------------------------------------------ #
    async def transliterate(
        self,
        text: str,
        *,
        target_language: str | Language,
        source_language: str | Language | None = None,
        spoken_form: bool = False,
        numerals_format: str = "international",
        request_id: str | None = None,
    ) -> TransliterationResponse:
        """Convert *text* between scripts, e.g. ``"नमस्ते"`` -> ``"namaste"``.

        Useful for showing a romanised version of a native-script reply, and for
        preparing text that a TTS voice should read in spoken form.
        """
        request_id = request_id or new_request_id()
        text = (text or "").strip()
        if not text:
            raise TranslationError("Cannot transliterate empty text", stage=Stage.TRANSLATE_OUT)

        target = normalize_language(target_language, default=self.settings.default_language)
        source = normalize_language(source_language, default=Language.AUTO)

        # Like /translate, the endpoint wants a concrete source language.
        if not source.is_resolved:
            source = (await self.detect(text, request_id=request_id)).language

        chunks = chunk_text(text, self.settings.translate_max_chars)
        parts: list[str] = []
        total_latency = 0.0

        for chunk in chunks:
            payload: dict[str, Any] = {
                "input": chunk,
                "source_language_code": source.value,
                "target_language_code": target.value,
                "numerals_format": numerals_format,
                "spoken_form": spoken_form,
            }
            body, elapsed = await self.client.request(
                "POST",
                self.settings.transliterate_endpoint,
                service=Service.TRANSLITERATE,
                json=payload,
                language=target,
                request_id=request_id,
            )
            total_latency += elapsed
            part = (body.get("transliterated_text") or body.get("output") or "").strip()
            if not part:
                raise TranslationError(
                    "Sarvam returned an empty transliteration",
                    service=Service.TRANSLITERATE,
                    stage=Stage.TRANSLATE_OUT,
                    details={"target": target.value},
                )
            parts.append(part)

        response = TransliterationResponse(
            request_id=request_id,
            text=" ".join(parts),
            source_text=text,
            source_language=source,
            target_language=target,
        )
        response.latency.total_ms = round(total_latency, 2)
        logger.info(
            f"transliterate.done {source.value}->{target.value} latency_ms={total_latency:.0f}"
        )
        return response

    async def to_pivot(
        self,
        text: str,
        *,
        source_language: str | Language | None = None,
        request_id: str | None = None,
    ) -> TranslationResponse:
        """Translate into the language the LLM reasons in (English by default)."""
        return await self.translate(
            text,
            target_language=self.settings.pivot_language,
            source_language=source_language,
            stage=Stage.TRANSLATE_IN,
            request_id=request_id,
        )

    async def from_pivot(
        self,
        text: str,
        *,
        target_language: str | Language,
        request_id: str | None = None,
    ) -> TranslationResponse:
        """Translate the model's answer back into the user's language."""
        return await self.translate(
            text,
            target_language=target_language,
            source_language=self.settings.pivot_language,
            stage=Stage.TRANSLATE_OUT,
            request_id=request_id,
        )
