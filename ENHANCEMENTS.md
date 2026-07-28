# Sahayak / UCXP — enhancements, with worked examples

Grounded in a full read of `origin/main`, `origin/dashboard-restructure`,
`origin/feat/samvaad-voice-agent-tools`, the Sarvam OpenAPI/AsyncAPI specs, and the
logged-in Sarvam console (28 Jul 2026).

**Correction to the earlier draft of this file:** it was written against
`dashboard-restructure` alone and claimed "the manifest has no consumer". That is false.
`origin/main` has a complete consumer — `ai_engine/` (the only thing that talks to Sarvam) and
`backend/app/runtime/` (a LangGraph protocol brain), plus a Twilio WhatsApp channel, a Shopify
connector, and an Expo customer app. Everything below is re-anchored to that reality.

Running example throughout: **Ravi Electronics**, order **1001**, boAt Airdopes 141, ₹1,299,
customer speaking **Telugu**.

---

## Part 0 — Three defects that will bite you in a demo

These are not features. Fix them first; each is small and each one currently breaks a path you
will want to show.

### 0.1 A malformed manifest crashes backend startup

`manifests/anna-gorceris.json` (note the typo — `gorceris`, not `groceries`) is an old
pre-dashboard artifact whose `capabilities` are bare strings:

```json
{ "business": "Anna Groceries", "capabilities": ["track_order", "reorder"] }
```

`normalize.py:133` does `c.get("name", "")` on each capability. On a `str` that raises
`AttributeError`, and `loader.py:47-54` catches only `OSError`, `JSONDecodeError` and
`ValidationError` — so it propagates through `ManifestRegistry.__init__` → `get_registry()` →
`get_runtime()` and **the backend does not start**.

Two-line fix: delete the file, *and* widen the loader's `except` so one bad merchant can never
take down every other merchant. The second half matters more than the first — the dashboard
writes into this directory, so a merchant can create this situation at any time.

### 0.2 Every activation writes a file the runtime rejects

The dashboard writes **two** files per activation into the same `manifests/` directory
(`Dashboard/backend/main.py:247-252`): `<id>.json` and `<id>.protocol.json`.

