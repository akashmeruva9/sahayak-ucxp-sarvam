# UCXP — Unified Customer Experience Protocol
### Execution plan · Sarvam Epoch Buildathon by GrowthX · Sun 26 Jul 2026, 10:00–18:00 IST

> **What it is:** UCXP is a *protocol*, not a chatbot. Every business publishes a standard
> **`support.manifest`** (its capabilities, auth, languages, FAQs, workflows, API mappings,
> escalation rules). Any UCXP-compatible AI assistant can then read that manifest and handle
> that business's customer support — refunds, tracking, cancellations, bookings — in the
> customer's own language, by voice, over an app **or** WhatsApp.
> **Positioning: "UPI for customer experience."** Publish once, be interoperable everywhere.

---

## The 60-second version

- **Two sides.** *Business portal* → upload FAQ/PDF + API spec, an AI generator auto-writes the
  `support.manifest` (no manual authoring). *Customer runtime* → one voice interface (app or
  WhatsApp); the runtime loads the right manifest, authenticates, executes the workflow against
  the business API, and replies in the customer's language by voice.
- **One shared runtime.** Both channels are *thin*. Everything intelligent — STT → intent →
  manifest resolution → auth → workflow → reply → TTS — lives once in the `Orchestrator`.
  **Swapping a business = swapping which manifest loads. Nothing else changes.** That single
  fact is the interoperability punchline.
- **Powered end-to-end by Sarvam:** Saaras (STT) · Sarvam Chat LLM (intent/orchestration) ·
  Mayura/Translate · Bulbul (TTS) · Vision (PDF→manifest OCR).

### The two constraints everything is designed around
1. **No Sarvam credits until the event starts.** So every Sarvam call sits behind **one adapter
   with a `MockSarvamAdapter`** returning deterministic canned output — the *entire* pipeline
   runs tonight with **zero credits, zero network**. Tomorrow we set `SARVAM_MODE=live` and drop
   in the real key, one capability at a time. **Mock mode is not the failure state — it's the
   guaranteed-good state we rehearse on.**
2. **Both channels are required** — a WhatsApp-styled **web app** *and* **real WhatsApp** (Twilio)
   — sharing that one orchestrator.

---

## The demo, in one paragraph

A business drops a FAQ PDF + API spec into the portal → we auto-generate its `support.manifest`
live (Sarvam Vision + LLM). A customer on the **app** speaks **Telugu** — *"Where's my Flipkart
order?"* → spoken Telugu reply; then *"I want a refund, the item's damaged"* → a real refund
workflow executes, spoken back in Telugu. Then we switch to a **phone on real WhatsApp**, speak
**Hindi** to cancel an **Airtel** connection — and **the same assistant handles it, because we
only loaded a second manifest.** Close: *"Two businesses, two languages, two channels, one
protocol, zero custom bots."* Full script, exact utterances, and fallbacks: **[Doc 10](10-demo-and-pitch.md)**.

---

## How the system works (at a glance)

```
Customer (voice, Telugu/Hindi)
   │  app  ─────────────┐
   │  WhatsApp (Twilio) ─┤→  Channel (thin)  →  ORCHESTRATOR  ──────────────► reply (text + voice)
                         │                        │  handle_turn()
                         │        ┌───────────────┼───────────────┐
                         │        ▼               ▼               ▼
                         │   Sarvam adapter   Manifest store   Workflow executor
                         │   (mock | live)    (flipkart.json,  → Mock Business API
                         │   STT/TTS/chat/     airtel.json)       (track/refund/cancel)
                         │   translate/OCR
                         └─────────────────────────────────────────────────────►
```
Full component + sequence diagrams and the FastAPI folder layout: **[Doc 1](01-architecture.md)**.

---

## The plan, in ten docs

| # | Doc | What's in it |
|---|-----|--------------|
| 1 | [System Architecture](01-architecture.md) | Component + sequence diagrams; the single shared runtime; full `ucxp/` FastAPI folder layout; core interfaces; `SARVAM_MODE` toggle. |
| 2 | [UCXP Protocol — `support.manifest` spec](02-manifest-spec.md) | The JSON Schema for the manifest + a **complete worked example** (capabilities, auth, languages, workflows, api_mappings, escalation). This is the contract everything reads. |
| 3 | [Runtime Orchestrator](03-orchestrator.md) | The `handle_turn()` pipeline, the LLM tool-call JSON contract, slot-filling, and a **deterministic mock planner** so it's testable offline. |
| 4 | [Sarvam Adapter (mock + live)](04-sarvam-adapter.md) | The ABC (`stt/tts/translate/chat/ocr`), the **`LiveSarvamAdapter`** (real SDK calls, ready to fill) and the **`MockSarvamAdapter`** (canned, no network), + the `SARVAM_MODE` factory. |
| 5 | [Mock Business APIs & Seed Data](05-mock-business.md) | FastAPI mock APIs for **Flipkart** (track/refund/cancel/invoice) + **Airtel** (interop), with deterministic seed data the demo utterances resolve against. |
| 6 | [AI Manifest Generator](06-manifest-generator.md) | Upload → OCR + LLM → a valid manifest (the "protocol auto-generation" wow), with a mock path that yields the sample manifest tonight. |
| 7 | [Web App (WhatsApp-styled)](07-web-app.md) | The chat UI, mic-in/voice-out via the browser, all UI states, and the client↔server contract. |
| 8 | [WhatsApp Channel (Twilio)](08-whatsapp-channel.md) | The inbound webhook, voice-note handling, the **fake-inbound simulator** to test the whole WhatsApp path offline tonight, and the morning setup checklist. |
| 9 | [Execution Timeline & Task Board](09-timeline.md) | **Tonight's 28-item credit-free checklist** + the **hour-by-hour hackathon plan** + P0/P1/P2 shipping order + role split. |
| 10 | [Demo Script, Pitch & Risk Plan](10-demo-and-pitch.md) | Minute-by-minute demo, exact Telugu/Hindi utterances, the 8-layer "demo never dies" fallback matrix, elevator pitch, slide outline, judging strategy. |

