# Sahayak — AI Engine


PPT Link : https://docs.google.com/presentation/d/1nnpIAuOZ8mrtoTnzKNjGvEPaeVxSKGnRwMhsYY4F-AY/edit?usp=sharing

Demo : 

https://github.com/user-attachments/assets/ce71b48b-8d3c-4edc-8088-5113533392cf


https://github.com/user-attachments/assets/ede17ab2-73b6-46e2-9e45-6e043a5b5059

Merchant Onboarding Demo : https://www.loom.com/share/c7904325fba347adaaad6f623799d98a


The AI layer of Sahayak. It integrates **every Sarvam AI capability behind one
interface** so nothing else in the system ever calls Sarvam directly.

```
Frontend  →  UCXP Runtime  →  AI Engine  →  Sarvam APIs
```

This repo builds **only** the AI Engine. No business logic, no protocol, no
database, no auth, no workflows, no customer-support behaviour.

---

## One line to use it

```python
from ai_engine import SarvamOrchestrator

async with SarvamOrchestrator() as engine:
    response = await engine.process_voice(audio_bytes)

response.detected_language   # Language.HINDI
response.transcript          # "मेरा ऑर्डर अभी तक नहीं आया है"
response.translated_text     # "My order has not arrived yet"
response.llm_response        # answer, reasoning language (English)
response.response_text       # answer, user's language
response.audio_base64        # spoken answer, base64 WAV
response.latency             # per-stage milliseconds
response.error               # None, or a structured ErrorDetail
```

The caller never sees a Sarvam payload, a model name, a retry, or an HTTP client.

---

## Run it locally (no API key needed)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 1. offline test suite — 33 tests, every Sarvam call mocked in-process
.venv/bin/python -m pytest

# 2. a fake Sarvam that speaks the real wire format
.venv/bin/python tools/mock_sarvam.py            # http://127.0.0.1:8099

# 3. drive the engine against it
export SARVAM_BASE_URL=http://127.0.0.1:8099 SARVAM_API_KEY=mock
.venv/bin/python tools/demo.py gen-audio sample.wav
.venv/bin/python tools/demo.py voice sample.wav --out reply.wav
.venv/bin/python tools/demo.py text "मेरा ऑर्डर कहाँ है?"
```

Point it at the real thing by dropping the two overrides and putting your key in
`.env` (`cp .env.example .env`). Note that exported shell variables win over
`.env`, so `unset SARVAM_BASE_URL SARVAM_API_KEY` first.

The mock can misbehave on purpose, which is how the retry path is exercised:

```bash
MOCK_FAIL_RATE=0.5 MOCK_LATENCY_MS=400 python tools/mock_sarvam.py
```

### As a service

```bash
.venv/bin/python -m uvicorn ai_engine.app:app --port 8080     # docs at /docs
curl -X POST localhost:8080/v1/text -H 'content-type: application/json' \
     -d '{"text":"मेरा ऑर्डर कहाँ है?"}'
curl -X POST localhost:8080/v1/voice -F file=@sample.wav
```

---

## Verified against the live API (2026-07-26)

All seven Sarvam APIs, full voice round trip — Sarvam TTS generated the question
clip, `process_voice()` consumed it:

| Stage | Model | Latency |
|---|---|---|
| speech to text | `saarika:v2.5` | 405 ms |
| translate → English | `sarvam-translate:v1` | 227 ms |
| reasoning | `sarvam-105b` | **4673 ms** |
| translate → Hindi | `sarvam-translate:v1` | 356 ms |
| text to speech | `bulbul:v2` | 1139 ms |
| | | **6.8 s total** |

Text-only pipeline: **2.1 s**. The LLM dominates; everything else is sub-second.

### The LLM is a reasoning model — read this

`sarvam-m` is **deprecated**. The current models are `sarvam-30b` and
`sarvam-105b`, and **both think before they answer**. The chain of thought comes
back in `reasoning_content` and is billed against `max_tokens`, so a budget that
is too small gets consumed by thinking and `content` comes back **null**.

- Thinking **cannot be disabled** — `reasoning_effort` accepts only
  `low`/`medium`/`high`, and `enable_thinking: false` is ignored.
- `max_tokens` is capped by your plan (4096 on the *starter* tier).
- Observed reasoning for one identical one-line prompt: 735–15,476 characters.
- `sarvam-30b` often exhausts 4096 tokens mid-thought; `sarvam-105b` finished
  every time. **Default is `sarvam-105b` at `max_tokens=4096`.**

A larger `max_tokens` costs nothing when reasoning is short — it is a cap, not a
spend — so don't lower it to save money. If the model is still cut off, the
engine retries once with a doubled budget (up to
`SARVAM_LLM_MAX_TOKENS_CEILING`) and otherwise returns an actionable error:

```
llm_failed: sarvam-105b used its entire 4096-token budget reasoning and never
produced an answer. Raise SARVAM_LLM_MAX_TOKENS…
```

`LLMResponse.reasoning` keeps the chain of thought for debugging but is
**excluded from serialisation** — it must never reach an end user.

### Other live-API notes

- `/translate` and `/transliterate` **reject `"auto"`** as a source language.
  The engine resolves an unknown source through `/text-lid` first, so callers
  can still omit it.
- `saarika:v2` is deprecated → `saarika:v2.5`. Also available: `saarika:flash`,
  `saaras:v3`, `saaras:v3-realtime`.
- `bulbul:v3` exists with a **completely different speaker set** (`priya`,
  `aditya`, `ritu`, …); v2 voices are rejected by v3. Change
  `SARVAM_TTS_MODEL` and `SARVAM_TTS_SPEAKER` together — `GET /v1/voices` lists
  both sets.

---

## The two pipelines

**Voice** — `process_voice(audio)`

```
audio → detect language → speech to text → translate to English
      → LLM → translate back → text to speech → VoiceResponse