`loader.py:40` globs `manifests/*.json`, which matches both. The protocol file fails
`is_published_shape()` (its `business` is a dict, and there's no top-level `business_id`), so
normalisation is skipped and it goes straight to `Manifest.model_validate()` — which fails with
five errors every time:

```
capabilities.0.id      Field required          → protocol uses `name`, no `id`
capabilities.0.action  Should be a valid string → protocol has {"api_mapping": "track_order_call"}
knowledge              Should be a valid list   → protocol has {faqs:[…], policies:[…]}
```

It's logged as `manifests.invalid` and skipped. Nothing breaks *today* only because sorted glob
order puts `ravi-electronics.json` before `ravi-electronics.protocol.json`, so the good file
wins. That is luck, not design.

**Decide which file is canonical.** My recommendation: the **flat `<id>.json`**, because it
already works end to end and the protocol file has no reader anywhere in the project. Then
either write protocol exports to `manifests/protocol/`, or exclude `*.protocol.json` from the
glob. (If you'd rather make the protocol file canonical, the full field-by-field adapter it
needs is in §5.)

### 0.3 `/agent/execute` returns an empty `say` for every real merchant

On the samvaad branch, `execute.py:142` is:

```python
say = render(cap.response, scope) if cap.response else ""
```

But `normalize.py:172` sets `"response": ""` for **every** capability of **every** published
manifest — the dashboard doesn't emit a reply template.

So the fast path works perfectly and then says nothing:

```json
POST /agent/execute {"business":"ravi-electronics","capability":"track_order","inputs":{"order_id":"1001"}}
→ { "receipt": {"label":"shipped","tone":"success"}, "say": "" }
```

The voice agent has nothing to speak. The tests don't catch it because
`test_agent_tools.py:216` hand-writes a `response` template that real manifests never have.

Fix: give published capabilities a response template — see §1.1, which turns this defect into
one of the better features in the product.

---

## Part 1 — Enhancements, each with a worked example

### 1.1 Per-capability reply templates, authored in the dashboard

**What it does.** Adds a "What should the assistant say?" field to each capability in Section 3,
with `@`-insertion of fields from the response example. Fills the `response` that
`normalize.py` currently blanks.

**Worked example.** Merchant types, in the Track Order contract:

```
Your order {{items}} is {{status}} and should reach you by {{eta}}.
```

Customer asks in Telugu: *"నా ఆర్డర్ 1001 ఎక్కడ ఉంది?"*

| Today | With this |
|---|---|
| runtime finds no template → spends a full `sarvam-105b` call to compose (**~4.7 s**, per your own README timing table) | template renders instantly, LLM skipped |
| `/agent/execute` returns `say: ""` | returns the rendered sentence |
| wording varies run to run | wording is deterministic and the merchant approved it |

**Why it helps you.** It removes ~4.7 s from the dominant stage of a 6.8 s voice round trip on
every *successful* turn, it makes replies auditable ("the merchant wrote this, not the model"),
and it fixes defect 0.3. Compose still falls back to the LLM for smalltalk, errors and
escalations — where you actually want it.

**Where it plugs in.** New field in the contract editor → `assemble()` →
`normalize.py:172` reads it instead of forcing `""`.

---

### 1.2 Pre-translate the reply templates into every selected language

**What it does.** At activation, translate each template into the merchant's selected languages
and store all of them. Runtime picks by detected language instead of translating live.

**Worked example.** The template above, at activation, becomes:

```jsonc
"response": {
  "en-IN": "Your order {{items}} is {{status}} and should reach you by {{eta}}.",
  "te-IN": "మీ ఆర్డర్ {{items}} {{status}} మరియు {{eta}} నాటికి మీకు చేరుతుంది.",
  "hi-IN": "आपका ऑर्डर {{items}} {{status}} है और {{eta}} तक पहुँच जाएगा।"
}
```

Use `mayura:v1` with `mode: "modern-colloquial"` — formal register reads wrong in support chat.
Show the merchant a review table with a per-language "looks right" checkbox.

**Why it helps you.** Your `localize` node (`graph.py:539`) currently translates every reply on
every turn — that's ~230-360 ms per turn from your own measurements, on text the merchant has
never seen. Pre-translating removes that call from the hot path, makes Telugu output reviewable
before launch, and costs about ₹2 for a whole merchant at ₹20/10K chars. You have ₹5,094 in
credits.

---

### 1.3 Make the Test tab actually run — and steal Sarvam's cURL trick

**What it does.** Today `ContractEditor`'s Test tab renders a read-only cURL string the merchant
cannot execute, with no field to supply a token. Replace it with real execution, and add
**inbound** cURL parsing.

**Worked example — outbound (run it).**

```
[ Run test call ]  →  200 OK · 340 ms
{ "displayFulfillmentStatus": "FULFILLED",
  "totalPriceSet": { "shopMoney": { "amount": "1299.00", "currencyCode": "INR" } } }

Suggested field mappings:        [✓ accept all]
  status   → $.displayFulfillmentStatus
  amount   → $.totalPriceSet.shopMoney.amount
  currency → $.totalPriceSet.shopMoney.currencyCode
```

**Worked example — inbound (paste it).** Sarvam's own Samvaad tool builder does this and it's
better than what UCXP has. The merchant pastes:

```bash
curl -X GET https://api.ravielectronics.in/orders/1001 \
  -H 'X-API-Key: abc123'
```

…and the endpoint, method, path params and headers fill themselves in, with the key swapped for
`{{credential_ref}}` automatically.

**Also steal: "Mock with echo API."** Samvaad has a toggle that prefills a public echo endpoint
so you can build and test a tool with no backend at all. You already have `backend/app/mock/router.py` —
wire it to that toggle and a merchant with no API can complete onboarding and see a working demo.

**Why it helps you.** Section 3 is the hardest screen in the product and the one a non-technical
merchant cannot finish. Every JSONPath the merchant doesn't hand-write is a contract that
doesn't silently break in production.

---

### 1.4 Import contracts and knowledge instead of typing them

**What it does.** Three importers, replacing the fake one.

`POST /api/scrape-faq` currently returns **three hardcoded Meenakshi-Silks FAQs regardless of
the URL** (`main.py:356-379`) while the UI presents it as real.

| Merchant has | Pipeline | Result |
|---|---|---|
| OpenAPI / Postman file | deterministic parse, no LLM | contracts pre-filled |
| A help-page URL | fetch → `sarvam-105b` + `response_format: json_schema` | draft FAQs |
| **A printed returns policy PDF** | Doc Intelligence → the four Section-5 policy fields | policies filled |
| **Past WhatsApp/email support threads** | cluster → LLM | the top 15 FAQs customers *actually* ask |

**Worked example.** Ravi uploads `returns-policy.pdf` — two pages, Telugu and English mixed.
Doc Intelligence returns markdown at 87.7% Telugu word accuracy; the extractor routes the
sections into `policies.return`, `policies.refund`, `policies.shipping`, `policies.warranty`.
Cost: **₹1.00**. Merchant time saved: ~30 minutes of retyping.

**Watch the rate limit:** Doc Intelligence is **10 rpm on every plan including Enterprise**.
Queue it; never call it inline in a request handler.

---

### 1.5 Voice & Persona — the section that doesn't exist yet

**What it does.** There is no voice concept anywhere in the dashboard, yet `tts.py:81-91` hard-codes
`speaker="anushka"` on `bulbul:v2` for every merchant in the country.

New section: voice per language, pace, temperature, and a **pronunciation dictionary**.

**Worked example — the pronunciation problem, concretely.** Bulbul says "boAt Airdopes 141" as
*"bo-at air-dopes one hundred forty-one"*. The merchant records the correct pronunciation once:

```json
{ "boAt": "bote", "Airdopes": "air-dops", "Ravi Electronics": "రవి ఎలక్ట్రానిక్స్" }
```

Sarvam has a full CRUD dictionary API for this (10 dicts, 100 words, `bulbul:v3` only).

**Also: you're two model versions behind.** `tts.py` uses `bulbul:v2` with `anushka`.
`bulbul:v3` has **37 voices** with published per-language recommendations — Telugu male
`shubh`/`ratan`, Telugu female `neha`/`priya` — plus temperature control and dictionary support.
`anushka` is a **v2-only** speaker and is not valid on v3, so this is a coordinated change, not
a one-line bump.

**Why it helps you.** Every merchant currently sounds like the same woman. Brand voice is a real
purchase decision, and mispronounced product names are the single most noticeable quality defect
in a voice demo.

---

### 1.6 Simulator: talk to it before you activate

**What it does.** A merchant fills seven sections and clicks Activate having never heard the
assistant say anything. Add `/business/:id/simulate` — chat + mic on the left, live trace on the
right.

**Worked example.** Trace pane for one Telugu turn:

```
🎙  "నా ఆర్డర్ 1001 ఎక్కడ ఉంది?"
 ├─ detect      te-IN                                    18 ms
 ├─ translate   "Where is my order 1001?"               227 ms
 ├─ route       ravi-electronics  (alias match)           2 ms
 ├─ classify    track_order  conf 0.91                   —  (template hit, LLM skipped)
 ├─ act         GET /connectors/shopify/…/orders/1001   340 ms   200
 ├─ compose     template                                  1 ms
 └─ localize    te-IN                                   356 ms
🔊 "మీ ఆర్డర్ boAt Airdopes 141 పంపబడింది…"                total 944 ms
```

**Why it helps you.** It is your best demo asset and your best debugging tool, and ~80% of it
already exists — `graph.py` already emits per-node `latency` via the accumulating reducer in
`state.py:10-21`. You're mostly building a view over data the runtime already produces.

---

### 1.7 Language tiers, honestly — 13 → 23

**What it does.** Section 4 offers 13 languages as one flat list. The real matrix is tiered, and
the current UI lets a merchant promise something the stack cannot deliver.

| Tier | Count | Reach |
|---|---|---|
| Understood + answered in text | **23** | all 22 Eighth-Schedule + English (`saaras:v3` + `sarvam-translate:v1`) |
| Spoken aloud | **11** | `bulbul:v3` |
| Native LLM reasoning | **11** | `sarvam-105b` |

**Worked example.** Merchant ticks Santali. UI shows: *"Text only — Santali isn't available for
voice replies yet."* Manifest records it in `languages` but not in the voice set, so the runtime
answers Santali chat and hands off Santali calls instead of failing mid-call.

Also: **you're on the deprecated STT model.** `speech.py` defaults to `saarika:v2.5` (12
languages). `saaras:v3` covers **23** and adds five modes — `transcribe`, `translate`,
`verbatim`, `translit`, `codemix`. The `translate` mode alone collapses two of your pipeline
stages into one.

