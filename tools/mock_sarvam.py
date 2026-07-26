"""A local stand-in for api.sarvam.ai.

Lets you exercise the whole engine — every pipeline, every capability — with no
API key and no network. It speaks the same wire format as Sarvam, so the engine
code path under test is exactly the production one.

    python tools/mock_sarvam.py                     # http://127.0.0.1:8099
    SARVAM_BASE_URL=http://127.0.0.1:8099 python tools/demo.py text "नमस्ते"

Knobs (env vars):
    MOCK_LATENCY_MS   artificial per-call latency, default 120
    MOCK_FAIL_RATE    0.0-1.0 chance of a 503, to exercise retry logic
    MOCK_PORT         default 8099
"""

from __future__ import annotations

import asyncio
import base64
import io
import math
import os
import random
import struct
import unicodedata
import uuid
import wave
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from typing_extensions import Annotated

LATENCY_MS = float(os.getenv("MOCK_LATENCY_MS", "120"))
FAIL_RATE = float(os.getenv("MOCK_FAIL_RATE", "0"))
PORT = int(os.getenv("MOCK_PORT", "8099"))

app = FastAPI(title="Mock Sarvam API", version="1.0.0")

SCRIPT_LANGUAGES = {
    "DEVANAGARI": ("hi-IN", "Deva"),
    "BENGALI": ("bn-IN", "Beng"),
    "GUJARATI": ("gu-IN", "Gujr"),
    "GURMUKHI": ("pa-IN", "Guru"),
    "KANNADA": ("kn-IN", "Knda"),
    "MALAYALAM": ("ml-IN", "Mlym"),
    "ORIYA": ("od-IN", "Orya"),
    "TAMIL": ("ta-IN", "Taml"),
    "TELUGU": ("te-IN", "Telu"),
    "LATIN": ("en-IN", "Latn"),
}

# Just enough vocabulary to make the demo readable end to end.
PHRASES = {
    "hi-IN": {
        "en-IN": {
            "मेरा ऑर्डर कहाँ है": "Where is my order",
            "मेरा ऑर्डर अभी तक नहीं आया है": "My order has not arrived yet",
            "नमस्ते": "Hello",
        }
    },
    "en-IN": {
        "hi-IN": {
            "hello": "नमस्ते",
            "where is my order": "मेरा ऑर्डर कहाँ है",
        }
    },
}

DEMO_TRANSCRIPTS = [
    ("hi-IN", "मेरा ऑर्डर अभी तक नहीं आया है"),
    ("ta-IN", "என் ஆர்டர் இன்னும் வரவில்லை"),
    ("bn-IN", "আমার অর্ডার এখনো আসেনি"),
]


async def _simulate(request_kind: str) -> None:
    if FAIL_RATE and random.random() < FAIL_RATE:
        raise HTTPException(status_code=503, detail=f"mock {request_kind} temporarily unavailable")
    if LATENCY_MS:
        await asyncio.sleep(LATENCY_MS / 1000.0)


def _rid() -> str:
    return f"mock-{uuid.uuid4().hex[:12]}"


def _detect(text: str) -> tuple[str, str]:
    counts: dict[str, int] = {}
    for char in text:
        if not char.isalpha():
            continue
        try:
            script = unicodedata.name(char).split(" ")[0]
        except ValueError:
            continue
        counts[script] = counts.get(script, 0) + 1
    if not counts:
        return "en-IN", "Latn"
    dominant = max(counts, key=counts.__getitem__)
    return SCRIPT_LANGUAGES.get(dominant, ("en-IN", "Latn"))


def _fake_translate(text: str, source: str, target: str) -> str:
    table = PHRASES.get(source, {}).get(target, {})
    key = text.strip().rstrip("?!.।").lower()
    for phrase, translation in table.items():
        if phrase.lower() == key:
            return translation
    if source == target:
        return text
    return f"[{target}] {text}"


def _tone_wav(seconds: float, sample_rate: int = 22050, freq: float = 220.0) -> bytes:
    """A short sine tone so audio handling (merge, duration, decode) is real."""
    frames = bytearray()
    total = int(seconds * sample_rate)
    for i in range(total):
        # Fade in/out to avoid clicks when chunks are concatenated.
        envelope = min(1.0, i / 400, (total - i) / 400)
        value = int(12000 * envelope * math.sin(2 * math.pi * freq * i / sample_rate))
        frames += struct.pack("<h", value)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(bytes(frames))
    return buffer.getvalue()


