# UCXP / OneSupport — Central Plan

> **This file is the single source of truth.** `frontend/`, `backend/`, and `ai_engine/`
> all follow it. If code and this file disagree, one of them is a bug — fix the
> disagreement, don't ignore it.

**Last updated:** 2026-07-26 · **Status:** AI Engine done · Frontend done (mocked) · Runtime not started

---

## 0. How this file stays true

Any change to scope, contracts, or structure updates this file **in the same change**.

| When you… | Update |
|---|---|
| Change a cross-layer contract (manifest schema, HTTP shape) | §5, §6 |
| Finish or start a layer | §3 status board |
| Deviate from what's written here | §7 Decision log — one row, with the reason |
| Add/drop a business, language, or capability | §4 scope table |
| Change the demo | §8 |

Rules for edits:
- **Append to the decision log, never rewrite history.** Judges ask "why"; the log is the answer.
- Keep the status board honest. `DONE` means demoed working, not written.
- Don't add scope here to make the plan look impressive. §9 exists to keep things out.

---

## 1. North star

**One interface. Any business. Any language. The job actually completes.**

We are not building customer *support*. We are building customer **resolution**: the
user speaks, a real workflow executes against a real (mocked) business API, and
something changes — a ticket exists, a cancellation is filed, a slot is booked.

The innovation on display is **UCXP: a protocol**, and a **runtime that contains
zero business-specific code**. Flipkart, Airtel and Apollo work because of their
manifests, not because of `if business == "flipkart"`.

### What we're scored on

| Product parameter | How we win it |
|---|---|
| Job-to-be-done | Action executes + returns a receipt (ticket ID, ETA, booking ref). Never "our policy says…" |
| Memory & Context | "Cancel it." resolves without repeating the business, service, or ID |
| Creativity | A protocol + runtime, when everyone else ships a chatbot |
| Impact | One manifest per business ⇒ every AI client serves them. Network effect |
| Delight | Telugu → Flipkart → immediately Airtel, same app, same voice, no switching |

**Sarvam parameter: Voice Experience. Exactly one.** Extra Sarvam APIs do not add
score. Our engine already covers all seven, but the *demo story* is voice —
STT → reasoning → TTS as one experience, never presented as four API calls.

---

## 2. Architecture

```
  React Native app            WhatsApp
         │                       │
         └───────────┬───────────┘
                     ▼
            ╔════════════════════╗
            ║   UCXP Runtime     ║   backend/   ← generic, no business code
            ║  manifest loader   ║
            ║  capability resolver║
            ║  workflow engine   ║
            ║  context/memory    ║
            ║  action executor   ║
            ╚═════╤════════╤═════╝
                  │        │
         ┌────────┘        └────────┐
         ▼                          ▼
   ┌───────────┐            ┌──────────────┐
   │ AI Engine │            │ manifests/   │
   │ ai_engine/│            │ + mock APIs  │
   └─────┬─────┘            └──────────────┘
         ▼
   Sarvam APIs
```

**The two directional rules that make this a protocol:**

1. **Nothing above the AI Engine knows Sarvam exists.** The runtime imports
   `SarvamOrchestrator`; it never sees a model name, an HTTP client, or a retry.
2. **Nothing in the runtime knows a business exists.** Business behaviour enters
   only through `manifests/*.json`. Adding a company = adding a manifest + a mock
   API. Zero runtime edits. This is the claim we make to judges, so it must be
   literally true — a grep for `flipkart` in `backend/app/runtime/` must return nothing.

---

## 3. Layer status board