**Why it helps you.** Ten additional languages is ten new markets for the merchant at zero extra
merchant effort, and it's the most direct expression of "AI for all from India" — which is
literally the tagline in your app header.

---

### 1.8 Close the credential loop

**What it does.** Right now `credential_ref: "vault://ravi-electronics"` means **two unrelated
things** on the two branches:

| | Dashboard | Runtime |
|---|---|---|
| Where the token lives | SQLite `vault` table keyed by `business_id` (`vault.py:36`) | env var `SHOPIFY_TOKEN_RAVI_ELECTRONICS` (`connectors/shopify.py:41-51`) |

So a merchant can complete onboarding, activate, and the runtime still can't call their store —
it looks for an environment variable nobody set.

**Worked example of the fix.** Runtime resolves `vault://<id>` by reading the dashboard's vault
(or the dashboard emits the env var name it expects). Either way the string becomes meaningful.

Two related fixes while you're there: the dashboard's **Disconnect** button toasts *"credentials
removed from vault"* and calls no delete endpoint (`S2:72-83` — the row survives), and the
**"send secure credential link"** button is an 800 ms `setTimeout` with no email and no endpoint.

---

### 1.9 Sync the capability vocabulary with what the connector implements

**What it does.** The dashboard offers seven capabilities. `connectors/shopify.py` implements
**two** — `GET /{business_id}/orders/{order_id}` and `POST /{business_id}/orders/{order_id}/refund`.

