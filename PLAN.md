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
| UCXP Runtime | `backend/` | 🟢 **HOSTED** — `https://sahayak-ucxp-sarvam-production.up.railway.app` (Railway, Docker, volume at `/data`). Verified in prod 2026-07-28: 5 manifests, engine configured, `/chat` → `track_order` → **real Shopify** (order 1001 = ₹1299 delivered) → receipt, and a two-turn slot-fill proving volume-backed memory. Loopback self-call confirmed working (§7 #29 clear). ⚠️ `tests/test_runtime.py` still red — targets the retired flipkart/airtel/apollo set (§7 #20) | Builder 2 |
| Manifests | `manifests/` | 🟡 **MIGRATING** — retired flipkart/airtel/apollo; now the **published Shopify merchants** (ravi-electronics loaded; 4 more being added). Normalized to the internal shape at load | Builder 2 |
| Mock business APIs | `backend/app/mock/` | ✅ **DONE** — legacy flipkart/airtel/apollo + one **generic Shopify connector** (`/mock/connectors/shopify/...`) serving every merchant, deterministic | Builder 2 |
| WhatsApp | `backend/app/api/whatsapp.py` | 🟢 **LIVE over Twilio sandbox** — `POST /whatsapp/webhook` reuses `runtime.run`, keyed on the sender's number for memory. Text · voice-note (transcribe) · PDF (pypdf) · image (Tesseract OCR) in; async reply out via Twilio REST (see §7 #19). Verified end-to-end 2026-07-26: real inbound text + voice note, outbound reply delivered+read. Cloudflare tunnel for the webhook | Builder 3 |
| Consistency harness | `backend/app/harness/` | ⬜ Not started | Builder 3 |
| Frontend ↔ Runtime wiring | `frontend/src/api/` | 🟡 **Wired to the runtime** — `/chat` + `/transcribe`, receipts render as action cards, conversation id carries memory. Voice transcription proven on-device; the chat path is not yet | Builder 1 |
| Android APK | `frontend/android/…/release/` | 🟡 **Built & verified standalone** 2026-07-28 — release build, bundle compiled in, launches with Metro stopped and no crash. Universal (4 ABIs, 111 MB). Ships a **placeholder** backend URL; set the real one in Settings → Backend (§7 #33) | Builder 1 |
| Web (Vercel) | `frontend/dist` | 🟡 **Exports clean** — `expo export -p web` produces a 10 MB SPA, backend URL inlined, `vercel.json` written. **Not yet deployed** (needs the hosted backend + a Vercel project) | Builder 1 |

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
| 24 | **Android ships as a `--variant release` APK**, not a debug build; web ships via `expo export -p web` from the *same* Expo codebase | The APK only worked tethered because a debug build carries no JS bundle — it pulls from Metro over `adb reverse`. Release compiles the bundle in. `build.gradle` already signs release with the debug keystore, so no keystore work. Exporting the existing app to web also avoids a React+Vite rewrite: one codebase, two hosted surfaces |
| 25 | **APK is built BEFORE the web dependencies are installed** | Web export needs `react-dom` + `react-native-web`, and `npx expo install` runs npm install — which can disturb the hand-patched `node_modules` the Android build depends on (§7 #14's "don't re-run prebuild" constraint, same root cause). Building the APK first means a broken install costs the web build, never the APK already on disk |
| 26 | **`EXPO_PUBLIC_API_URL` must be a full `https://` URL for both shipped surfaces**, not the bare-port form of §7 #19 | The bare port resolves against Metro's host, which does not exist in a standalone APK or a Vercel build — it falls back to `http://localhost:8000`, i.e. the phone/browser itself, and silently drops to mocks. #19's convenience form stays correct for LAN dev only. Android 9+ additionally refuses cleartext, so HTTPS is required, not preferred |
| 27 | **Web ships with simulated voice**; Android and WhatsApp carry the voice story | `useVoiceRecorder.ts` flags `web-unsupported` — `expo-audio` has no web mic capture, so it falls back to a simulated clip. Rather than block the web launch on a `MediaRecorder` rewrite, web is positioned as the clickable proof that the runtime has more than one client (text chat, real receipts, real multilingual). Do not demo voice from a browser |
| 28 | `requirements.txt` **declared only the AI Engine's dependencies**; added `langgraph`, `twilio`, `pypdf`, `pytesseract`, `pillow` | They were installed in `.venv` and imported by `backend/`, so everything worked locally and nothing flagged it. A clean container built from `requirements.txt` would have died on `import langgraph` before serving one request — the first Railway deploy would have failed with a stack trace pointing at the runtime rather than at the manifest. Re-run an AST import cross-check against `requirements.txt` whenever a new import lands |
| 29 | Docker `CMD` exports **`UCXP_PORT=$PORT`**, not just `--port $PORT` | `config.py:from_env()` derives `mock_base_url` and `connector_base_url` from `UCXP_PORT`, and the runtime reaches its own mock and Shopify connector over loopback. Binding uvicorn to Railway's `$PORT` while `UCXP_PORT` stayed 8000 would leave `/health` green and every capability failing at `act` on a refused connection — the worst failure shape, because the manifest and the graph both look innocent. Keeping them equal also keeps the self-call in-container rather than routing out to the public URL and back |
| 30 | `SARVAM_REQUEST_TIMEOUT` raised 30 s → 90 s | sarvam-105b legitimately reasons past 30 s on open-ended writing. The old timeout killed a good call and retried it, doubling latency instead of saving it |
| 31 | Runtime exposes `POST /transcribe` (STT only) alongside `POST /voice` | The app transcribes first so it can show the customer their own words immediately, then sends text to `/chat`. Pointing it at `/voice` would execute the capability twice |
| 32 | `EXPO_PUBLIC_API_URL` accepts a **bare port**, resolved against the Metro host | A laptop's LAN IP changes with the network, and a stale IP is indistinguishable from a broken backend — it cost a debugging cycle. Metro's host is reachable by definition |
| 33 | Backend URL is **editable at runtime** (Settings → Backend), overriding the compiled value | `EXPO_PUBLIC_*` is inlined at bundle time, so a shipped APK could otherwise never be repointed — every backend change meant a full Gradle rebuild. The override is stored with AsyncStorage, read once at startup before any request, and includes a **Test** button that pings `/health`. This is what makes shipping with a placeholder viable while hosting is still being set up |
| 34 | `scripts/android-patches.sh` saves/restores the hand-patched `node_modules` files | §7 #25 ordered the APK before the web install because an install wipes those patches. A backup makes it recoverable instead of merely avoidable, so one install can serve both AsyncStorage and the web deps. **The patch lives in `.gradle`, `.gradle.kts` and `.kt` files — 15 in total**; an earlier `--include="*.gradle"` matched only 5 and would have silently under-restored |
| 35 | Railway variables are pushed by **`scripts/sync-railway-env.sh`**, not pasted by hand | `.env` is git-ignored, so Railway can only learn the secrets manually — and a hand copy silently dropped the tail of the file. The Shopify and Twilio keys sit on lines 68–78 of 78, so the paste covered the `SARVAM_*` block and stopped short: `/health` came up green, `/chat` resolved, and **every order lookup quietly returned mock data** (₹3049 instead of the real ₹1299). Nothing failed loudly. The script pushes a fixed key list in one call, prints only a prefix + length, and deliberately omits `PORT`/`UCXP_PORT`/`*_BASE_URL` so #29 cannot come back |
| 35 | Self-call URLs resolve `$PORT` **over loopback**, not via the public URL | §11.1 said to set `UCXP_MOCK_BASE_URL`/`UCXP_CONNECTOR_BASE_URL` to the public origin. Loopback is better: no public round trip, no dependency on knowing the deploy URL at boot. The actual bug was port resolution — `UCXP_PORT` defaulted to 8000 while the platform binds `$PORT`, so the runtime called a dead port and every capability failed at `act` with `/health` still green. `port` now falls back to `$PORT` |
| 36 | Web output pinned to `single` (SPA) with a Vercel catch-all rewrite | `app.json` left `web.output` unset, so the mode was implicit. Expo Router deep links 404 on a static host without a rewrite to `/`; pinning the mode makes the Vercel config match the build rather than assuming it |

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

## 11. Shipping — Vercel web + standalone Android

Goal: a **clickable web URL** and an **APK that works with the phone off the
laptop**, both talking to a hosted backend. Written to be executed top to bottom.

### 11.0 What is already in place

Created 2026-07-28, so the steps below are configuration + running builds, not authoring:

| Artifact | Purpose |
|---|---|
| `Dockerfile` + `.dockerignore` | Runtime + engine image, with `tesseract-ocr` and `ffmpeg` |
| `railway.json` | Dockerfile builder, `/health` healthcheck |
| `frontend/vercel.json` | Build command, output dir, SPA rewrites, asset caching |
| `frontend/scripts/android-patches.sh` | save/restore the 15 patched `node_modules` files |
| Settings → Backend | Change the server URL on a running app, with a Test button |

Two constraints still govern the order:

1. **`npm install` overwrites the hand-patched `node_modules` files** the Android
   build needs (the `NODE_EXECUTABLE` patch, 15 files across `.gradle`,
   `.gradle.kts` and `.kt`). Mitigated rather than merely avoided now:
   `./scripts/android-patches.sh save` before, `restore` + `check` after. The
   AsyncStorage and web dependencies were installed together in **one** install
   for this reason.
2. **`EXPO_PUBLIC_API_URL` must be a full `https://` URL at build time.** The
   bare-port form of §7 #32 resolves against Metro's host, which does not exist
   in a standalone APK or a Vercel build — it falls back to
   `http://localhost:8000`, i.e. the device itself, and silently drops to mocks.
   Android 9+ also refuses cleartext, so HTTPS is required, not preferred.

**Currently shipping with a placeholder** (`https://sahayak-backend.up.railway.app`)
because hosting is still being set up. That is only viable because of §7 #33 —
the URL can be corrected in Settings → Backend without a rebuild. Once hosting
is live, either set it there or rebuild with the real value for a clean artifact.

### 11.1 Prerequisite — backend on Railway

> ✅ **DONE 2026-07-28 — live at `https://sahayak-ucxp-sarvam-production.up.railway.app`**
> (Railway project `harmonious-tenderness`, service `sahayak-ucxp-sarvam`, volume at
> `/data`). Use this URL for `EXPO_PUBLIC_API_URL` in 11.2/11.3 and for the Twilio
> webhook. Variables are pushed with `./scripts/sync-railway-env.sh` — see below.

Both clients need one HTTPS origin. Nothing below works until this is live.
**Runtime and AI Engine deploy together in one image** (§6: the runtime imports
`SarvamOrchestrator` in-process — do not split them into two services).

#### Files — already in the repo, nothing to write

| File | Purpose |
|---|---|
| `Dockerfile` | `python:3.12-slim` + `tesseract-ocr` + `ffmpeg`; copies `ai_engine/`, `backend/`, `manifests/` |
| `railway.json` | Builder `DOCKERFILE`, healthcheck `/health` (120 s), restart on failure ×3 |
| `.dockerignore` | Keeps `frontend/`, `.venv/`, `.git/`, `.env` out of the image |
| `requirements.txt` | **Fixed 2026-07-28** — was missing every runtime dep (§7 #28) |

#### Two traps, both already handled — don't undo them

1. **`requirements.txt` used to declare only the AI Engine's deps.** `langgraph`,
   `twilio`, `pypdf`, `pytesseract` and `pillow` were installed in `.venv` but
   never declared, so a clean container died on `import langgraph` before serving
   a single request. Verify with an import cross-check after adding any import.
2. **`UCXP_PORT` must equal the port uvicorn binds.** `config.py:from_env()`
   derives `mock_base_url` and `connector_base_url` from `UCXP_PORT`, and the
   runtime calls its own mock and Shopify connector over loopback. Bind uvicorn
   to `$PORT` while `UCXP_PORT` still defaults to 8000 and **every capability
   fails at `act` with a connection refused, while the manifest looks blameless.**
   The `CMD` sets both from `$PORT` — leave it alone.

   Keep the self-call on loopback. Pointing `UCXP_CONNECTOR_BASE_URL` at the
   public URL also works but sends each action out to the internet and back.

#### Deploy

1. New Railway project → **Deploy from GitHub repo** → this repo, root directory.
   `railway.json` is picked up automatically; no build command to configure.
2. **Attach a volume** mounted at **`/data`**. The Dockerfile already sets
   `UCXP_STATE_FILE=/data/.ucxp_state.json`. Without the volume, conversation
   memory (§7 #23) resets on every redeploy and mid-flow refund confirmations die.
3. Set variables:

| Variable | Value | Needed for |
|---|---|---|
| `SARVAM_API_KEY` | your key | everything |
| `TWILIO_ACCOUNT_SID` | | WhatsApp — async replies (§7 #19) |
| `TWILIO_AUTH_TOKEN` | | WhatsApp |
| `UCXP_WHATSAPP_BUSINESS` | e.g. `ravi-electronics` | pins the number to one merchant (§7 #22) |
| `SHOPIFY_TOKEN_<STORE>` | per store | real Admin API; omit ⇒ deterministic mock |
| `UCXP_LOG_LEVEL` | `INFO` | |

Do **not** set `PORT`, `UCXP_PORT`, `UCXP_MOCK_BASE_URL` or
`UCXP_CONNECTOR_BASE_URL` — Railway injects `PORT` and the `CMD` derives the rest.
Setting them by hand is how trap 2 comes back.

4. Generate a public domain (Settings → Networking). HTTPS is automatic, which
   Android 9+ requires anyway (§7 #26).

#### Verify before moving on

```bash
BASE=https://<app>.up.railway.app

curl -s $BASE/health                       # engine + manifests loaded
curl -s $BASE/businesses                   # 5 merchants, read from manifests/
curl -s $BASE/manifests/ravi-electronics   # the file judges will ask to see

# The real test — exercises route → classify → gather → act → compose.
# A reply with a receipt proves the loopback self-call works (trap 2).
curl -s -X POST $BASE/chat -H 'content-type: application/json' \
     -d '{"text":"where is my order 1001"}'
```

If `/health` is green but `/chat` returns an action failure, it is trap 2 —
check the deploy logs for a refused connection to `127.0.0.1`.

#### Then repoint WhatsApp

Twilio console → sandbox webhook → `https://<app>.up.railway.app/whatsapp/webhook`.
Retire the Cloudflare tunnel from the demo checklist; it dies whenever the laptop
sleeps, which is the single most likely way the demo breaks on stage.

### 11.2 Android — a standalone APK (do this BEFORE 11.3)

**Why the current build only works over USB:** it is a *debug* build. Debug APKs
contain no JS bundle — they fetch it from Metro over `adb reverse`. Unplug and
there is nothing to load. A **release** build compiles the bundle into the APK.

`android/app/build.gradle` already has `release { signingConfig signingConfigs.debug }`,
so release signs itself with the debug keystore. **No keystore to generate.**

```bash
cd frontend

# 1. bake in the real backend — full https URL, NOT the bare port
echo 'EXPO_PUBLIC_API_URL=https://<app>.up.railway.app' > .env.local

# 2. node must be on PATH — the release build runs it to make the bundle.
#    (Debug builds don't, which is why this has never failed yet.)
#    Use a terminal where `node -v` works. NOT Android Studio's GUI.
node -v

# 3. build standalone
npx expo run:android --variant release
```

APK: `frontend/android/app/build/outputs/apk/release/app-release.apk`

Test it properly: **unplug the phone, kill the app, relaunch.** Then upload the
APK to GitHub Releases for a permanent link + QR.

Keep HTTPS. Android 9+ blocks cleartext by default, so an `http://<LAN-IP>` URL
is refused silently — Railway's HTTPS avoids this.

### 11.3 Web — Vercel (only after the APK exists)

```bash
cd frontend
npx expo install react-dom react-native-web     # ⚠️ npm install — APK must already be built
npx expo export -p web --output-dir dist
```

Deploy `frontend/dist` as a **static** site. Vercel project settings:

| Field | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npx expo export -p web --output-dir dist` |
| Output directory | `dist` |
| Env var | `EXPO_PUBLIC_API_URL=https://<app>.up.railway.app` |

Set the env var in Vercel too — it is inlined at build time there as well.

After this, re-verify the Android build still compiles. If the install disturbed
the patches, the already-built APK is unaffected — that is the whole point of the
ordering.

### 11.4 Known limitation — voice does not work on web

`useVoiceRecorder.ts:68` flags `web-unsupported` on `Platform.OS === "web"` and
falls back to a **simulated** recording. `expo-audio` does not capture mic on web.

So the two surfaces demo different things:

| Surface | Voice | Text chat | Receipts |
|---|---|---|---|
| **Android APK** | ✅ real Sarvam STT/TTS | ✅ | ✅ |
| **Web (Vercel)** | ⚠️ simulated | ✅ real, multilingual | ✅ |
| **WhatsApp** | ✅ real voice notes | ✅ | ✅ |

Don't demo voice from the browser. Web is the *clickable proof the protocol has
more than one client*; **Android and WhatsApp carry the voice story.** Making web
voice real means replacing the hook with `MediaRecorder` — a genuine change, not
a config flag, so treat it as post-demo work.

### 11.5 Demo checklist

Status as of 2026-07-28:

- [x] `Dockerfile`, `.dockerignore`, `railway.json`, `frontend/vercel.json` written
- [x] Backend honours `$PORT`; loopback self-calls follow it (§7 #35)
- [x] Release APK builds and **runs standalone** — installed, launched with Metro
      stopped, process alive, no `Unable to load script`
- [x] Web exports clean (10 MB SPA, backend URL inlined)
- [x] Backend URL changeable at runtime (Settings → Backend, with a Test button)
- [x] **Backend deployed** — `https://sahayak-ucxp-sarvam-production.up.railway.app`, healthy, capabilities execute (real connector data + receipt)
- [x] Placeholder replaced — APK and web both rebuilt with the live URL and re-verified
- [x] Web deployed — **https://sahayak-ochre.vercel.app** (public; the deployment-hash URL is SSO-protected, share the alias). CORS from that origin verified against the backend
- [ ] Twilio sandbox webhook repointed off the Cloudflare tunnel —
      **Console-only**: no REST API exposes the WhatsApp sandbox webhook
      (`IncomingPhoneNumbers` is empty on a trial account, `/Sandbox.json` 404s,
      no Messaging Services). Set it at Console → Messaging → Try it out → Send a
      WhatsApp message → **Sandbox settings**:
      `WHEN A MESSAGE COMES IN` = `https://sahayak-ucxp-sarvam-production.up.railway.app/whatsapp/webhook` (POST).
      Railway already holds the Twilio credentials — verified 2026-07-28, an
      inbound webhook POST triggered a real outbound send (failed only because
      the test `To` was a fake number, error 21212)
- [ ] APK uploaded to GitHub Releases for a permanent link + QR
- [ ] Pre-warm the backend before presenting — first request pays cold start
      on top of ~5 s reasoning
- [ ] `GET /manifests/<merchant>` open in a browser tab, ready to show

**Not verified:** the APK's UI was not seen rendering — the phone was locked
(`mWakefulness=Dozing`), so the screenshot was a dark display, not a dark app.
Unlock and open it to confirm visually.