| Layer | Path | Status | Owner |
|---|---|---|---|
| AI Engine | `ai_engine/` | ✅ **DONE** — live-verified against Sarvam 2026-07-26, 41 offline tests | Builder 3 |
| Frontend | `frontend/` | ✅ **DONE (mocked)** — all screens built, every call mocked | Builder 1 |
| UCXP Runtime | `backend/` | ⬜ **NOT STARTED** — this is the critical path | Builder 2 |
| Manifests | `manifests/` | ⬜ Not started | Builder 2 |
| Mock business APIs | `backend/app/mock/` | ⬜ Not started | Builder 2 |
| WhatsApp | `backend/app/api/whatsapp.py` | ⬜ Not started | Builder 3 |
| Consistency harness | `backend/app/harness/` | ⬜ Not started | Builder 3 |
| Frontend ↔ Runtime wiring | `frontend/src/api/` | 🟡 **Wired to the AI Engine (interim)** — chat + voice live, typechecked and contract-verified against a running engine; **not yet run on a device**. History stays local. Repoint at the runtime when it lands | Builder 1 |

### 3.1 AI Engine — done, treat the interface as frozen

Fully built and verified end-to-end against the live API. **Do not modify it to suit
the runtime** — if the runtime needs something new, add a method, don't change one.

Public surface (`from ai_engine import SarvamOrchestrator`):

| Method | Returns |
|---|---|
| `process_voice(audio, …)` | `VoiceResponse` — transcript, translation, answer, `audio_base64`, per-stage latency |
| `process_text(text, …)` | `TextResponse` |
| `reason(text \| messages, …)` | `LLMResponse` — LLM only, no translation hops |
| `translate` · `speak` · `transcribe` · `transliterate` · `detect_language` | single-capability escapes |
| `health()` | config, models, prompts |

Also runnable standalone: `python -m uvicorn ai_engine.app:app --port 8080` (docs at `/docs`).

**Things the runtime must know:**
- Public methods **never raise**. They return `success=False` + a structured `error`.
  Check the flag; don't wrap in try/except and assume exceptions.
- The Sarvam LLM (`sarvam-105b`) is a **reasoning model** — it thinks before answering,
  and thinking is billed against `max_tokens`. Latency is ~4.7 s and dominates the
  pipeline (voice round trip ≈ 6.8 s, text ≈ 2.1 s). **Budget the demo around this**:
  show the transcript immediately, stream/placeholder the answer.
- `LLMResponse.reasoning` holds chain-of-thought and is excluded from serialisation.
  Never surface it to a user or log it verbatim.
- Graceful degradation is on: TTS failure still returns text; translation failure
  still returns an answer. Check `degraded_stages` and render accordingly.
- **Speech input is capped at 30 s.** Sarvam's realtime STT rejects longer clips
  (their batch API is for those). The engine pre-checks WAV duration and fails in
  ~2 ms with `speech_failed` rather than burning a round trip — but the duration of
  non-WAV uploads (`m4a`/`webm` from a browser) can't be read cheaply, so those
  still fail upstream. The app must cap recording length client-side.

Run offline with zero API key: `python tools/mock_sarvam.py` + `SARVAM_BASE_URL=http://127.0.0.1:8099`.

### 3.2 Frontend — done, mocked

Expo SDK 57 · RN 0.86 · React 19 · TypeScript strict · Expo Router · NativeWind 4 ·
Zustand · React Query · Reanimated 4 · **expo-audio** (not expo-av) · lucide · Inter.

Screens: Splash → Home → Conversation → Voice overlay → History → Companies → Settings.
Components, store, and API layer are already separated; every endpoint is a mock behind
`src/api/{chat,voice,history}.ts` with a shared `client.ts`.

**Wiring it up is a one-file-per-endpoint change** — replace the mock body with `fetch`,
keep the exported signature identical. `isMockMode()` in `src/api/client.ts` is the switch,
now driven by `EXPO_PUBLIC_API_URL`: **unset ⇒ fully mocked**, set ⇒ live. See
`frontend/.env.example`.

Currently pointed at the AI Engine as an interim step (decision 13):

| Endpoint | Live behaviour |
|---|---|
| `sendChat` | `POST /v1/text` — real multilingual reply, **no receipt card** (needs the runtime) |
| `transcribeVoice` | `POST /v1/transcribe` — real Sarvam STT; rejects clips >30 s client-side |
| `fetchHistory` | still local — the engine is stateless and owns no database |