**Suggested reading order:** this index → **9 (timeline)** → **10 (demo)** to see the target, then
**1 → 2 → 3 → 4** for the build spine, then 5–8 for the pieces.

---

## Shipping order (build feature-by-feature)

**P0 — must ship (a clean P0-only demo already wins):** manifest schema + Flipkart manifest · Sarvam
adapter (mock+live) · orchestrator (STT→plan→manifest→API→reply→TTS) · Flipkart mock API · web app
with voice · one live Indic-voice turn end-to-end · pre-recorded fallback audio + mock toggle.

**— MVP cut-line —**

**P1 — should ship:** real WhatsApp via Twilio · 2nd business (Airtel) + interoperability swap ·
LLM planner replacing regex · live cross-lingual translate.

**P2 — nice to have:** portal auto-gen from PDF (Vision OCR) · per-turn protocol trace UI · 3rd
language / voice controls · realistic auth flow.

> **Cut-line rule:** if any P0 is red at 15:30, kill all P2 and pull the whole team onto it.
> A clean P0-only demo beats a broken P1. Details: **[Doc 9 §3](09-timeline.md)**.

---

## Timeline at a glance

- **Tonight (25 Jul), credit-free:** stand up the whole mock stack so both channels drive the same
  orchestrator and complete a scripted refund/track turn — **`SARVAM_MODE=mock`, zero credits.**
  28-item checklist in **[Doc 9 §1](09-timeline.md)**.
- **Tomorrow (26 Jul), 10:00–18:00:** swap live Sarvam **one capability at a time** (STT → TTS →
  chat/translate), add WhatsApp + the 2nd business, **hard feature-freeze at 17:00**, rehearse ×3.
  Hour-by-hour in **[Doc 9 §2](09-timeline.md)**.

---

## Stack & Sarvam mapping

Backend **Python + FastAPI**, lightweight web frontend, **Twilio** for WhatsApp.

| UCXP need | Sarvam model | Live call |
|---|---|---|
| Voice → text (Telugu/Hindi) | **Saaras v3** (23 langs) | `speech_to_text.transcribe()` |
| Understand & orchestrate | **Sarvam-M / 30B / 105B** | `POST /chat/completions` (OpenAI-compatible) |
| Cross-lingual reply | **Mayura / Sarvam-Translate** | `text.translate()` |
| Text → natural voice | **Bulbul v3** (30+ voices) | `text_to_speech.convert()` |
| Read uploaded policy docs | **Sarvam Vision (OCR)** | `document_intelligence` |

Base URL `https://api.sarvam.ai/v1` · auth header `api-subscription-key` · SDK `pip install sarvamai`
(client `SarvamAI`) · **₹100 free credits** on signup at `dashboard.sarvam.ai`.

---

## Naming note (reconcile before coding)

Docs use placeholder business names slightly differently: the demo/timeline standardize on
**Flipkart** (e-commerce) + **Airtel** (telecom), matching the concept PDF; a couple of build docs
use generic stand-ins (**ShopKart / FiberNet**). **Pick one pair and use it everywhere** — recommend
**Flipkart + Airtel** for demo relatability (they're illustrative mocks, not integrations). Wherever
a doc says ShopKart/FiberNet, treat it as Flipkart/Airtel.

---

## What's next

This is the **plan**. The next step is the **credit-free groundwork** — scaffolding the `ucxp/`
repo exactly as **[Doc 1](01-architecture.md)** and **[Doc 9 §1](09-timeline.md)** specify:
FastAPI skeleton, manifest schema + Flipkart manifest, the mock Sarvam adapter, the mock business
API, the orchestrator with the mock planner, the web app shell, and the WhatsApp webhook +
fake-inbound simulator — all runnable tonight with `SARVAM_MODE=mock`.

Say the word and I'll start scaffolding, feature-by-feature in P0 order.
