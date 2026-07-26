# UCXP — Complete Build Plan & Execution Guide (Claude Desktop)

> **How to use this file:** This is a hand-to-agent build plan. Open Claude Desktop
> (Claude Code / Cowork), point it at your `sarvam` project folder, paste a section at a
> time (or the whole file), and let it build. Every phase has explicit deliverables,
> wiring instructions, and test cases. **Do not skip the test cases** — they are how we
> guarantee nothing breaks on any screen.

---

## 0. Context the agent must load first

**Read these before writing any code:**
- `UCXP_Dashboard_Spec.md` — the dashboard spec + the `support.manifest` schema (Section 4).
  The schema is the contract; FE and backend both depend on it.
- The existing tested scripts in the project (already working — reuse, don't rewrite):
  - `sarvam_e2e.py` — full Sarvam pipeline (STT → 105B → translate → Bulbul), verified.
  - `fetch_all.py` — reads products/orders/status from all 5 real Shopify stores.
  - `stores.json` — the 5 real store subdomains + Admin tokens.
  - `manifests/*.json` — draft manifests (will be superseded by dashboard-generated ones).

**Hard constraints (already discovered — respect them):**
- Shopify **Basic plan blocks customer PII** (names/phone/email) via API. → identify
  customers by **order number**, never by name. Manifest carries `pii_available: false`,
  `identify_by: "order_number"`.
- The **raw Shopify token never goes into a manifest file.** Store it server-side; the
  manifest holds only `credential_ref`.
- Sarvam models: use `saaras:v3` (STT), `bulbul:v3` with a **valid speaker** (e.g.
  `kavitha`, `anushka` is NOT valid for v3), `sarvam-105b` or `sarvam-30b` (chat),
  `mayura:v1` / `sarvam-translate:v1` (translate). TTS needs **native script** input.
  Every Sarvam call must have `RequestOptions(timeout_in_seconds=60, max_retries=3)`.
- Environment: macOS, Python via `/opt/homebrew/bin/python3.13`, packages installed with
  that interpreter. **Terminal may be flaky** → prefer Claude Code's built-in run, or run
  everything through a single `make`/script so the user clicks once.

---

## 1. Target architecture (what we're building)

Three deployable pieces, one repo:

```
ucxp/
├── backend/           # FastAPI — the brain + API for dashboard & runtime
│   ├── main.py            # app entry, all routes
│   ├── sarvam_client.py   # wraps Sarvam calls (hardened, retries)
│   ├── shopify_client.py  # reads orders/products from a store
│   ├── manifest.py        # schema, validate, generate, load, store
│   ├── router.py          # detect business + intent from a message
│   ├── runtime.py         # the full answer pipeline (voice in -> voice out)
│   ├── vault.py           # server-side token store (keyed by business_id)
│   └── stores.json        # (existing) 5 real tokens — loaded by vault
├── frontend/          # dashboard (from Claude Design) — wizard + preview + playground
│   └── (React/HTML)
├── manifests/         # generated support.manifest files (no raw tokens)
├── static/            # web mic demo page (fallback channel)
└── run.sh             # one command to start everything (backend + ngrok)
```

**Two entry channels into the runtime:**
1. **WhatsApp** (Twilio → ngrok → `/whatsapp` webhook) — primary.
2. **Web mic page** (`/` static page → `/api/query`) — stage-safe fallback, no ngrok needed.

---

## 2. Phased build (each phase is independently testable)

### PHASE 1 — Backend core (no UI yet)

**Deliverables**
- `sarvam_client.py`: functions `stt(wav_bytes, lang)`, `chat(system, user, model)`,
  `translate(text, src, tgt)`, `tts(text, lang, speaker) -> wav_bytes`,
  `detect_language(text)`. All hardened with retries + timeout. Reuse the exact working
  call signatures from `sarvam_e2e.py`.
- `shopify_client.py`: `get_order(subdomain, token, order_name)`,
  `list_orders(subdomain, token)`, `get_products(subdomain, token)`. Order lookup by
  **name/number** (e.g. "#1001" or "1001"). Returns item titles, quantity, amount,
  currency, fulfillment status. NEVER requests customer fields.
- `vault.py`: loads `stores.json`; `get_token(business_id)` returns the token server-side.
  Maps business_id → subdomain + token. The rest of the app references business_id only.
- `manifest.py`: the schema (from Spec §4), `validate(manifest)`, `load(business_id)`,
  `save(manifest)`, `generate(form_data)`.

**Test cases (write as `tests/test_phase1.py`, must all pass)**
- T1.1 `get_order` returns a real order for each of the 5 stores (use a known order like
  "1001"). Asserts: item title present, status in known set, amount > 0, currency == "INR".
- T1.2 `get_order` with a non-existent order number returns a clean "not found", not a crash.
- T1.3 `shopify_client` never includes `customer`/PII fields (grep the query strings).
- T1.4 `sarvam_client.tts` returns non-empty wav bytes for a Telugu string.
- T1.5 `sarvam_client.stt` transcribes that generated wav back to ~matching Telugu.
- T1.6 `translate` round-trips a sentence te→en→te without error.
- T1.7 `detect_language` returns `te-IN` for a Telugu string.
- T1.8 `manifest.validate` rejects a manifest missing required fields; accepts a good one.
- T1.9 `vault.get_token` returns a token for each of the 5 business_ids; None for unknown.

**Definition of done:** all 9 tests green, run via one command.

---

### PHASE 2 — The runtime pipeline (the answer engine)

**Deliverables**
- `router.py`: `detect(message_text, manifests) -> {business_id, intent, order_number}`.
  Uses 105B with a strict prompt: given the customer text + the list of known businesses +
  capabilities, return JSON `{business_id, intent, order_number|null}`. Falls back
  gracefully if business isn't named (ask which business).
- `runtime.py`: `answer(business_id, intent, order_number, user_lang) -> {text, wav_bytes}`.
  Steps:
  1. load manifest(business_id)
  2. if intent == track_order and order_number: shopify_client.get_order → build a plain
     fact string ("Order 1001, boAt Airdopes, being prepared, Rs.1299")
  3. if intent in {return_policy, refund, warranty, faq}: pull the answer from the
     manifest's policies/faq (LLM phrases it)
  4. LLM (30b) rephrases the fact into ONE warm sentence (no reasoning dump — use the
     content-or-reasoning_content fallback + one-sentence cleanup from sarvam_e2e.py)
  5. translate to user_lang → Bulbul TTS → return text + wav
- `runtime.py` full entry: `handle(audio_bytes, channel) -> wav_bytes` chaining STT →
  detect_language → translate-to-en → router.detect → answer → return wav.

**Test cases (`tests/test_phase2.py`)**
- T2.1 Text query "where is Ravi Electronics order 1001" → router returns
  `{business_id: ravi-electronics, intent: track_order, order_number: 1001}`.
- T2.2 `runtime.answer(...)` for that returns a sentence containing the real item + status.
- T2.3 Telugu voice query (generate wav via tts) for order 1001 → `handle()` returns a wav;
  transcribing that wav back contains the item concept (sanity, not exact).
- T2.4 FAQ query "what is Ravi's return policy" → answer contains the manifest's return text.
- T2.5 Unknown business ("order 1001" with no business named) → runtime asks which business
  (does not crash, does not guess wrong).
- T2.6 Non-existent order ("Ravi order 9999") → runtime says not found, politely, in-language.
- T2.7 Every one of the 5 businesses answers a track_order query end-to-end (loop test).
- T2.8 Latency: each end-to-end answer completes under a set ceiling (e.g. 15s) or logs a warning.

**Definition of done:** all 8 tests green. This is the core product proven headless.

---

### PHASE 3 — API layer (dashboard + runtime endpoints)

**Deliverables (FastAPI routes in `main.py`)**
- `GET  /api/businesses` → list onboarded businesses (id, name, languages, capabilities, status).
- `POST /api/connect/shopify` {subdomain, token} → validate, store token in vault, return
  `{ok, product_count, order_count, currency, credential_ref}`. **Never echoes the token back.**
- `POST /api/generate-manifest` {form_data} → returns assembled + validated manifest JSON.
- `POST /api/scrape-faq` {url} → scrape + 105B draft FAQ/policies → return editable JSON.
  (Shadow-manifest generator. If scraping is flaky at demo, allow a pasted-HTML fallback.)
- `POST /api/activate` {manifest} → validate, save to `manifests/`, mark active.
- `POST /api/query` {business_id?, text?, audio_base64?} → run runtime, return
  `{text, audio_base64, detected: {business_id, intent, order_number}}`. Powers the playground.
- `POST /whatsapp` (Twilio webhook) → download media, run runtime, reply with voice note.

**Test cases (`tests/test_phase3.py` — use FastAPI TestClient)**
- T3.1 `GET /api/businesses` returns 5 businesses with correct ids.
- T3.2 `POST /api/connect/shopify` with a real store → ok:true, product_count>0,
  and the response body does NOT contain the token string.
- T3.3 `POST /api/connect/shopify` with a bad token → ok:false, clean error, 200 (not 500).
- T3.4 `POST /api/generate-manifest` with sample form → returns schema-valid manifest;
  `validate()` passes; no raw token present in the JSON.
- T3.5 `POST /api/activate` writes a file to `manifests/` and it re-loads via `manifest.load`.
- T3.6 `POST /api/query` {business_id: ravi, text: "order 1001"} → returns text + audio_base64,
  detected.intent == track_order.
- T3.7 `POST /api/query` with a Telugu `text` → answer text is in Telugu.
- T3.8 `/whatsapp` with a simulated Twilio payload (mock media) → returns valid TwiML/handled,
  no unhandled exception. (Mock the media fetch.)
- T3.9 Every endpoint returns proper HTTP codes and never leaks a stack trace to the client
  (global exception handler returns `{error: "..."}` with 200/4xx as appropriate).

**Definition of done:** all 9 tests green; server starts with `run.sh` and `/docs` loads.

---

### PHASE 4 — Frontend (Claude Design → wired to backend)

**Build the FE from `UCXP_Dashboard_Spec.md` §3 using Claude Design.** Then wire every
control to the Phase-3 endpoints. Screens: dashboard home, 6-step wizard, review/export,
playground.

**Wiring checklist (every interactive element must be connected — no dead buttons):**
- Home "Onboard my business" → opens wizard step 1.
- Home business cards → Edit (reopen wizard prefilled), Export (download manifest),
  Test (open playground for that business).
- Step 2 "Test connection" → `POST /api/connect/shopify` → shows ✅/❌ with counts.
- Live manifest preview (right pane) → updates on every field change (call
  `/api/generate-manifest` debounced, or assemble client-side from the same schema).
- Step 5 "Auto-generate from URL" → `POST /api/scrape-faq` → fills editable FAQ rows.
- Review "Download" → downloads the JSON. "Send to runtime" → `POST /api/activate`.
- Playground input (text + mic) → `POST /api/query` → shows detected intent, answer text,
  and a play button for the returned audio.

**Test cases (manual QA checklist + `tests/test_frontend.md` — every screen, no breaks)**
- F1 Every screen renders with no console errors (open devtools, check each route).
- F2 Wizard: forward/back navigation preserves entered data on all 6 steps.
- F3 Required-field validation blocks "Next" with a clear inline message (no silent fail).
- F4 Step 2: valid store → green success with real counts; invalid → red error, form stays.
- F5 Live preview matches the final downloaded manifest byte-for-byte (schema consistency).
- F6 Language checkboxes render native script (తెలుగు/हिंदी/தமிழ்) and map to correct codes.
- F7 Capability checkboxes: enabling a capability with no backing data source/FAQ shows a warning.
- F8 Review: Download produces a valid .json (re-import it, `validate()` passes).
- F9 Playground: a Telugu text query returns a Telugu answer + playable audio, on screen.
- F10 Playground: a track_order query shows detected {business, intent, order#} and the real answer.
- F11 Mobile/narrow width: wizard and preview stack without overlap or cut-off text.
- F12 Loading states: every async action (connect, generate, query) shows a spinner, never a frozen UI.
- F13 Error states: every failed request shows a friendly message, never a blank screen or raw JSON error.
- F14 No dead controls: click every button on every screen — each does something or is disabled with reason.

**Definition of done:** all F1–F14 pass; a full onboarding of "Ravi Electronics" works
end-to-end from home → export → playground answer, with zero console errors.

---

### PHASE 5 — Channels & end-to-end integration

**Deliverables**
- `static/index.html`: the web mic demo page — record via MediaRecorder, POST to
  `/api/query` with audio, play the returned audio. This is the **stage-safe fallback**.
- WhatsApp: wire `/whatsapp` to Twilio; `run.sh` starts backend + ngrok and prints the
  webhook URL to paste into the Twilio sandbox.
- `run.sh`: one command → starts FastAPI, starts ngrok, prints URLs, checks all env keys present.

**Test cases (`tests/test_e2e.md`)**
- E1 Web page: record a Telugu question about a real order → hear a Telugu answer. (Full loop, no ngrok.)
- E2 WhatsApp: send a Telugu voice note → receive a Telugu voice-note answer. (Requires
  re-joining Twilio sandbox: `join <code>`.)
- E3 Cross-business: in one session, ask about two different businesses → both answered correctly.
- E4 The three demo scripts from the pitch each run clean (track order / policy / cross-business).
- E5 Kill test: turn off wifi mid-demo → web page still loads its shell; cached audio (if any)
  still plays; app shows a clean "network" message, never a white screen.
- E6 `run.sh` on a fresh terminal brings everything up and prints a working webhook URL.

**Definition of done:** E1–E4 pass reliably 3 times in a row. E5/E6 verified once.

---

## 3. "Nothing breaks" — global hardening rules (apply everywhere)

The agent must implement all of these, and the test suite must check them:

1. **Global exception handler** in FastAPI → every unhandled error returns
   `{ "error": "<friendly message>" }` with an appropriate 4xx/200, never a 500 stack trace
   to the client. Log the real trace server-side.
2. **Every Sarvam/Shopify network call** wrapped with retries (3) + timeout (60s) + a safe
   fallback value. No call may raise up to the request handler.
3. **Every frontend fetch** wrapped in try/catch → sets an error state → renders a friendly
   inline message. Never leave a spinner spinning or a screen blank.
4. **Loading states** on every async action. **Disabled states** on buttons mid-request.
5. **Input validation** on every form field before submit; inline messages, not alerts.
6. **Null-safe data access** everywhere (use a `safe(dict, *keys)` helper like in
   `seed_orders.py`) — no `NoneType has no attribute` crashes.
7. **No secrets in client**: tokens/keys only server-side; manifests carry `credential_ref`.
8. **Idempotent + re-runnable**: activating the same business twice updates, not duplicates.
9. **Graceful degradation**: if scrape-faq fails → allow manual FAQ. If a store is
   unreachable → the business still onboards (FAQ-only mode). If TTS fails → return text.
10. **Every screen has an empty state and an error state**, not just the happy path.

---

## 4. Environment & secrets checklist (verify before building)

`.env` (backend reads these — never commit):
```
SARVAM_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```
`stores.json` (5 real tokens — server-side only, in vault):
```
{ "meena-kitchen-store": "shpat_...", "lakshmi-fashion-4kmotaah": "shpat_...",
  "ravi-electronics-bmxitv46": "shpat_...", "sri-pharma": "shpat_...",
  "anna-groceries": "shpat_..." }
```
Pre-flight test (`tests/test_env.py`):
- All env vars present and non-empty.
- `stores.json` has 5 entries; each token starts with `shpat_`.
- One live Sarvam TTS call succeeds.
- One live Shopify order fetch succeeds for one store.

---

## 5. Recommended execution on Claude Desktop (since terminal is flaky)

**Use Claude Code inside Claude Desktop** pointed at the `sarvam` folder. Work phase by phase:

1. Paste **Phase 1** → let it write `backend/` core + `tests/test_phase1.py` → have it run
   the tests via its own execution (not your terminal) → fix until 9/9 green.
2. Repeat for **Phase 2**, **Phase 3** — each ends with its test suite green.
3. **Phase 4**: use **Claude Design** with the prompt in §6 below to generate the FE, then
   have Claude Code wire it to the endpoints and walk the F1–F14 checklist.
4. **Phase 5**: web page + WhatsApp + `run.sh`; run E1–E4.
5. Final: run the **full test suite** (`tests/`) in one go; all green = ship-ready.

**Rule for the agent:** never advance to the next phase until the current phase's tests are
all green. Report the test results after each phase.

---

## 6. Claude Design prompt (for the frontend — paste into Claude Design)

> Build a clean, trustworthy B2B onboarding dashboard called **UCXP** (Unified Customer
> Experience Protocol). It lets a merchant describe their customer support and export a
> `support.manifest` JSON. Aesthetic: infrastructure-grade like Stripe/Plaid — calm,
> lots of white space, one primary color (deep indigo or teal), mono font for JSON.
>
> **Screens:**
> 1. **Home** — headline "Serve every customer in their language", a big "Onboard my
>    business" button, and cards for already-onboarded businesses (name, language chips in
>    native script, capability chips, status Draft/Active; each card has Edit / Export /
>    Test).
> 2. **6-step wizard** with a progress bar. Left = form, right = a **live JSON preview** of
>    the manifest updating as fields change. Steps: (1) Business basics; (2) Connect data
>    source — Shopify / Custom API / FAQ-only, with a "Test connection" button showing
>    ✅ counts or ❌ error; (3) Capabilities checkboxes; (4) Languages checkboxes shown in
>    native script (తెలుగు, हिंदी, தமிழ்); (5) Knowledge — FAQ rows + policies, plus an
>    "Auto-generate from help URL" option; (6) Escalation & SLA pre-filled with Indian
>    defaults (48h ack, 30-day resolution, National Consumer Helpline 1915).
> 3. **Review & Export** — full summary left, live manifest JSON right, buttons Download /
>    Copy / Send to runtime / Open in playground.
> 4. **Playground** — a text box + mic button; shows detected intent + business + order#,
>    the answer text, and a play button for returned audio.
>
> Every async action has a loading spinner and a friendly error state. Near the Shopify
> connect field show a lock icon + "We never store customer personal data — we only read
> orders and products." Make the JSON manifest preview the visual hero. Mobile-responsive:
> form and preview stack on narrow screens. No dead buttons; disabled states have tooltips.

---

## 7. Final acceptance (the whole thing works, nothing breaks)

Ship only when ALL of these are true:
- [ ] `tests/test_env.py` green (secrets + live connectivity).
- [ ] Phase 1–3 test suites green (backend + runtime + API).
- [ ] F1–F14 frontend checklist all pass (every screen, no console errors, no dead controls).
- [ ] E1–E4 end-to-end pass 3× in a row (web mic + WhatsApp + cross-business).
- [ ] Onboard "Ravi Electronics" live: home → wizard → export manifest → playground answers
      a Telugu order query from the real store — zero errors.
- [ ] Global exception handler verified: no raw stack trace ever reaches a client/screen.
- [ ] No secret ever appears in a manifest file or a client response.
- [ ] `run.sh` brings the whole system up with one command and prints the webhook URL.

When every box is checked, the dashboard + runtime are wired, hardened, and demo-ready.