Business badges in live mode come from a client-side regex in `chat.ts`
(`classifyBusiness`). That is UI theming only, and the runtime's manifest-driven
resolver replaces it.

### 3.3 UCXP Runtime — to build

```
backend/
  app/
    main.py
    api/            chat.py · voice.py · whatsapp.py · meta.py
    runtime/        loader.py · resolver.py · engine.py · executor.py · renderer.py
    memory/         context.py · store.py
    mock/           flipkart.py · airtel.py · apollo.py
    harness/        consistency.py
    schemas/        pydantic models
    database/       sqlite, sqlalchemy
manifests/
  flipkart.json · airtel.json · apollo.json
```

**Request flow** (`POST /chat`):

```
text ─▶ load conversation context
     ─▶ resolve business      (sticky: context first, else classify)
     ─▶ load manifest
     ─▶ resolve capability    (LLM, candidates built FROM the manifest)
     ─▶ slot-fill required_inputs   ── missing? ask, save state, return
     ─▶ check business rules  ── blocked? return the rule's message
     ─▶ execute endpoint      (mock business API)
     ─▶ render response template with the API result
     ─▶ persist context, return
```

---

## 4. Scope — deliberately narrow

| Dimension | Deep (real manifest + mock API + tested) | Shallow (directory only) |
|---|---|---|
| Businesses | **Flipkart, Airtel, Apollo** | 25 more already in the frontend directory |
| Languages | **English, Hindi, Telugu, Tamil** — perfect, harness-verified | Engine supports 11; they'll work, we don't claim them |
| Capabilities | ~3 per business, listed below | — |

The frontend ships a 28-business directory on purpose: it *shows* what a protocol
scales to. Only 3 are wired. If asked, say exactly that — "three are live, the
directory is what the protocol makes cheap." Never imply 28 work.

**Capabilities to implement:**

| Business | Capabilities |
|---|---|
| Flipkart | `track_order`, `request_refund`, `cancel_order` |
| Airtel | `cancel_fiber`, `get_bill`, `raise_ticket` |
| Apollo | `book_appointment`, `find_doctor`, `cancel_appointment` |

Each must return a **receipt** — tracking ETA, ticket ID, refund ref, booking ref.
A capability that only talks has not completed a job and does not count as done.

---

## 5. The UCXP manifest — the core contract

This schema is what makes the runtime generic. **Both the runtime and every manifest
conform to it.** Changing it changes both; update this section first.

```jsonc
{
  "ucxp_version": "0.1",

  "business": {
    "id": "flipkart",
    "name": "Flipkart",
    "category": "Shopping",
    "glyph": "🛍",
    "color": "#2874F0",
    "languages": ["en-IN", "hi-IN", "te-IN", "ta-IN"]
  },

  // Free-text hints the business resolver uses. NOT code — data.
  "routing": {
    "aliases": ["flipkart", "फ्लिपकार्ट", "ఫ్లిప్‌కార్ట్"],
    "domains": ["order", "delivery", "package", "parcel", "refund", "return"]
  },

  "auth": {
    "type": "none",                        // none | otp | token  (demo: none)
    "identity_fields": ["phone"]
  },

  "capabilities": [
    {
      "id": "track_order",
      "description": "Find where a customer's order currently is and when it arrives.",
      "examples": [
        "where is my order",
        "मेरा ऑर्डर कहाँ है",
        "నా ఆర్డర్ ఎక్కడ ఉంది"
      ],
      "required_inputs": [
        {
          "name": "order_id",
          "type": "string",
          "prompt": "What's your order ID?",
          // Resolved from context/defaults before asking the user.
          "default_from": "context.last_order_id",
          "optional": false
        }
      ],
      "rules": [
        {
          "id": "refund_window",
          "when": "result.days_since_delivery > 7",
          "deny": "Refunds are only available within 7 days of delivery. I can raise a support ticket instead."
        }
      ],
      "confirm": false,                    // true ⇒ runtime asks yes/no before executing
      "action": "get_order_status",        // → endpoints[].id
      "response": "Your order {{order_id}} is {{result.status}} and arrives {{result.eta}}.",
      "receipt": {                          // structured outcome the UI renders as a card
        "label": "Arriving {{result.eta}}",
        "tone": "success"
      }
    }
  ],

  "endpoints": [
    {
      "id": "get_order_status",
      "method": "GET",
      "url": "{{mock_base}}/flipkart/orders/{{order_id}}",
      "headers": {},
      "body": null,
      "timeout_s": 5
    }
  ],

  // Retrieval-lite: policy text the LLM may quote. Not a substitute for actions.
  "knowledge": [
    { "id": "refund_policy", "text": "Refunds are processed within 5-7 business days." }
  ],

  "escalation": {
    "when": ["rule_denied", "action_failed", "user_asks_human"],
    "message": "I'm handing this to a human agent — they'll call you within 2 hours.",
    "action": "create_escalation_ticket"
  }
}
```