**Worked example of the bug.** Merchant enables `cancel_order` in Section 3 — the UI happily
accepts it, activation succeeds, the manifest validates. Customer calls to cancel. Runtime
issues the call and gets a **404**. (The mock router has a cancel route at `mock/router.py:220`,
but without the `{business_id}` segment `normalize.py` generates, so it won't match either.)

**Fix, in order of effort:** grey out unimplemented capabilities for Shopify merchants with
"coming soon"; or implement `cancel_order` and `reorder` in the connector; or let the capability
list be data rather than the hardcoded `CAPABILITY_KEYS` in `constants.py:142`.

---

### 1.10 An execution ledger — steal Acta

**What it does.** Log every turn as a replayable trace with one correlation ID: input, detected
language, route decision, classify confidence, the exact HTTP call, the rule evaluations, the
rendered reply, per-stage latency.

Sarvam Arya's ledger is called **Acta**, and its useful property is *replay with a modified
manifest*.

**Worked example.** A customer complains the bot refused a valid refund. You open the trace,
see `rule: refund_window deny → "delivered more than 7 days ago"` firing on
`days_since_delivery = 8`, change the policy to 10 days in the dashboard, and **replay the same
conversation** against the new manifest to confirm it now passes — without calling the customer
back.

**Why it helps you.** It's simultaneously your debugging story, the merchant analytics in §1.11,
and the eval substrate in §1.12. Build it *with* the runtime; retrofitting an audit log later is
much harder. `state.py` already accumulates most of what you'd log.

---

### 1.11 Merchant analytics that feed back into the knowledge base

**What it does.** `routes/Dashboard.jsx` is four static tiles. Sarvam's own Agent Analytics has
Overview / Connectivity / Engagement / **Tools** / Goals / Call Logs — per-tool call volume and
failure rate. Copy that shape.

**Worked example — the loop that matters.**

```
Unanswered this week (14)
  "Do you deliver to Warangal?"        ×6   [+ Add as FAQ]
  "Is there EMI on this?"              ×5   [+ Add as FAQ]
  "Do you have a physical store?"      ×3   [+ Add as FAQ]
```

One click writes the FAQ, one click drafts the answer with `sarvam-105b`, one click translates
it into all 13 languages (§1.2). The merchant's knowledge base improves from real customer
questions instead of guesswork.

---

### 1.12 Pre-activation evals

**What it does.** Activation currently gates on six structural checks — all of them "is this
field non-empty" (`manifest.py:261-286`). Add a behavioural gate.

Sarvam's Samvaad already ships this: *"Write a test case or let AI generate a suite — then run
and see what passed."*

**Worked example.**

```
Generated suite for Ravi Electronics — 12 cases          10 ✅  2 ❌

✅ te-IN  "నా ఆర్డర్ 1001 ఎక్కడ ఉంది?"      → track_order(1001)     0.91
✅ hi-IN  "ऑर्डर कैंसिल करना है"            → escalate (not implemented)
❌ en-IN  "I want a refund for 1001"        → classify conf 0.31 < 0.35 → smalltalk
❌ te-IN  "వారంటీ ఎన్ని రోజులు?"            → no knowledge match
```

That first failure is a real, findable bug: `min_capability_confidence` is 0.35
(`config.py:45`) and a plainly-worded refund request landed under it. You would not find that
by reading code.

---

## Part 2 — MCP and agents

### 2.1 Manifest → MCP server

**The key structural fact:** `to_protocol()` already splits semantic `capabilities[]` (name +
description + JSON-Schema `parameters`) from HTTP `api_mappings{}`. **That is exactly MCP's
client/server boundary.** You built it for a different reason and landed on the right shape.

```
protocol.json                        MCP
capabilities[].name               →  tools[].name
capabilities[].description        →  tools[].description
capabilities[].parameters         →  tools[].inputSchema   (already JSON Schema)
api_mappings[…]                   →  never leaves the server ✓ (already correct)
knowledge.faqs / policies         →  resources/  ucxp://<biz>/faq/<id>
escalation_rules[]                →  tools[].escalate_to_human
```

**Worked example.** A customer runs Claude Desktop with:

```json
{ "mcpServers": { "ravi": { "command": "uvx",
    "args": ["ucxp-mcp", "--business", "ravi-electronics"] } } }
```

They ask *"where's my order 1001?"* Claude calls `track_order({order_id: "1001"})`. Your server
resolves `api_mappings.track_order_call`, substitutes the vaulted credential, executes, renders
the template. **The model never sees the URL or the token.**

**Add a `destructive` flag.** `to_protocol` hardcodes
`defaults.confirmation_required_for_destructive: true` (`manifest.py:685`) but nothing is ever
*marked* destructive. `refund`, `cancel_order` and `exchange` obviously are. Map it to MCP tool
annotations (`readOnlyHint` / `destructiveHint`) plus a server-side confirm gate — you already
have the confirm machinery in `graph.py` and `execute.py:100-109`.

**Why this is the strategic one.** It reframes UCXP from "get a support manifest" to
**"point us at your API, get an MCP server."** And `to_protocol()` is a pure dict→dict function
with no I/O — `to_mcp()` sits beside it and needs one extra `json.dump` in `activate()`.

### 2.2 Samvaad can't consume MCP — which makes your branch more valuable, not less

I checked the live console: Samvaad's `Add tool` offers exactly **HTTP · Data Validator ·
Data Verifier**. There is no MCP option. Sarvam's own agent platform cannot consume MCP servers.

So your `feat/samvaad-voice-agent-tools` branch is the right call — HTTP is the only door in —
and MCP is genuinely additive rather than duplicated work.

Three concrete improvements to that branch beyond defect 0.3:

- **`/agent/execute` never persists.** It mutates `conversation.pending_*` and `facts` but never
  calls `store.save()` (contrast `graph.py:598`). A restart mid-confirmation loses the state.
- **The confirm gate is advisory.** `execute.py:100-109` returns `"awaiting_confirmation": True`
  but never sets `conversation.awaiting_confirmation`, so nothing server-side stops a caller
  sending `confirmed=true` without a real confirmation ever having happened. For a **refund**
  tool, that's the gate that matters.
- **`/tool-spec` and `/execute-spec` are unauthenticated** while `/resolve` and `/execute` are
  behind `UCXP_AGENT_TOOL_TOKEN`. Those two specs enumerate every business and capability you
  have.

### 2.3 Workflows — a refund is not one API call

`docs/02-manifest-spec.md:362-389` defines `policy_check`, `confirm`, `branch` and `escalate`
steps. `to_protocol()` only ever emits `action.api_mapping` (`manifest.py:649`). Half-built.

**Worked example.**

```
refund_workflow
  1. policy_check  within return window?      ← reads policies.return_policy
  2. api_call      track_order → delivery date
  3. branch        eligible ? 4 : 6
  4. confirm       "I can refund ₹1,299 to your original payment method. Confirm?"
  5. api_call      refund
  6. escalate      rung 2 · grievance officer
```

Arya's insight is worth copying wholesale: **a task graph exposes itself as a tool.** The whole
six-step thing becomes one MCP tool named `refund` — the caller sees one function signature.
That's what lets a buyer's shopping agent talk to a merchant's support agent.

You already have the primitives: `graph.py` sequences, `renderer.evaluate_condition()` is a
sandboxed AST evaluator for `policy_check`, and the confirm gate exists.

---

## Part 3 — Sequencing

**Wave 1 — make the demo unbreakable (hours, not days)**
1. Delete `anna-gorceris.json`; widen `loader.py`'s `except` (0.1)
2. Stop `.protocol.json` landing in the loader's glob (0.2)
3. Response templates → fixes empty `say`, removes ~4.7 s from every successful turn (0.3 / 1.1)
4. Credential loop: `vault://` must mean one thing (1.8)
5. Grey out the five capabilities Shopify can't serve (1.9)

**Wave 2 — the merchant stops doing manual work**
6. Test tab that runs + cURL paste + echo-mock (1.3)
7. Real FAQ/policy import (1.4)
8. Simulator (1.6)
9. Pre-translated templates (1.2)

**Wave 3 — quality and reach**
10. Voice & Persona + pronunciation dictionary, `bulbul:v2` → `v3` (1.5)
11. `saarika:v2.5` → `saaras:v3`, 13 → 23 languages (1.7)
12. Ledger (1.10), analytics loop (1.11), evals (1.12)

**Wave 4 — protocol**
13. `to_mcp()` + `ucxp-mcp` + `destructive` flag (2.1)
14. Harden the samvaad branch: persist, enforce confirm, auth the specs (2.2)
15. Workflows as single tools (2.3)

---

## Appendix — model versions currently behind

| Where | Using | Current | Note |
|---|---|---|---|
| `speech.py` | `saarika:v2.5` | **`saaras:v3`** | 12 → 23 languages, 5 modes |
| `speech.py` | `/speech-to-text-translate` + `saaras:v2.5` | `saaras:v3` `mode="translate"` | endpoint is legacy |
| `tts.py` | `bulbul:v2`, `speaker="anushka"` | **`bulbul:v3`** | 37 voices; `anushka` is v2-only — coordinated change |
| `llm.py` | `sarvam-105b` | ✅ current | |
| `translation.py` | `sarvam-translate:v1` | ✅ current | consider `mayura:v1` `modern-colloquial` for support tone |
| docstrings | `sarvam-m` | deprecated Jun 2026 | stale text only, `llm.py:3`, `orchestrator.py:351`, `README.md:194` |

**Gotchas to encode centrally:** bad key returns **403, not 401**; retry only **429/500/503**
(`insufficient_quota_error` is a 429 but is *not* retryable); reasoning tokens bill as output;
Odia is **`od-IN`** not `or-IN`; STT WebSocket uses `language-code` (hyphen) while REST uses
`language_code` (underscore); Doc Intelligence is **10 rpm on all plans**.

`SARVAM_REQUEST_TIMEOUT` is 30 s in `config.py:84` and `.env.example:13`, but `PLAN.md:679`
records a decision to raise it to 90 s. The code change was never made.
