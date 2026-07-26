# UCXP / Sahayak — Central Plan

> **This file is the single source of truth.** `frontend/`, `backend/`, and `ai_engine/`
> all follow it. If code and this file disagree, one of them is a bug — fix the
> disagreement, don't ignore it.

**Last updated:** 2026-07-26 · **Status:** AI Engine done · Runtime running (3 businesses, 9 capabilities) · Frontend wired to the runtime

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
| UCXP Runtime | `backend/` | 🟡 **RUNNING** — LangGraph graph (route → classify → act → compose → localize). Now also accepts **published (Shopify) manifests** via `runtime/normalize.py`; live-verified end-to-end 2026-07-26 (pinned → track_order → Shopify mock → receipt). ⚠️ `tests/test_runtime.py` red — targets the retired flipkart/airtel/apollo set, needs rewrite for the merchants (§7 #20) | Builder 2 |
| Manifests | `manifests/` | 🟡 **MIGRATING** — retired flipkart/airtel/apollo; now the **published Shopify merchants** (ravi-electronics loaded; 4 more being added). Normalized to the internal shape at load | Builder 2 |
| Mock business APIs | `backend/app/mock/` | ✅ **DONE** — legacy flipkart/airtel/apollo + one **generic Shopify connector** (`/mock/connectors/shopify/...`) serving every merchant, deterministic | Builder 2 |
| WhatsApp | `backend/app/api/whatsapp.py` | 🟢 **LIVE over Twilio sandbox** — `POST /whatsapp/webhook` reuses `runtime.run`, keyed on the sender's number for memory. Text · voice-note (transcribe) · PDF (pypdf) · image (Tesseract OCR) in; async reply out via Twilio REST (see §7 #19). Verified end-to-end 2026-07-26: real inbound text + voice note, outbound reply delivered+read. Cloudflare tunnel for the webhook | Builder 3 |
| Voice-call channel | `backend/app/agent_tools/` | 🟡 **Built + verified over the tunnel** — Route A: Samvaad owns the call; UCXP is its Advanced Tool. Live-call path `POST /agent/execute` (~0.7 s through tunnel); `/agent/resolve` kept for the full-reasoning path. Not yet dialled from a real Samvaad agent. See §11 | — |
| Consistency harness | `backend/app/harness/` | ⬜ Not started | Builder 3 |
| Frontend ↔ Runtime wiring | `frontend/src/api/` | 🟡 **Wired to the runtime** — `/chat` + `/transcribe`, receipts render as action cards, conversation id carries memory. Voice transcription proven on-device; the chat path is not yet | Builder 1 |

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

### 3.3 UCXP Runtime — built, LangGraph

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
| Businesses | **5 published Shopify merchants** (see §7 #20) | the frontend directory shows more |
| Languages | **English, Hindi, Telugu, Tamil** — perfect, harness-verified | Engine supports 11; they'll work, we don't claim them |
| Capabilities | Shopify-default per merchant (`track_order`, `refund`, …) | — |

The businesses are now **published UCXP manifests** produced by the onboarding
tool (Shopify-connected), pasted into `manifests/`. The runtime accepts that
richer shape via a normalization adapter (§7 #20); all merchants share one
generic Shopify connector mock, which is the protocol claim made literal.

Each capability must return a **receipt** — tracking ETA, refund ref, etc. A
capability that only talks has not completed a job and does not count as done.

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
| 14 | Product renamed **OneSupport → Sahayak**; **UCXP unchanged** | Sahayak is the project; UCXP stays the protocol it speaks, so `ucxp_version`, "UCXP Runtime" and the §10 pitch are untouched. Native identifiers (`com.ucxp.onesupport` package/bundle ID, the `onesupport` deep-link scheme) were **deliberately not renamed**: they are invisible to users, and `android/` is hand-patched with a standing "do not re-run `expo prebuild`" constraint. Rename them only alongside a planned prebuild + clean rebuild |
| 15 | Runtime built on **LangGraph**, used purely as a state machine | Requested, and it earns its place: the turn is genuinely a graph with short-circuits (missing slot, confirmation, rule denial). LLM calls go through `SarvamOrchestrator`, so §2 rule 1 holds — LangChain never sees a Sarvam credential |
| 16 | Prompts 2 and 3 are **gated, not unconditional** | Three ungated reasoning calls made one turn take 58 s. Gating (prompt 2 only when an input is missing and the text plausibly has one; prompt 3 only when no manifest template renders) cuts the same turn to 10 s and makes a completed job's wording deterministic. `UCXP_COMPOSE_WITH_LLM=always` restores the unconditional behaviour |
| 17 | WhatsApp adapter accepts **documents** too — PDF via `pypdf`, images via **Tesseract OCR** | User-directed scope for the WhatsApp channel. Extraction lives in the adapter (`backend/app/api/whatsapp.py`), never the engine (its interface is frozen and has no vision) and never the runtime (stays business-generic). A customer can forward a bill PDF or snap a photo and it flows through as text. Scanned-but-empty PDFs and unreadable images return a friendly "type it instead" |
| 18 | WhatsApp **replies are text by default**; spoken voice-note reply is opt-in (`UCXP_WHATSAPP_SPEAK=1`) | Inbound voice notes always work (transcribe → resolve). Outbound is text because it is instant and never fails; a spoken reply needs the engine's **WAV** transcoded to **MP3** (WhatsApp rejects WAV) via `ffmpeg`, served from `GET /whatsapp/media/{id}` over the tunnel. Enabled only when both the flag is set and ffmpeg is present |
| 19 | WhatsApp replies are **async**: the webhook acks instantly (empty TwiML), the answer is sent later via the **Twilio REST API** | Live testing showed resolution takes 20–27 s (sarvam-105b), but a Twilio webhook must respond in ~10 s or it times out (error 11200) and drops the reply. So we ack in ~0.4 s and deliver out-of-band from a FastAPI `BackgroundTask` once resolution finishes — the reply lands as a follow-up message. This makes `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN` required (not just for media). Mirrors §8's "show it instantly, then the answer" hygiene, adapted to a channel with no typing indicator |
| 20 | Deep businesses switched from Flipkart/Airtel/Apollo to **5 published Shopify merchants**; runtime **adapts to the published manifest shape** instead of transforming the files | The onboarding tool emits a richer, connector-oriented manifest (business is a name string, capabilities carry `name`/`endpoint`/`parameters`/`response`, plus `profile`/`policies`/`faq`/`data_source`). A new `runtime/normalize.py` maps that shape into the internal `Manifest` at load time, so the graph/executor/renderer are unchanged and both shapes load. `raw()` still returns the original JSON judges will read. **Consequence:** `tests/test_runtime.py` targets the retired Flipkart/Airtel/Apollo manifests and is red until rewritten for the merchant set (ai_engine suite unaffected) |
| 21 | One **generic Shopify connector** (`/connectors/shopify/{business_id}/...`) serves every merchant, **real or mock** | All published merchants are `shopify_default`. Normalised endpoints route to this one connector with the business id embedded; it resolves that store's `data_source` + token and calls the **real Shopify Admin API** (`GET /orders.json?name=…`, mapped to flat fields), falling back to deterministic mock when no token is set. `credential_ref: vault://ravi-electronics` → env `SHOPIFY_TOKEN_RAVI_ELECTRONICS` (or a single `SHOPIFY_TOKEN`). Refunds are *initiated*, never auto-committed (a real refund is destructive + write-scoped). The runtime still only knows "call the connector" |
| 22 | WhatsApp is **pinnable to one business** via `UCXP_WHATSAPP_BUSINESS` | A business's WhatsApp number is its own support line, so every turn resolves against that business with no cross-business routing (`route source=pinned`). Added `force_business_id` to `runtime.run()`; empty config ⇒ WhatsApp routes like the app. Also hardened `classify`: a capability id with no resolved business is dropped (smalltalk) instead of crashing `gather` on a `None` manifest |
| 23 | Conversation memory is **persisted to disk** (`.ucxp_state.json`), not just in-process | A restart mid-flow (e.g. between a refund confirmation and the customer's "Yes") lost the pending state, so the follow-up landed with nothing pending and fell back to smalltalk. The store now snapshots after every turn and reloads on startup, so multi-step flows survive restarts and process recycling. Single JSON file, atomic write, failures never break a reply — path overridable via `UCXP_STATE_FILE`. Aligns with §9's "SQLite is fine"; a file is enough at demo scale |
| 17 | `SARVAM_REQUEST_TIMEOUT` raised 30 s → 90 s | sarvam-105b legitimately reasons past 30 s on open-ended writing. The old timeout killed a good call and retried it, doubling latency instead of saving it |
| 18 | Runtime exposes `POST /transcribe` (STT only) alongside `POST /voice` | The app transcribes first so it can show the customer their own words immediately, then sends text to `/chat`. Pointing it at `/voice` would execute the capability twice |
| 19 | `EXPO_PUBLIC_API_URL` accepts a **bare port**, resolved against the Metro host | A laptop's LAN IP changes with the network, and a stale IP is indistinguishable from a broken backend — it cost a debugging cycle. Metro's host is reachable by definition |
| 24 | Live voice-call added as a **channel**, not a second brain — Twilio Media Streams and the in-app WebSocket both feed the existing `/chat` runtime; every Sarvam streaming call stays inside `ai_engine` (two **added** methods, the frozen interface unchanged) | A phone call is one more surface over the same manifest-driven resolution, so receipts, memory and rules come for free, and §2 rule 1 ("one place talks to Sarvam") stays literally true. Pipecat is used only for transport, VAD and interruption — never for Sarvam access. See §11 |
| 25 | **Superseded #24.** Voice-call goes through **managed Sarvam Samvaad**, not a self-hosted Pipecat pipeline. Samvaad owns telephony + STT + TTS + turn-taking; UCXP is exposed as one Samvaad **Advanced Tool**, `POST /agent/resolve`, wrapping `UcxpRuntime.run()` | A Samvaad + Twilio agent already exists (`Twilio-Pran-…`), and Samvaad gives sub-500ms voice, interruption and cross-channel memory for free — rebuilding that in Pipecat is wasted effort. UCXP stays the brain (manifests, resolution, receipts) and becomes "just another compliant client," which is exactly the protocol thesis. Trade-off: no in-app receipt card on a pure phone call, and Samvaad's own LLM decides *when* to call the tool — noted in §11. No Sarvam client enters the repo, so §2 rule 1 still holds |
| 26 | For the **live-call path**, added `POST /agent/execute` (per-capability) alongside `/agent/resolve`. Samvaad's own fast LLM picks the business + capability and collects inputs; `/agent/execute` just runs the manifest action and renders the receipt — **no Sarvam reasoning in the loop** | Measured: `/agent/resolve` spends ~20 s in a single `sarvam-105b` classify pass — unusable on a live call, and `reasoning_effort=low` neither helped latency nor kept accuracy. `/agent/execute` returns in **~10 ms local / ~0.7 s through the tunnel** because the slow classify moves to Samvaad's sub-500ms LLM. Cost: UCXP no longer *resolves* which capability on the call path (Samvaad does), so the consistency-harness claim covers `/chat`, not the call — stated in §11.4. It reuses the runtime's executor/renderer/rules unchanged, needs no Sarvam key, and adds no business code |

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

---

## 11. Live voice-call channel — design (Route A: managed Samvaad)

**Status: skeleton built, not yet live.** Nothing here is `DONE` until a real call
resolves a real job end to end (see §11.6). The self-hosted Pipecat variant (decision
#24) was superseded by #25 — this section is the live design.

### 11.1 The division of labour

Sarvam **Samvaad** is a managed voice-agent platform: it owns telephony (Twilio/Exotel),
STT, TTS, turn-taking and barge-in, with sub-500 ms latency and cross-channel memory. We
do **not** rebuild any of that. We give Samvaad **one Advanced Tool** that reaches UCXP,
so a call resolves a real job instead of only talking.

```
  Caller ──▶ Twilio ──▶ Samvaad agent  ── POST /agent/resolve ──▶  UcxpRuntime.run()
   (voice)   (PSTN)   (STT·LLM·TTS·      (the tool)                manifest → capability
                       turn-taking)      ◀── { say, receipt } ──   → action → receipt
```

- **Samvaad owns the voice.** STT, TTS, when to speak, when to listen.
- **UCXP owns the resolution.** Which business, which capability, slot-filling, rules,
  the real action, the receipt. Exactly the `/chat` brain — the tool wraps
  `UcxpRuntime.run(text, conversation_id=…, language=…, user_id=…)`.
- Samvaad is therefore **just another compliant UCXP client**, alongside the app and
  WhatsApp. That *is* the protocol thesis, made literal.

### 11.2 Where the code lives (and doesn't)

```
backend/app/agent_tools/
  router.py    POST /agent/resolve  — the tool Samvaad calls each turn
               GET  /agent/tool-spec — the tool definition to paste into the dashboard
  schemas.py   ResolveRequest (lenient field aliases) · ResolveResponse
  __init__.py  exports the router
```

- **No Sarvam client here.** The tool never calls Sarvam — Samvaad already did the STT
  and will do the TTS. §2 rule 1 holds: a grep for `sarvam`/`api.sarvam.ai` outside
  `ai_engine/` still returns nothing.
- **No `if business == …` here.** The tool hands the transcript to `runtime.run()` and
  returns what to say. §2 rule 2 holds.

### 11.3 The tool contract

`POST /agent/resolve` — Samvaad sends the caller's words, gets back what to say:

```jsonc
// request  (field names are lenient — message|text|query|utterance all accepted)
{ "message": "నా Flipkart order ఎక్కడ ఉంది?", "conversation_id": "call-42", "language": "te-IN" }

// response
{
  "say": "Your order OD123 is out for delivery and arrives today.",  // agent speaks this
  "done": true,                        // a job completed (receipt present)
  "needs_input": null,                 // else the slot name still required
  "receipt": { "label": "Arriving today", "tone": "success" },
  "business": "flipkart", "capability": "track_order",
  "conversation_id": "call-42",        // echo back next turn → memory carries
  "state": "resolved", "language": "te-IN", "degraded": []
}
```

Agent behaviour, encoded in the tool description (`GET /agent/tool-spec` emits it from
the live manifests): *speak `say`; if `needs_input` is set, ask `say` and call again with
the same `conversation_id`; when `receipt` is present the job is done.*

### 11.4 Two things this trades away (be honest with judges)

1. **Samvaad's LLM decides *when* to call the tool.** Capability *resolution* still
   happens inside UCXP, but the first hop — "is this a support request at all?" — is
   Samvaad's. The consistency harness still measures UCXP's resolver; it does not cover
   Samvaad's routing. Say that plainly.
2. **No in-app receipt card on a pure phone call.** A PSTN caller has no screen. The
   structured `receipt` still returns (and is spoken), and the in-app/web Samvaad
   channels *can* render it — but the phone call itself is voice-only.

### 11.5 Setup (dashboard + tunnel)

1. Expose the runtime publicly: `ngrok http 8000` → set `UCXP_PUBLIC_BASE_URL` to the
   https URL so `tool-spec` emits absolute URLs.
2. In the Samvaad dashboard for the existing `Twilio-…` agent, add an Advanced Tool from
   `GET /agent/tool-spec` (name, description, `POST {base}/agent/resolve`, parameters).
3. Optional: set `UCXP_AGENT_TOOL_TOKEN` and configure the same bearer on the Samvaad
   side, so only your agent can call the tool.
4. Give the agent a system instruction: reply only via the tool for order/bill/booking
   requests, and read `say` verbatim.

New config (`.env`, secrets pasted by a human — never committed):

```
UCXP_PUBLIC_BASE_URL      # https tunnel/host, used to build the tool URL
UCXP_AGENT_TOOL_TOKEN     # optional shared secret Samvaad sends as Bearer
```

No new Python dependencies — it's one more router on the existing FastAPI app.

### 11.6 Definition of done for this channel

1. Call the Samvaad agent's number, speak **Telugu**: *"నా Flipkart order ఎక్కడ ఉంది?"*
2. Hear the order status + ETA **spoken back in Telugu** — a real `track_order` action
   ran through UCXP (visible in the runtime logs as `agent.resolve … capability=track_order`).
3. Say **"Cancel it."** — the echoed `conversation_id` lets memory resolve the business
   and order, exactly as in the §8 text demo.

Testing ladder: offline unit tests over the tool contract (`tests/test_agent_tools.py`,
runtime faked) → local live with `ngrok` + the Samvaad dashboard → the real phone call.

### 11.7 Explicitly out of scope for this channel

Call recording/storage, IVR menus, DTMF, transfer to a human PBX, concurrent-call
scaling, voicemail, and re-hosting Samvaad's STT/TTS ourselves. This is one demonstrable
live channel over the existing brain — not a contact-centre platform. If one of these
starts getting built, it goes to §9 or gets a decision-log row first.