**Template rules** (one renderer, used everywhere): `{{name}}` placeholders resolve
against `{ ...collected_inputs, result, context, mock_base }`. Missing key ⇒ render
error, not silent blank — a blank in the demo is worse than a loud failure.

**Capability resolution:** build the candidate list from the loaded manifest's
capabilities (`id` + `description` + `examples`) and have the LLM pick one, returning
strict JSON `{"capability_id": …, "inputs": {…}, "confidence": …}`. The prompt is
generic; the candidates are data. Do not use tool-calling — treat structured JSON
output as the contract, and validate it against the manifest before acting.

---

## 6. HTTP contracts

### Runtime (`backend/`) — what the clients call

```
POST /chat                 { conversation_id?, text, language?, user_id? }
                        → { conversation_id, reply_text, business_id?, capability?,
                            receipt?, needs?, state, degraded[] }
POST /voice                multipart: file (≤30 s of audio), conversation_id?
                        → chat response + { transcript, detected_language, audio_base64, latency }
POST /whatsapp/webhook     Twilio sandbox form-encoded → TwiML/text
GET  /businesses           directory (from manifests, not hardcoded)
GET  /manifests/{id}       raw manifest — judges will ask to see one
GET  /history?user_id=     conversations + completed actions
POST /harness/run          { intent, languages[] } → consistency matrix
GET  /health
```

`needs` is how the runtime asks for a missing slot — the client just renders
`reply_text`; `needs` exists so the UI can show a targeted input if it wants.

### Frontend ↔ Runtime

Keep the exported signatures in `frontend/src/api/*.ts` exactly as they are. Swap the
mock body for `fetch`. Set the base URL from an env var, not a constant.

### Runtime → AI Engine

In-process Python import. Do **not** call the AI Engine over HTTP from the runtime —
they deploy together. `ai_engine.app` exists for standalone testing only.

---

## 7. Decision log

Deviations from the original brief, with reasons. Append; don't edit.

