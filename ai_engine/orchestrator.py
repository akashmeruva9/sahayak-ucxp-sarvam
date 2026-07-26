"""The single entry point to every Sarvam capability.

    from ai_engine import SarvamOrchestrator

    async with SarvamOrchestrator() as engine:
        response = await engine.process_voice(audio_bytes)

Nothing outside this package should import ``speech``/``translation``/``llm``/
``tts`` directly, and nothing outside this package should know that Sarvam
exists.  The orchestrator owns the pipelines, the retries, the latency
accounting and the structured errors.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterable, Sequence

import httpx
from loguru import logger

from .config import Settings, get_settings
from .llm import LLMService, MessageLike
from .models import (
    ChatMessage,
    Gender,
    Language,
    LLMUsage,
    Speaker,
    Stage,
    TranslationMode,
    normalize_language,
)
from .prompts import PromptManager, get_prompt_manager
from .schemas import (
    DetectionResponse,
    ErrorDetail,
    HealthResponse,
    LLMResponse,
    SpeechResponse,
    TextResponse,
    TranslationResponse,
    TransliterationResponse,
    TTSResponse,
    VoiceResponse,
    new_request_id,
)
from .speech import AudioLike, SpeechService
from .translation import TranslationService
from .tts import TTSService
from .utils import (
    AIEngineError,
    SarvamHTTPClient,
    Stopwatch,
    configure_logging,
    to_error_detail,
)

ENGINE_VERSION = "1.0.0"


@asynccontextmanager
async def _stage(stage: Stage) -> AsyncIterator[None]:
    """Tag whatever fails inside with the pipeline stage it failed in."""
    try:
        yield
    except AIEngineError as exc:
        if exc.stage is None:
            exc.stage = stage
        raise


@dataclass
class _CoreResult:
    """Outcome of the shared translate -> reason -> translate-back core."""

    translated_input: str = ""
    llm_response: str = ""  # pivot language
    response_text: str = ""  # user's language
    model: str = ""
    usage: LLMUsage = field(default_factory=LLMUsage)
    degraded: list[Stage] = field(default_factory=list)


class SarvamOrchestrator:
    """One clean interface over all Sarvam AI capabilities."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client: SarvamHTTPClient | None = None,
        http_client: httpx.AsyncClient | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        prompts: PromptManager | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        configure_logging(self.settings)

        self.client = client or SarvamHTTPClient(
            self.settings, client=http_client, transport=transport
        )
        self.prompts = prompts or get_prompt_manager()

        self.speech = SpeechService(self.client, self.settings)
        self.translation = TranslationService(self.client, self.settings)
        self.llm = LLMService(self.client, self.settings, self.prompts)
        self.tts = TTSService(self.client, self.settings)

        logger.info(
            f"engine.ready version={ENGINE_VERSION} configured={self.settings.configured} "
            f"base_url={self.settings.sarvam_base_url} pivot={self.settings.pivot_language} "
            f"models=stt:{self.settings.stt_model},llm:{self.settings.llm_model},"
            f"tts:{self.settings.tts_model},translate:{self.settings.translate_model}"
        )

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    async def aclose(self) -> None:
        await self.client.aclose()

    close = aclose  # alias

    async def __aenter__(self) -> "SarvamOrchestrator":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    # ------------------------------------------------------------------ #
    # 1. VOICE PIPELINE
    # ------------------------------------------------------------------ #
    async def process_voice(
        self,
        audio: AudioLike,
        *,
        language: str | Language | None = None,
        target_language: str | Language | None = None,
        filename: str | None = None,
        prompt_key: str | Iterable[str] | None = None,
        prompt_variables: dict[str, Any] | None = None,
        history: Sequence[MessageLike] | None = None,
        speaker: str | Speaker | None = None,
        speak_response: bool = True,
        temperature: float | None = None,
        max_tokens: int | None = None,
        request_id: str | None = None,
    ) -> VoiceResponse:
        """audio -> detect -> STT -> translate -> LLM -> translate -> TTS -> audio.

        Args:
            audio: bytes, a file path, or a binary file object.
            language: spoken language if already known (skips detection).
            target_language: language to reply in; defaults to the detected one.
            speak_response: set False to skip synthesis and get text only.

        Returns:
            A :class:`VoiceResponse`.  On failure ``success`` is False and
            ``error`` explains which stage broke — partial results (transcript,
            text answer) are still populated wherever the pipeline got to.
        """
        request_id = request_id or new_request_id()
        total = Stopwatch()
        response = VoiceResponse(request_id=request_id)
        logger.info(f"pipeline.voice.start request_id={request_id}")

        try:
            # --- 1/2. detect language + transcribe (one Sarvam call) ------ #
            async with _stage(Stage.TRANSCRIBE):
                speech = await self.speech.transcribe(
                    audio,
                    language=language,
                    filename=filename,
                    request_id=request_id,
                )
            response.transcript = speech.transcript
            response.latency.record(Stage.TRANSCRIBE, speech.latency.stt_ms or 0.0)

            detected = speech.detected_language
            if not detected.is_resolved:
                # saarika could not identify it: fall back to text-based LID.
                async with _stage(Stage.DETECT):
                    detection = await self.translation.detect(speech.transcript, request_id=request_id)
                detected = detection.language
                response.latency.record(Stage.DETECT, detection.latency.detect_ms or 0.0)
            response.detected_language = detected

            reply_language = normalize_language(target_language, default=detected)

            # --- 3/4/5. translate -> reason -> translate back ------------- #
            core = await self._reason_core(
                text=speech.transcript,
                source_language=detected,
                reply_language=reply_language,
                prompt_key=prompt_key,
                prompt_variables=prompt_variables,
                history=history,
                temperature=temperature,
                max_tokens=max_tokens,
                request_id=request_id,
                latency=response.latency,
            )
            response.translated_text = core.translated_input
            response.llm_response = core.llm_response
            response.response_text = core.response_text
            response.model = core.model
            response.usage = core.usage
            response.degraded_stages = core.degraded

            # --- 6. speak ------------------------------------------------- #
            if speak_response and core.response_text:
                try:
                    async with _stage(Stage.SYNTHESIZE):
                        audio_out = await self.tts.synthesize(
                            core.response_text,
                            language=reply_language,
                            speaker=speaker,
                            request_id=request_id,
                        )
                    response.audio_base64 = audio_out.audio_base64
                    response.audio_format = audio_out.audio_format
                    response.sample_rate = audio_out.sample_rate
                    response.speaker = audio_out.speaker
                    response.latency.record(Stage.SYNTHESIZE, audio_out.latency.tts_ms or 0.0)
                except AIEngineError as exc:
                    # A missing voice clip should not throw away a good answer.
                    if not self.settings.graceful_degradation:
                        raise
                    response.degraded_stages.append(Stage.SYNTHESIZE)
                    response.error = exc.to_detail(Stage.SYNTHESIZE)
                    logger.warning(f"pipeline.voice.tts_degraded error={exc.message}")

        except AIEngineError as exc:
            return self._finalize_failure(response, exc, total, pipeline="voice")
        except Exception as exc:  # pragma: no cover - defensive
            return self._finalize_failure(response, exc, total, pipeline="voice")

        response.latency.total_ms = round(total.elapsed_ms(), 2)
        logger.info(
            f"pipeline.voice.done request_id={request_id} language={response.detected_language.value} "
            f"audio={'yes' if response.has_audio else 'no'} degraded={[s.value for s in response.degraded_stages]} "
            f"total_ms={response.latency.total_ms:.0f} breakdown={response.latency.breakdown}"
        )
        return response

    # ------------------------------------------------------------------ #
    # 2. TEXT PIPELINE
    # ------------------------------------------------------------------ #
    async def process_text(
        self,
        text: str,
        *,
        language: str | Language | None = None,
        target_language: str | Language | None = None,
        prompt_key: str | Iterable[str] | None = None,
        prompt_variables: dict[str, Any] | None = None,
        history: Sequence[MessageLike] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        request_id: str | None = None,
    ) -> TextResponse:
        """text -> detect -> translate -> LLM -> translate back -> text."""
        request_id = request_id or new_request_id()
        total = Stopwatch()
        response = TextResponse(request_id=request_id, input_text=text or "")
        logger.info(f"pipeline.text.start request_id={request_id}")

        try:
            if not (text or "").strip():
                raise AIEngineError("Cannot process empty text")

            # --- 1. detect ------------------------------------------------ #
            detected = normalize_language(language, default=Language.UNKNOWN)
            if not detected.is_resolved:
                async with _stage(Stage.DETECT):
                    detection = await self.translation.detect(text, request_id=request_id)
                detected = detection.language
                response.latency.record(Stage.DETECT, detection.latency.detect_ms or 0.0)
            response.detected_language = detected

            reply_language = normalize_language(target_language, default=detected)

            # --- 2/3/4. translate -> reason -> translate back ------------- #
            core = await self._reason_core(
                text=text,
                source_language=detected,
                reply_language=reply_language,
                prompt_key=prompt_key,
                prompt_variables=prompt_variables,
                history=history,
                temperature=temperature,
                max_tokens=max_tokens,
                request_id=request_id,
                latency=response.latency,
            )
            response.translated_input = core.translated_input
            response.llm_response = core.llm_response
            response.response_text = core.response_text
            response.model = core.model
            response.usage = core.usage
            response.degraded_stages = core.degraded

        except AIEngineError as exc:
            return self._finalize_failure(response, exc, total, pipeline="text")
        except Exception as exc:  # pragma: no cover - defensive
            return self._finalize_failure(response, exc, total, pipeline="text")

        response.latency.total_ms = round(total.elapsed_ms(), 2)
        logger.info(
            f"pipeline.text.done request_id={request_id} language={response.detected_language.value} "
            f"degraded={[s.value for s in response.degraded_stages]} "
            f"total_ms={response.latency.total_ms:.0f} breakdown={response.latency.breakdown}"
        )
        return response

    # ------------------------------------------------------------------ #
    # Shared core: translate in -> reason -> translate out
    # ------------------------------------------------------------------ #
    async def _reason_core(
        self,
        *,
        text: str,
        source_language: Language,
        reply_language: Language,
        prompt_key: str | Iterable[str] | None,
        prompt_variables: dict[str, Any] | None,
        history: Sequence[MessageLike] | None,
        temperature: float | None,
        max_tokens: int | None,
        request_id: str,
        latency: Any,
    ) -> _CoreResult:
        pivot = normalize_language(self.settings.pivot_language)
        result = _CoreResult()

        # --- translate the user's words into the reasoning language ------- #
        pivot_text = text
        if source_language != pivot:
            try:
                async with _stage(Stage.TRANSLATE_IN):
                    inbound = await self.translation.to_pivot(
                        text, source_language=source_language, request_id=request_id
                    )
                pivot_text = inbound.text
                latency.record(Stage.TRANSLATE_IN, inbound.latency.translate_in_ms or 0.0)
            except AIEngineError as exc:
                if not self.settings.graceful_degradation:
                    raise
                # sarvam-m is multilingual: reasoning on the raw text is a
                # better outcome than failing the request.
                result.degraded.append(Stage.TRANSLATE_IN)
                logger.warning(f"pipeline.translate_in_degraded error={exc.message}")
        result.translated_input = pivot_text

        # --- reason -------------------------------------------------------- #
        system_prompt = self.prompts.system_prompt(
            prompt_key,
            response_language=pivot,
            user_language=source_language,
            **(prompt_variables or {}),
        )
        conversation = self.llm.build_conversation(
            pivot_text, system_prompt=system_prompt, history=history
        )
        async with _stage(Stage.REASON):
            answer = await self.llm.complete(
                conversation,
                temperature=temperature,
                max_tokens=max_tokens,
                request_id=request_id,
            )
        latency.record(Stage.REASON, answer.latency.llm_ms or 0.0)
        result.llm_response = answer.content
        result.model = answer.model
        result.usage = answer.usage

        # --- translate the answer back ------------------------------------- #
        localized = answer.content
        if reply_language.is_resolved and reply_language != pivot:
            try:
                async with _stage(Stage.TRANSLATE_OUT):
                    outbound = await self.translation.from_pivot(
                        answer.content, target_language=reply_language, request_id=request_id
                    )
                localized = outbound.text
                latency.record(Stage.TRANSLATE_OUT, outbound.latency.translate_out_ms or 0.0)
            except AIEngineError as exc:
                if not self.settings.graceful_degradation:
                    raise
                result.degraded.append(Stage.TRANSLATE_OUT)
                logger.warning(f"pipeline.translate_out_degraded error={exc.message}")
        result.response_text = localized
        return result

    # ------------------------------------------------------------------ #
    # 3. Individual capabilities
    # ------------------------------------------------------------------ #
    async def transcribe(
        self,
        audio: AudioLike,
        *,
        language: str | Language | None = None,
        filename: str | None = None,
        translate_to_english: bool = False,
        request_id: str | None = None,
    ) -> SpeechResponse:
        """Speech to text only.  ``translate_to_english`` uses saaras."""
        request_id = request_id or new_request_id()
        try:
            return await self.speech.transcribe(
                audio,
                language=language,
                filename=filename,
                translate_to_english=translate_to_english,
                request_id=request_id,
            )
        except Exception as exc:
            return self._error_response(
                SpeechResponse, request_id, exc, stage=Stage.TRANSCRIBE
            )

    async def translate(
        self,
        text: str,
        *,
        target_language: str | Language,
        source_language: str | Language | None = None,
        mode: str | TranslationMode | None = None,
        request_id: str | None = None,
    ) -> TranslationResponse:
        """Translate text between any two supported languages."""
        request_id = request_id or new_request_id()
        try:
            return await self.translation.translate(
                text,
                target_language=target_language,
                source_language=source_language,
                mode=mode,
                request_id=request_id,
            )
        except Exception as exc:
            return self._error_response(
                TranslationResponse,
                request_id,
                exc,
                stage=Stage.TRANSLATE_IN,
                source_text=text or "",
                target_language=normalize_language(target_language),
            )

    async def transliterate(
        self,
        text: str,
        *,
        target_language: str | Language,
        source_language: str | Language | None = None,
        spoken_form: bool = False,
        request_id: str | None = None,
    ) -> TransliterationResponse:
        """Convert text between scripts without changing the language."""
        request_id = request_id or new_request_id()
        try:
            return await self.translation.transliterate(
                text,
                target_language=target_language,
                source_language=source_language,
                spoken_form=spoken_form,
                request_id=request_id,
            )
        except Exception as exc:
            return self._error_response(
                TransliterationResponse, request_id, exc, source_text=text or ""
            )

    async def detect_language(
        self, text: str, *, request_id: str | None = None
    ) -> DetectionResponse:
        """Identify the language of a piece of text."""
        request_id = request_id or new_request_id()
        try:
            return await self.translation.detect(text, request_id=request_id)
        except Exception as exc:  # pragma: no cover - detect() already degrades
            return self._error_response(DetectionResponse, request_id, exc, stage=Stage.DETECT)

    async def speak(
        self,
        text: str,
        *,
        language: str | Language | None = None,
        speaker: str | Speaker | None = None,
        gender: str | Gender | None = None,
        pace: float | None = None,
        pitch: float | None = None,
        loudness: float | None = None,
        request_id: str | None = None,
    ) -> TTSResponse:
        """Text to speech.  Returns one base64 WAV clip."""
        request_id = request_id or new_request_id()
        try:
            voice = speaker or (self.tts.speaker_for_gender(gender) if gender else None)
            return await self.tts.synthesize(
                text,
                language=language,
                speaker=voice,
                pace=pace,
                pitch=pitch,
                loudness=loudness,
                request_id=request_id,
            )
        except Exception as exc:
            return self._error_response(TTSResponse, request_id, exc, stage=Stage.SYNTHESIZE)

    async def reason(
        self,
        text: str | None = None,
        *,
        messages: Sequence[MessageLike] | None = None,
        prompt_key: str | Iterable[str] | None = None,
        prompt_variables: dict[str, Any] | None = None,
        history: Sequence[MessageLike] | None = None,
        language: str | Language | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        request_id: str | None = None,
    ) -> LLMResponse:
        """Raw LLM reasoning, no translation hops.

        Pass ``text`` for a single turn, or ``messages`` for a fully formed
        conversation (a system prompt is prepended only if you did not supply
        one).
        """
        request_id = request_id or new_request_id()
        try:
            reply_language = normalize_language(language, default=self.settings.pivot_language)
            system_prompt = self.prompts.system_prompt(
                prompt_key,
                response_language=reply_language,
                user_language=reply_language,
                **(prompt_variables or {}),
            )
            if messages:
                normalized = self.llm.normalize_messages(messages)
                has_system = any(m.role.value == "system" for m in normalized)
                conversation = (
                    normalized
                    if has_system
                    else [ChatMessage.system(system_prompt), *normalized]
                )
            else:
                conversation = self.llm.build_conversation(
                    text, system_prompt=system_prompt, history=history
                )
            return await self.llm.complete(
                conversation,
                temperature=temperature,
                max_tokens=max_tokens,
                request_id=request_id,
            )
        except Exception as exc:
            return self._error_response(LLMResponse, request_id, exc, stage=Stage.REASON)

    # ------------------------------------------------------------------ #
    # Introspection
    # ------------------------------------------------------------------ #
    def health(self) -> HealthResponse:
        return HealthResponse(
            status="ok" if self.settings.configured else "unconfigured",
            version=ENGINE_VERSION,
            configured=self.settings.configured,
            pivot_language=self.settings.pivot_language,
            supported_languages=list(self.settings.supported_languages),
            prompts=self.prompts.keys(),
            models={
                "speech_to_text": self.settings.stt_model,
                "speech_to_text_translate": self.settings.stt_translate_model,
                "translation": self.settings.translate_model,
                "llm": self.settings.llm_model,
                "text_to_speech": self.settings.tts_model,
            },
        )

    # ------------------------------------------------------------------ #
    # Error plumbing
    # ------------------------------------------------------------------ #
    @staticmethod
    def _error_response(
        model: type,
        request_id: str,
        exc: BaseException,
        *,
        stage: Stage | None = None,
        **fields: Any,
    ):
        detail = to_error_detail(exc, stage=stage)
        logger.error(f"engine.error request_id={request_id} {detail}")
        return model(success=False, request_id=request_id, error=detail, **fields)

    @staticmethod
    def _finalize_failure(response, exc: BaseException, total: Stopwatch, *, pipeline: str):
        detail: ErrorDetail = to_error_detail(exc)
        response.success = False
        response.error = detail
        response.latency.total_ms = round(total.elapsed_ms(), 2)
        logger.error(
            f"pipeline.{pipeline}.failed request_id={response.request_id} "
            f"total_ms={response.latency.total_ms:.0f} error={detail}"
        )
        return response
