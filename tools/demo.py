"""CLI for driving the AI Engine locally.

    python tools/demo.py health
    python tools/demo.py gen-audio sample.wav
    python tools/demo.py voice sample.wav --out reply.wav
    python tools/demo.py text "मेरा ऑर्डर कहाँ है?"
    python tools/demo.py translate "Where is my order?" --to hi-IN
    python tools/demo.py transliterate "नमस्ते" --to en-IN
    python tools/demo.py detect "என் ஆர்டர் எங்கே"
    python tools/demo.py speak "आपका ऑर्डर कल पहुँच जाएगा" --lang hi-IN --out out.wav
    python tools/demo.py reason "Summarise the refund policy in one line"

Point it at the mock server for a keyless run:
    SARVAM_BASE_URL=http://127.0.0.1:8099 SARVAM_API_KEY=mock python tools/demo.py text "नमस्ते"
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import math
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai_engine import SarvamOrchestrator  # noqa: E402


def _print(title: str, response) -> None:
    """Print a response with the audio blob redacted (it is megabytes of base64)."""
    print(f"\n=== {title} ===")
    if getattr(response, "audio_base64", ""):
        size = len(base64.b64decode(response.audio_base64))
        response = response.model_copy(update={"audio_base64": f"<{size} bytes of wav>"})
    print(response.model_dump_json(indent=2, exclude={"raw"}, exclude_none=True))
    latency = getattr(response, "latency", None)
    if latency:
        print(f"\nlatency: total={latency.total_ms}ms  breakdown={latency.breakdown}")


def _save_audio(b64: str, path: str | None) -> None:
    if not b64 or not path:
        return
    Path(path).write_bytes(base64.b64decode(b64))
    print(f"\naudio written to {path} ({len(base64.b64decode(b64))} bytes)")


def make_test_wav(path: str, seconds: float = 2.0, sample_rate: int = 16000) -> str:
    """Generate a small WAV so you have something to feed process_voice()."""
    frames = bytearray()
    for i in range(int(seconds * sample_rate)):
        value = int(9000 * math.sin(2 * math.pi * 180 * i / sample_rate))
        frames += struct.pack("<h", value)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(bytes(frames))
    Path(path).write_bytes(buffer.getvalue())
    return path


async def run(args: argparse.Namespace) -> int:
    if args.command == "gen-audio":
        path = make_test_wav(args.path, seconds=args.seconds)
        print(f"wrote {path}")
        return 0

    async with SarvamOrchestrator() as engine:
        if args.command == "health":
            print(engine.health().model_dump_json(indent=2))
            return 0

        if args.command == "voice":
            response = await engine.process_voice(
                args.path,
                language=args.lang,
                target_language=args.to,
                speaker=args.speaker,
                prompt_key=args.prompt,
            )
            _print("VOICE PIPELINE", response)
            print(f"\nuser said : {response.transcript}")
            print(f"in english: {response.translated_text}")
            print(f"answer    : {response.response_text}")
            _save_audio(response.audio_base64, args.out)

        elif args.command == "text":
            response = await engine.process_text(
                args.text, language=args.lang, target_language=args.to, prompt_key=args.prompt
            )
            _print("TEXT PIPELINE", response)
            print(f"\nanswer: {response.response_text}")

        elif args.command == "translate":
            response = await engine.translate(
                args.text, target_language=args.to, source_language=args.lang
            )
            _print("TRANSLATE", response)

        elif args.command == "transliterate":
            response = await engine.transliterate(
                args.text, target_language=args.to, source_language=args.lang
            )
            _print("TRANSLITERATE", response)

        elif args.command == "detect":
            response = await engine.detect_language(args.text)
            _print("DETECT", response)

        elif args.command == "speak":
            response = await engine.speak(args.text, language=args.lang, speaker=args.speaker)
            _print("SPEAK", response)
            _save_audio(response.audio_base64, args.out)

        elif args.command == "reason":
            response = await engine.reason(args.text, prompt_key=args.prompt)
            _print("REASON", response)

        else:  # pragma: no cover
            print(f"unknown command {args.command}")
            return 2

        return 0 if getattr(response, "success", True) else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Drive the Sahayak AI Engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health")

    gen = sub.add_parser("gen-audio", help="create a test wav file")
    gen.add_argument("path")
    gen.add_argument("--seconds", type=float, default=2.0)

    voice = sub.add_parser("voice", help="full audio-in / audio-out pipeline")
    voice.add_argument("path")
    voice.add_argument("--lang", help="spoken language, e.g. hi-IN (default: auto detect)")
    voice.add_argument("--to", help="reply language (default: same as detected)")
    voice.add_argument("--speaker")
    voice.add_argument("--prompt")
    voice.add_argument("--out", help="write the reply audio here")

    text = sub.add_parser("text", help="full text pipeline")
    text.add_argument("text")
    text.add_argument("--lang")
    text.add_argument("--to")
    text.add_argument("--prompt")

    tr = sub.add_parser("translate")
    tr.add_argument("text")
    tr.add_argument("--to", required=True)
    tr.add_argument("--lang")

    tl = sub.add_parser("transliterate")
    tl.add_argument("text")
    tl.add_argument("--to", required=True)
    tl.add_argument("--lang")

    det = sub.add_parser("detect")
    det.add_argument("text")

    speak = sub.add_parser("speak")
    speak.add_argument("text")
    speak.add_argument("--lang")
    speak.add_argument("--speaker")
    speak.add_argument("--out", default="reply.wav")

    reason = sub.add_parser("reason")
    reason.add_argument("text")
    reason.add_argument("--prompt")

    return parser


if __name__ == "__main__":
    sys.exit(asyncio.run(run(build_parser().parse_args())))