| # | Decision | Why |
|---|---|---|
| 1 | AI Engine **fully implemented**, not stubbed as interfaces | It's the demo's riskiest dependency. Built and live-verified first so nothing downstream is blocked by an unknown API |
| 2 | LLM is `sarvam-105b`, not `sarvam-m` | `sarvam-m` is deprecated. Current models are reasoning models; `sarvam-30b` frequently exhausts its 4096-token budget mid-thought, `sarvam-105b` did not |
| 3 | Frontend directory carries **28 businesses**, only 3 wired | Shows what a protocol scales to at zero cost. Depth stays at 3 |
| 4 | Added a **Companies** screen (5th tab), not in the original brief | Makes the protocol tangible — you can browse what UCXP reaches |
| 5 | `expo-audio`, not Expo AV | Expo AV is deprecated in SDK 57 |
| 6 | Prompts live in `ai_engine/prompt_library/*.md`, not in code | Editable during the demo without a redeploy |
| 7 | Translation is **skipped when redundant** | If the user's language is already the reasoning language, the two translate hops are pure latency. Faster, and a better architecture answer for judges |
| 8 | `Backend/` renamed to `backend/` (was empty) | Mixed-case breaks Python import conventions alongside `ai_engine/` |
| 9 | SQLite + local JSON manifests; no Postgres/Mongo/Firebase | Zero setup. Manifests as files *is* the protocol story |
| 10 | Twilio WhatsApp **sandbox**, not Meta Cloud API | Meta needs approval + template verification. Sandbox works today |
| 11 | AI Engine pre-checks audio duration and rejects >30 s locally | Live testing found Sarvam's realtime STT hard-caps at 30 s. Failing in 2 ms with an actionable message beats a 400 after three retries. Constrains `POST /voice` — see §3.1 |
| 12 | Unknown source languages are resolved via `/text-lid` before translating | Live `/translate` and `/transliterate` reject `"auto"`, which the original implementation sent. Callers can still omit the source; the engine pays one extra ~300 ms hop only when it doesn't know |
| 13 | Frontend wired **directly to `ai_engine.app`**, not to the runtime | Deviates from §6 ("standalone testing only"). The runtime doesn't exist yet and the frontend was 100% mocked; this makes real Sarvam voice and multilingual replies demonstrable in the app today. Cost: no receipts, no memory, no business routing until the runtime lands — at which point only `EXPO_PUBLIC_API_URL` changes, because the client contracts are unchanged |

---

## 8. The demo — definition of done

We are done when this runs, unedited, twice in a row:

1. Open the app. Tap the mic. Speak **Telugu**: *"నా Flipkart order ఎక్కడ ఉంది?"*
2. Reply comes back **spoken in Telugu**, with a receipt card: order status + ETA.
3. Without switching anything, say in **Hindi**: *"Airtel Fiber बंद कर दो"*
4. Cancellation executes. Ticket ID returned. Different business, same interface, same voice.
5. Say **"Cancel it."** with no other context — memory resolves the business and service.
6. Send the same request over **WhatsApp** — identical backend path, identical outcome.
7. Open the **Consistency dashboard**: same intent in 4 languages → same capability →
   same action → **100%**.
8. Open `GET /manifests/airtel` and show the judge there is no Airtel code in the runtime.

Step 8 is the winning moment. Everything else supports it.

**Demo hygiene:** the LLM takes ~5 s. Show the transcript the instant STT returns, then
a typing indicator. Never a frozen screen. Pre-warm the engine before presenting.

---

## 9. Not building

Auth · login · payments · real business integrations · admin dashboard · analytics ·
push notifications · multi-user · production security · OAuth · database tuning ·
landing page · 22 languages · offline mode.

If something here starts getting built, stop and move it to §4 with a reason, or delete it.

---

## 10. Judge questions

**Why a protocol?** Every company builds its own AI support stack today. UCXP standardises
how a business exposes support capabilities to any AI assistant — OpenAPI for APIs, MCP for
tools, UCXP for customer resolution.

**Why Sarvam?** The protocol only matters if it works in the language the customer actually
speaks. Sarvam gives speech, reasoning and synthesis tuned for Indian languages, so one
manifest serves every linguistic market without rewriting the workflow.

**Why not ChatGPT?** General LLMs answer questions. UCXP completes workflows — manifests,
business rules, real API calls, deterministic outcomes with receipts.

**What's the moat?** The protocol and its network effect. Once a business publishes a
manifest, every compliant client serves them with no bespoke integration.

**How does a business onboard?** Publish a manifest describing capabilities, inputs, rules
and endpoints. No runtime change. Show them `manifests/airtel.json`.

**How do you know it's consistent?** We don't claim it — we measure it. The harness runs
identical intents across languages and asserts the same capability and same action fire
every time. That's the dashboard.