```

**Text** — `process_text(text)`

```
text → detect language → translate → LLM → translate back → TextResponse
```

Language detection rides along with speech-to-text (`saarika` returns the code
it heard); text input uses `/text-lid`, falling back to a Unicode-script
heuristic if that call fails. Both hops are skipped when the user is already
speaking the reasoning language.

---

## The interface

| Method | Does |
|---|---|
| `process_voice(audio, …)` | the whole voice pipeline, audio in → audio out |
| `process_text(text, …)` | the whole text pipeline |
| `translate(text, target_language=…)` | translation only |
| `speak(text, language=…)` | synthesis only |
| `reason(text \| messages, …)` | LLM only, no translation hops |
| `transcribe(audio, …)` | speech to text only (`translate_to_english=True` → saaras) |
| `transliterate(text, target_language=…)` | script conversion |
| `detect_language(text)` | language identification |
| `health()` | configuration, models, prompts |

Every Sarvam API is covered: `speech-to-text`, `speech-to-text-translate`,
`translate`, `transliterate`, `text-lid`, `chat/completions`, `text-to-speech`.

---

## Layout

```
ai_engine/
  orchestrator.py    SarvamOrchestrator — the only class anyone else imports
  speech.py          speech-to-text        (saarika / saaras)
  translation.py     translate, transliterate, language id
  llm.py             reasoning + conversation formatting   (sarvam-m)
  tts.py             synthesis, chunking, wav merging      (bulbul)
  prompts.py         prompt loading, rendering, composition
  prompt_library/    system.md · business.md · workflow.md
  config.py          every knob, read from .env
  models.py          languages, speakers, roles, stages, services
  schemas.py         SpeechResponse · TextResponse · TranslationResponse · VoiceResponse …
  utils.py           http client, retries, errors, latency, audio, logging
  app.py             optional FastAPI surface over the orchestrator
tools/
  mock_sarvam.py     local stand-in for api.sarvam.ai
  demo.py            CLI for every capability
tests/
  test_ai_engine.py  offline suite
```

`utils.SarvamHTTPClient` is the only place that talks to `api.sarvam.ai`.

---

## Prompts

Prompts are files, not code. Three ship by default:

| Key | Purpose |
|---|---|
| `system` | base operating rules, output language, TTS-friendly formatting |
| `business` | persona, tone, boundaries, escalation |
| `workflow` | turn-level procedure for driving a task |

```python
await engine.process_text(
    "मेरा ऑर्डर कहाँ है?",
    prompt_key=["system", "business"],
    prompt_variables={"brand": "Sahayak", "domain": "orders", "tone": "warm",
                      "escalation_path": "a human agent"},
)
```

Placeholders are `{{name}}`. Add a prompt by dropping a `.md` file in
`prompt_library/` (or point `AI_ENGINE_PROMPTS_DIR` at your own directory), or
register one at runtime:

```python
engine.prompts.register("collections", "Chase the invoice for {{customer}}.")
```

---

## Errors, retries, degradation

Public methods **never raise** — they return a response with `success=False` and
a structured `error`:

```json
{
  "code": "upstream_error", "message": "HTTP 503: service unavailable",
  "stage": "llm_reasoning", "service": "llm", "status_code": 503,
  "retryable": true, "attempts": 3
}
```

Timeouts, 429s and 5xx retry with exponential backoff and jitter (honouring
`Retry-After`); 4xx and auth failures fail fast. Partial results survive — a
request that dies at the LLM still returns the transcript.

Non-critical stages degrade instead of failing the request, and say so in
`degraded_stages`:

- **TTS fails** → text answer is still returned
- **Inbound translation fails** → the multilingual model reasons on the raw text
- **Outbound translation fails** → the English answer is returned

Set `AI_ENGINE_GRACEFUL_DEGRADATION=false` for strict all-or-nothing behaviour.

---

## Logging

One structured line per Sarvam call — service, endpoint, language, latency,
success, attempts — plus a per-pipeline summary:

```
sarvam.call OK   service=speech_to_text endpoint=/speech-to-text language=unknown latency_ms=130.01 success=True attempts=1
sarvam.retry service=llm attempt=2/5 in=0.10s reason=upstream_error: HTTP 503
pipeline.voice.done language=hi-IN audio=yes degraded=[] total_ms=711
  breakdown={'stt_ms': 130.0, 'translate_in_ms': 123.3, 'llm_ms': 125.1, 'translate_out_ms': 125.1, 'tts_ms': 204.0}
```

`AI_ENGINE_LOG_JSON=true` for machine-readable output; `AI_ENGINE_LOG_FILE` to
also write to disk. Transcripts are truncated to 80 characters in logs and audio
is never logged.

---

## Configuration

Everything comes from `.env` — see `.env.example` for the full annotated list:
API key and base URL, timeouts, retry policy, model names, endpoint paths, voice
settings, pivot and supported languages, prompt directory, logging.