def _check_auth(request: Request) -> None:
    if not (request.headers.get("api-subscription-key") or request.headers.get("authorization")):
        raise HTTPException(status_code=401, detail="missing api key")


# --------------------------------------------------------------------------- #
# Speech to text
# --------------------------------------------------------------------------- #
@app.post("/speech-to-text")
async def speech_to_text(
    request: Request,
    file: Annotated[UploadFile, File()],
    model: Annotated[str, Form()] = "saarika:v2.5",
    language_code: Annotated[str, Form()] = "unknown",
) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("stt")
    body = await file.read()
    # Deterministic pick so repeated runs on the same clip are stable.
    language, transcript = DEMO_TRANSCRIPTS[len(body) % len(DEMO_TRANSCRIPTS)]
    if language_code and language_code != "unknown":
        language = language_code
        transcript = next((t for lang, t in DEMO_TRANSCRIPTS if lang == language), transcript)
    return {
        "request_id": _rid(),
        "transcript": transcript,
        "language_code": language,
        "timestamps": None,
        "diarized_transcript": None,
    }


@app.post("/speech-to-text-translate")
async def speech_to_text_translate(
    request: Request,
    file: Annotated[UploadFile, File()],
    model: Annotated[str, Form()] = "saaras:v2.5",
) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("stt-translate")
    body = await file.read()
    language, transcript = DEMO_TRANSCRIPTS[len(body) % len(DEMO_TRANSCRIPTS)]
    return {
        "request_id": _rid(),
        "transcript": _fake_translate(transcript, language, "en-IN"),
        "language_code": language,
    }


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #
@app.post("/text-lid")
async def text_lid(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("lid")
    language, script = _detect(payload.get("input", ""))
    return {"request_id": _rid(), "language_code": language, "script_code": script}


@app.post("/translate")
async def translate(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("translate")
    text = payload.get("input", "")
    source = payload.get("source_language_code", "auto")
    target = payload.get("target_language_code", "en-IN")
    if source == "auto":
        source, _ = _detect(text)
    return {
        "request_id": _rid(),
        "translated_text": _fake_translate(text, source, target),
        "source_language_code": source,
    }


@app.post("/transliterate")
async def transliterate(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("transliterate")
    text = payload.get("input", "")
    target = payload.get("target_language_code", "en-IN")
    if target == "en-IN":
        romanized = "".join(
            c if c.isascii() else unicodedata.name(c, "").split(" ")[-1][:1].lower() or "" for c in text
        )
        return {"request_id": _rid(), "transliterated_text": romanized or text}
    return {"request_id": _rid(), "transliterated_text": text}


# --------------------------------------------------------------------------- #
# LLM
# --------------------------------------------------------------------------- #
@app.post("/v1/chat/completions")
async def chat_completions(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("llm")
    messages = payload.get("messages", [])
    last_user = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), ""
    )
    answer = (
        "I am sorry your order has not arrived yet. I can see it is still in transit, "
        "and it should reach you within two working days. Would you like me to share the "
        "tracking details?"
        if "order" in last_user.lower()
        else f"Understood. You said: {last_user.strip()[:160]}. How can I help further?"
    )
    prompt_tokens = sum(len(m.get("content", "").split()) for m in messages)
    completion_tokens = len(answer.split())
    return {
        "id": _rid(),
        "object": "chat.completion",
        "model": payload.get("model", "sarvam-m"),
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


# --------------------------------------------------------------------------- #
# Text to speech
# --------------------------------------------------------------------------- #
@app.post("/text-to-speech")
async def text_to_speech(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    _check_auth(request)
    await _simulate("tts")
    text = payload.get("text", "")
    rate = int(payload.get("speech_sample_rate", 22050))
    # ~14 characters per second of speech.
    seconds = max(0.4, min(len(text) / 14.0, 12.0))
    audio = _tone_wav(seconds, sample_rate=rate)
    return {"request_id": _rid(), "audios": [base64.b64encode(audio).decode("ascii")]}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "mock": True, "latency_ms": LATENCY_MS, "fail_rate": FAIL_RATE}


if __name__ == "__main__":
    import uvicorn

    print(f"Mock Sarvam API on http://127.0.0.1:{PORT}  (latency={LATENCY_MS}ms fail_rate={FAIL_RATE})")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
