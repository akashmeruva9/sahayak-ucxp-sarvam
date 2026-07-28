"""Engine tests.

Every Sarvam call is served by an in-process ``httpx.MockTransport``, so the
suite runs offline, deterministically, and still exercises the real request
building, retry, parsing and error-handling code paths.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import sys
import wave
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai_engine import Language, SarvamOrchestrator, Settings, Stage  # noqa: E402
from ai_engine.prompts import PromptManager  # noqa: E402
from ai_engine.utils import (  # noqa: E402
    chunk_text,
    contradicts_text,
    guess_language_from_script,
    merge_wav_base64,
)

# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
def wav_bytes(seconds: float = 0.5, rate: int = 16000) -> bytes:
    frames = b"".join(struct.pack("<h", (i % 200) * 100) for i in range(int(seconds * rate)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(frames)
    return buffer.getvalue()


def wav_b64(seconds: float = 0.5) -> str:
    return base64.b64encode(wav_bytes(seconds)).decode()


def settings(**overrides) -> Settings:
    base = dict(
        sarvam_api_key="test-key",
        sarvam_base_url="https://api.sarvam.ai",
        max_retries=2,
        retry_base_delay=0.0,
        retry_max_delay=0.0,
        retry_jitter=0.0,
        log_level="CRITICAL",
    )
    base.update(overrides)
    return Settings(**base)


class Recorder:
    """Scriptable Sarvam stand-in; records every call the engine makes."""

    def __init__(self, overrides: dict[str, object] | None = None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.overrides = overrides or {}

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def paths(self) -> list[str]:
        return [path for path, _ in self.calls]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body: dict = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = json.loads(request.content or b"{}")
        self.calls.append((path, body))

        override = self.overrides.get(path)
        if callable(override):
            result = override(len([p for p, _ in self.calls if p == path]), body)
            if result is not None:
                return result

        if path == "/speech-to-text":
            return httpx.Response(200, json={"transcript": "मेरा ऑर्डर कहाँ है", "language_code": "hi-IN"})
        if path == "/speech-to-text-translate":
            return httpx.Response(200, json={"transcript": "Where is my order", "language_code": "hi-IN"})
        if path == "/text-lid":
            detected = guess_language_from_script(body.get("input", ""))
            return httpx.Response(200, json={"language_code": detected.value, "script_code": "Deva"})
        if path == "/translate":
            target = body.get("target_language_code")
            text = body.get("input", "")
            out = "Where is my order" if target == "en-IN" else "आपका ऑर्डर कल आएगा"
            return httpx.Response(
                200, json={"translated_text": out, "source_language_code": body.get("source_language_code")}
            )
        if path == "/transliterate":
            return httpx.Response(200, json={"transliterated_text": "mera order kahan hai"})
        if path == "/v1/chat/completions":
            return httpx.Response(
                200,
                json={
                    "model": "sarvam-105b",
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": "Your order arrives tomorrow."},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 40, "completion_tokens": 8, "total_tokens": 48},
                },
            )
        if path == "/text-to-speech":
            return httpx.Response(200, json={"audios": [wav_b64()]})
        return httpx.Response(404, json={"error": {"message": f"no mock for {path}"}})


def engine(recorder: Recorder, **overrides) -> SarvamOrchestrator:
    return SarvamOrchestrator(settings(**overrides), transport=recorder.transport())


# --------------------------------------------------------------------------- #
# Definition of done: the voice pipeline
# --------------------------------------------------------------------------- #
async def test_process_voice_runs_the_full_pipeline():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.process_voice(wav_bytes(), filename="clip.wav")

    assert response.success
    assert response.detected_language is Language.HINDI
    assert response.transcript == "मेरा ऑर्डर कहाँ है"
    assert response.translated_text == "Where is my order"
    assert response.llm_response == "Your order arrives tomorrow."
    assert response.response_text == "आपका ऑर्डर कल आएगा"
    assert response.has_audio
    assert response.usage.total_tokens == 48
    assert response.degraded_stages == []

    # STT -> translate in -> LLM -> translate out -> TTS, in that order.
    assert recorder.paths() == [
        "/speech-to-text",
        "/translate",
        "/v1/chat/completions",
        "/translate",
        "/text-to-speech",
    ]

    latency = response.latency
    for field in ("stt_ms", "translate_in_ms", "llm_ms", "translate_out_ms", "tts_ms"):
        assert getattr(latency, field) is not None, field
    assert latency.total_ms > 0

    # The audio really is a playable WAV.
    with wave.open(io.BytesIO(base64.b64decode(response.audio_base64)), "rb") as reader:
        assert reader.getnframes() > 0


async def test_process_voice_accepts_a_file_path(tmp_path):
    clip = tmp_path / "input.wav"
    clip.write_bytes(wav_bytes())
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.process_voice(clip)
    assert response.success and response.transcript


async def test_process_voice_can_skip_synthesis():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.process_voice(wav_bytes(), speak_response=False)
    assert response.success
    assert not response.has_audio
    assert "/text-to-speech" not in recorder.paths()


# --------------------------------------------------------------------------- #
# Text pipeline
# --------------------------------------------------------------------------- #
async def test_process_text_pipeline():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.process_text("मेरा ऑर्डर कहाँ है")

    assert response.success
    assert response.detected_language is Language.HINDI
    assert response.translated_input == "Where is my order"
    assert response.llm_response == "Your order arrives tomorrow."
    assert response.response_text == "आपका ऑर्डर कल आएगा"
    assert recorder.paths() == [
        "/text-lid",
        "/translate",
        "/v1/chat/completions",
        "/translate",
    ]


async def test_english_input_skips_both_translation_hops():
    recorder = Recorder({"/text-lid": lambda n, b: httpx.Response(200, json={"language_code": "en-IN"})})
    async with engine(recorder) as ai:
        response = await ai.process_text("Where is my order?")

    assert response.success
    assert "/translate" not in recorder.paths()
    assert response.response_text == "Your order arrives tomorrow."
    assert response.latency.translate_in_ms is None


async def test_caller_supplied_language_skips_detection():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.process_text("मेरा ऑर्डर कहाँ है", language="hi-IN")
    assert response.success
    assert "/text-lid" not in recorder.paths()


async def test_target_language_overrides_reply_language():
    recorder = Recorder()
    async with engine(recorder) as ai:
        await ai.process_text("मेरा ऑर्डर कहाँ है", language="hi-IN", target_language="ta-IN")
    outbound = [body for path, body in recorder.calls if path == "/translate"][-1]
    assert outbound["target_language_code"] == "ta-IN"


# --------------------------------------------------------------------------- #
# Individual capabilities
# --------------------------------------------------------------------------- #
async def test_translate_transliterate_speak_reason_detect():
    recorder = Recorder()
    async with engine(recorder) as ai:
        translated = await ai.translate("Where is my order?", target_language="hi-IN")
        assert translated.success and translated.text == "आपका ऑर्डर कल आएगा"

        romanized = await ai.transliterate("मेरा ऑर्डर कहाँ है", target_language="en-IN")
        assert romanized.success and romanized.text == "mera order kahan hai"

        spoken = await ai.speak("आपका ऑर्डर कल आएगा", language="hi-IN", speaker="anushka")
        assert spoken.success and spoken.has_audio and spoken.speaker == "anushka"

        thought = await ai.reason("Summarise the policy")
        assert thought.success and thought.content == "Your order arrives tomorrow."
        assert thought.messages[0]["role"] == "system"

        detected = await ai.detect_language("மணி என்ன")
        assert detected.success and detected.language is Language.TAMIL


async def test_transcribe_with_translate_to_english_uses_saaras():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.transcribe(wav_bytes(), translate_to_english=True)
    assert response.success
    assert response.transcript == "Where is my order"
    assert response.translated_in_place
    assert recorder.paths() == ["/speech-to-text-translate"]


async def test_over_long_audio_is_rejected_before_the_api_call():
    recorder = Recorder()
    async with engine(recorder, stt_max_audio_seconds=30.0) as ai:
        response = await ai.process_voice(wav_bytes(seconds=45))

    assert response.success is False
    assert response.error.code.value == "speech_failed"
    assert "at most 30s" in response.error.message
    assert response.error.details["duration_seconds"] == pytest.approx(45.0, abs=0.1)
    assert recorder.paths() == []  # never left the process


async def test_audio_within_the_limit_still_goes_through():
    recorder = Recorder()
    async with engine(recorder, stt_max_audio_seconds=30.0) as ai:
        response = await ai.process_voice(wav_bytes(seconds=25), speak_response=False)
    assert response.success
    assert response.transcript


async def test_unknown_speaker_falls_back_to_default():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.speak("hello", language="en-IN", speaker="not-a-voice")
    assert response.success
    assert response.speaker == "anushka"


async def test_translate_is_a_noop_when_source_equals_target():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.translate("hello", target_language="en-IN", source_language="en-IN")
    assert response.success and response.skipped
    assert response.text == "hello"
    assert recorder.paths() == []


# --------------------------------------------------------------------------- #
# Retries, errors, degradation
# --------------------------------------------------------------------------- #
async def test_transient_failures_are_retried():
    def flaky(attempt: int, _body: dict) -> httpx.Response | None:
        if attempt < 3:
            return httpx.Response(503, json={"error": {"message": "upstream busy"}})
        return None  # third attempt falls through to the healthy default

    recorder = Recorder({"/v1/chat/completions": flaky})
    async with engine(recorder) as ai:
        response = await ai.reason("hello")

    assert response.success
    assert len([p for p in recorder.paths() if p == "/v1/chat/completions"]) == 3


async def test_persistent_failure_returns_a_structured_error_not_an_exception():
    recorder = Recorder(
        {"/v1/chat/completions": lambda n, b: httpx.Response(500, json={"error": {"message": "boom"}})}
    )
    async with engine(recorder) as ai:
        response = await ai.process_voice(wav_bytes())

    assert response.success is False
    assert response.error is not None
    assert response.error.code.value == "upstream_error"
    assert response.error.status_code == 500
    assert response.error.attempts == 3  # 1 + max_retries
    assert "boom" in response.error.message
    # Partial results survive: we still know what the user said.
    assert response.transcript == "मेरा ऑर्डर कहाँ है"
    assert response.latency.total_ms > 0


async def test_auth_failure_is_not_retried():
    recorder = Recorder(
        {"/v1/chat/completions": lambda n, b: httpx.Response(401, json={"error": {"message": "bad key"}})}
    )
    async with engine(recorder) as ai:
        response = await ai.reason("hello")
    assert response.success is False
    assert response.error.code.value == "authentication_error"
    assert len(recorder.paths()) == 1


async def test_tts_failure_degrades_instead_of_losing_the_answer():
    recorder = Recorder({"/text-to-speech": lambda n, b: httpx.Response(500, json={"error": "no voice"})})
    async with engine(recorder) as ai:
        response = await ai.process_voice(wav_bytes())

    assert response.success is True  # the text answer is still useful
    assert response.response_text == "आपका ऑर्डर कल आएगा"
    assert not response.has_audio
    assert Stage.SYNTHESIZE in response.degraded_stages


async def test_inbound_translation_failure_degrades_to_raw_text():
    calls = {"n": 0}

    def only_inbound_fails(_attempt: int, body: dict) -> httpx.Response | None:
        if body.get("target_language_code") == "en-IN":
            calls["n"] += 1
            return httpx.Response(500, json={"error": "translator down"})
        return None

    recorder = Recorder({"/translate": only_inbound_fails})
    async with engine(recorder) as ai:
        response = await ai.process_text("मेरा ऑर्डर कहाँ है", language="hi-IN")

    assert response.success is True
    assert Stage.TRANSLATE_IN in response.degraded_stages
    # The model was given the original Hindi rather than nothing at all.
    llm_body = next(body for path, body in recorder.calls if path == "/v1/chat/completions")
    assert llm_body["messages"][-1]["content"] == "मेरा ऑर्डर कहाँ है"


async def test_strict_mode_fails_the_request_instead_of_degrading():
    recorder = Recorder({"/text-to-speech": lambda n, b: httpx.Response(500, json={"error": "no voice"})})
    async with engine(recorder, graceful_degradation=False) as ai:
        response = await ai.process_voice(wav_bytes())
    assert response.success is False
    assert response.error.stage is Stage.SYNTHESIZE


async def test_empty_transcript_is_reported_clearly():
    recorder = Recorder({"/speech-to-text": lambda n, b: httpx.Response(200, json={"transcript": "  "})})
    async with engine(recorder) as ai:
        response = await ai.process_voice(wav_bytes())
    assert response.success is False
    assert response.error.code.value == "speech_failed"
    assert "empty transcript" in response.error.message


async def test_lid_failure_falls_back_to_script_detection():
    recorder = Recorder({"/text-lid": lambda n, b: httpx.Response(500, json={"error": "lid down"})})
    async with engine(recorder) as ai:
        response = await ai.detect_language("என் ஆர்டர் எங்கே")
    assert response.success
    assert response.language is Language.TAMIL
    assert response.source == "script-heuristic"


def lid_says(code: str, script: str = "Latn"):
    """A LID stub that always claims *code*, whatever the input."""
    return Recorder(
        {"/text-lid": lambda n, b: httpx.Response(200, json={"language_code": code, "script_code": script})}
    )


async def test_impossible_lid_answer_is_overruled():
    """Latin-script English must never come back as an Indic language.

    Sarvam's LID really does return ml-IN for "track order 1001 with ravi
    electronics" — order numbers and brand names give it nothing to go on. The
    caller translates the whole reply into whatever we return, so an answer the
    text itself contradicts has to be rejected here.
    """
    async with engine(lid_says("ml-IN")) as ai:
        response = await ai.detect_language("track order 1001 with ravi electronics")
    assert response.success
    assert response.language is Language.ENGLISH
    assert response.source == "lid-overruled"


async def test_romanised_indic_is_left_alone():
    """The guard must not eat Hinglish, which is genuinely Hindi in Latin."""
    async with engine(lid_says("hi-IN")) as ai:
        response = await ai.detect_language("mera order kahan hai")
    assert response.language is Language.HINDI
    assert response.source == "sarvam-lid"


async def test_native_script_is_always_trusted():
    async with engine(lid_says("ml-IN", "Mlym")) as ai:
        response = await ai.detect_language("\u0d0e\u0d28\u0d4d\u0d31\u0d46 \u0d13\u0d7c\u0d21\u0d7c \u0d0e\u0d35\u0d3f\u0d1f\u0d46")
    assert response.language is Language.MALAYALAM
    assert response.source == "sarvam-lid"


def test_contradicts_text_needs_both_signals():
    # No Malayalam letters and plainly English -> impossible.
    assert contradicts_text(Language.MALAYALAM, "cancel my booking please") is True
    # No Devanagari, but not English either -> could be romanised Hindi.
    assert contradicts_text(Language.HINDI, "naa order ekkada undi") is False
    # Written in its own script -> trusted, always.
    assert contradicts_text(Language.HINDI, "\u092e\u0947\u0930\u093e \u0911\u0930\u094d\u0921\u0930 \u0915\u0939\u093e\u0901 \u0939\u0948") is False
    # English is never overruled; it is what we fall back to.
    assert contradicts_text(Language.ENGLISH, "\u092e\u0947\u0930\u093e \u0911\u0930\u094d\u0921\u0930") is False


async def test_missing_api_key_is_a_configuration_error():
    recorder = Recorder()
    async with engine(recorder, sarvam_api_key="") as ai:
        response = await ai.reason("hello")
    assert response.success is False
    assert response.error.code.value == "configuration_error"
    assert "SARVAM_API_KEY" in response.error.message


async def test_timeout_is_retried_then_reported():
    def timeout(_attempt: int, _body: dict):
        raise httpx.ReadTimeout("too slow")

    recorder = Recorder({"/v1/chat/completions": timeout})
    async with engine(recorder) as ai:
        response = await ai.reason("hello")
    assert response.success is False
    assert response.error.code.value == "timeout"
    assert response.error.attempts == 3


# --------------------------------------------------------------------------- #
# Reasoning models (sarvam-30b / sarvam-105b think before they answer)
# --------------------------------------------------------------------------- #
def _thinking_only(finish_reason: str = "length") -> httpx.Response:
    """A completion where the whole budget went to the chain of thought."""
    return httpx.Response(
        200,
        json={
            "model": "sarvam-105b",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "reasoning_content": "1. Analyse the request… " * 40,
                    },
                    "finish_reason": finish_reason,
                }
            ],
            "usage": {"prompt_tokens": 30, "completion_tokens": 512, "total_tokens": 542},
        },
    )


async def test_truncated_reasoning_retries_with_a_bigger_budget():
    def first_call_thinks_forever(attempt: int, _body: dict) -> httpx.Response | None:
        return _thinking_only() if attempt == 1 else None

    recorder = Recorder({"/v1/chat/completions": first_call_thinks_forever})
    async with engine(recorder, llm_max_tokens=1024, llm_max_tokens_ceiling=4096) as ai:
        response = await ai.reason("hello")

    assert response.success
    assert response.content == "Your order arrives tomorrow."
    budgets = [b["max_tokens"] for p, b in recorder.calls if p == "/v1/chat/completions"]
    assert budgets == [1024, 2048]  # doubled, capped at the ceiling


async def test_reasoning_that_never_finishes_gives_an_actionable_error():
    recorder = Recorder({"/v1/chat/completions": lambda n, b: _thinking_only()})
    async with engine(recorder, llm_max_tokens=4096, llm_max_tokens_ceiling=4096) as ai:
        response = await ai.reason("hello")

    assert response.success is False
    assert response.error.code.value == "llm_failed"
    assert "SARVAM_LLM_MAX_TOKENS" in response.error.message
    assert response.error.details["finish_reason"] == "length"
    # At the ceiling already, so no pointless second call.
    assert len([p for p in recorder.paths() if p == "/v1/chat/completions"]) == 1


async def test_reasoning_content_is_captured_but_never_serialised():
    def answer_with_thinking(_n: int, _b: dict) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "sarvam-105b",
                "choices": [
                    {
                        "message": {
                            "content": "Tomorrow.",
                            "reasoning_content": "The user wants a delivery date.",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"total_tokens": 10},
            },
        )

    recorder = Recorder({"/v1/chat/completions": answer_with_thinking})
    async with engine(recorder) as ai:
        response = await ai.reason("when?")

    assert response.reasoning == "The user wants a delivery date."
    assert "reasoning" not in response.model_dump()  # must never reach a caller


async def test_reasoning_effort_is_sent_only_when_configured():
    recorder = Recorder()
    async with engine(recorder) as ai:
        await ai.reason("hello")
    assert "reasoning_effort" not in recorder.calls[0][1]

    recorder = Recorder()
    async with engine(recorder, llm_reasoning_effort="low") as ai:
        await ai.reason("hello")
    assert recorder.calls[0][1]["reasoning_effort"] == "low"


# --------------------------------------------------------------------------- #
# Source-language resolution (/translate rejects "auto")
# --------------------------------------------------------------------------- #
async def test_unknown_source_is_resolved_before_translating():
    recorder = Recorder()
    async with engine(recorder) as ai:
        response = await ai.translate("मेरा ऑर्डर कहाँ है", target_language="en-IN")

    assert response.success
    assert recorder.paths() == ["/text-lid", "/translate"]
    body = recorder.calls[1][1]
    assert body["source_language_code"] == "hi-IN"  # never the literal "auto"


async def test_no_request_ever_sends_auto_as_a_language_code():
    recorder = Recorder()
    async with engine(recorder) as ai:
        await ai.process_voice(wav_bytes())
        await ai.transliterate("मेरा ऑर्डर", target_language="en-IN")
    for path, body in recorder.calls:
        assert body.get("source_language_code") != "auto", path
        assert body.get("target_language_code") != "auto", path


# --------------------------------------------------------------------------- #
# Chunking / audio
# --------------------------------------------------------------------------- #
async def test_long_answers_are_chunked_and_merged_into_one_clip():
    recorder = Recorder()
    long_text = " ".join(["यह एक लंबा वाक्य है।"] * 60)
    async with engine(recorder, tts_max_chars=200) as ai:
        response = await ai.speak(long_text, language="hi-IN")

    tts_calls = [b for p, b in recorder.calls if p == "/text-to-speech"]
    assert len(tts_calls) > 1
    assert all(len(b["text"]) <= 200 for b in tts_calls)
    assert response.chunks == len(tts_calls)

    with wave.open(io.BytesIO(base64.b64decode(response.audio_base64)), "rb") as merged:
        assert merged.getnframes() > 8000 * len(tts_calls) * 0.4


async def test_long_translations_are_chunked():
    recorder = Recorder()
    async with engine(recorder, translate_max_chars=100) as ai:
        response = await ai.translate(" ".join(["This is a sentence."] * 40), target_language="hi-IN")
    assert response.success
    assert response.chunks > 1
    assert len([p for p in recorder.paths() if p == "/translate"]) == response.chunks


def test_chunk_text_respects_the_limit_and_keeps_content():
    text = " ".join(f"Sentence number {i}." for i in range(50))
    chunks = chunk_text(text, 80)
    assert all(len(c) <= 80 for c in chunks)
    assert "Sentence number 49." in chunks[-1]
    assert chunk_text("short", 100) == ["short"]
    assert chunk_text("   ", 100) == []


def test_merge_wav_handles_edge_cases():
    assert merge_wav_base64([]) == ""
    single = wav_b64()
    assert merge_wav_base64([single]) == single
    assert merge_wav_base64(["not-audio", "also-not"]) == "not-audio"


def test_script_heuristics():
    assert guess_language_from_script("नमस्ते") is Language.HINDI
    assert guess_language_from_script("hello") is Language.ENGLISH
    assert guess_language_from_script("123 !!") is Language.UNKNOWN


def test_language_aliases_are_forgiving():
    from ai_engine import normalize_language

    assert normalize_language("hi") is Language.HINDI
    assert normalize_language("Hindi") is Language.HINDI
    assert normalize_language("hi_IN") is Language.HINDI
    assert normalize_language("klingon", default=Language.ENGLISH) is Language.ENGLISH


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #
def test_prompt_library_loads_and_renders():
    manager = PromptManager()
    assert {"system", "business", "workflow"} <= set(manager.keys())

    rendered = manager.render("system", response_language="English", user_language="Hindi")
    assert "Answer only in English" in rendered
    assert "{{" not in rendered

    composed = manager.system_prompt(
        ["system", "business"],
        response_language="en-IN",
        user_language="ta-IN",
        brand="Sahayak",
        domain="orders and refunds",
        tone="warm",
        escalation_path="a human agent",
    )
    assert "You represent Sahayak" in composed
    assert "Tamil" in composed


def test_runtime_prompts_can_be_registered():
    manager = PromptManager()
    manager.register("collections", "Chase the invoice for {{customer}} politely.")
    assert manager.render("collections", customer="Acme") == "Chase the invoice for Acme politely."
    manager.reload()
    assert manager.has("collections")  # runtime prompts survive a reload


def test_unknown_prompt_raises_a_helpful_error():
    from ai_engine.utils import InvalidRequestError

    with pytest.raises(InvalidRequestError, match="Unknown prompt"):
        PromptManager().get("does-not-exist")


async def test_prompt_variables_reach_the_model():
    recorder = Recorder()
    async with engine(recorder) as ai:
        await ai.process_text(
            "मेरा ऑर्डर कहाँ है",
            language="hi-IN",
            prompt_key=["system", "business"],
            prompt_variables={
                "brand": "Sahayak",
                "domain": "orders",
                "tone": "warm",
                "escalation_path": "a human agent",
            },
        )
    system_message = next(b for p, b in recorder.calls if p == "/v1/chat/completions")["messages"][0]
    assert system_message["role"] == "system"
    assert "You represent Sahayak" in system_message["content"]


async def test_history_is_trimmed_to_the_configured_window():
    recorder = Recorder()
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(20)]
    async with engine(recorder, llm_max_history_turns=4) as ai:
        await ai.process_text("मेरा ऑर्डर कहाँ है", language="hi-IN", history=history)

    messages = next(b for p, b in recorder.calls if p == "/v1/chat/completions")["messages"]
    assert len(messages) == 6  # system + 4 history + current user
    assert messages[1]["content"] == "turn 16"


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
async def test_health_reports_configuration():
    recorder = Recorder()
    async with engine(recorder) as ai:
        health = ai.health()
    assert health.status == "ok"
    assert health.configured
    assert health.models["llm"] == "sarvam-105b"
    assert "hi-IN" in health.supported_languages
