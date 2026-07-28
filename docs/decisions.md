# Engineering decisions

[`PLAN.md`](../PLAN.md) §7 is the append-only decision log — 50 rows, written as
they happened, never rewritten, because the interesting question about any of
them is "why".

This document is the same material reorganised for reading: grouped by theme,
each as **context → decision → trade-off**. The log is chronological and
authoritative; this is thematic and explanatory. Where they disagree, the log
wins.

**Related:** [architecture](./architecture.md) ·
[request lifecycle](./request-lifecycle.md) ·
[manifest spec](./manifest-spec.md) · [channels](./channels.md) ·
[operations](./operations.md)

> **Note on the log's numbering.** [`PLAN.md`](../PLAN.md) §7 has three duplicate
> ids: **#35** appears twice (Railway env sync, and loopback `$PORT`
> resolution), as do **#42** (WhatsApp documents; self-hosted voice pipeline)
> and **#43** (the `android-patches.sh` script; managed Samvaad superseding the
> self-hosted pipeline). The log is append-only by policy, so this is recorded
> here rather than silently renumbered. Cross-references in these docs cite the
> id **and** the subject to stay unambiguous. Renumbering the later collisions
> as 51–53, with an appended note, would fix it without rewriting history.

---

## 1. Runtime design

### 1.1 A protocol, not a chatbot

**Context.** Every company builds its own AI support stack. That does not
compose: the second company needs a second bot.

**Decision.** Define UCXP — a JSON document in which a business declares its
capabilities, inputs, rules, endpoints and receipts — and build a runtime that
reads it at request time and contains no business-specific code.

**Trade-off.** A manifest is a harder thing to write than a prompt, and it can
only express what the schema anticipates. In exchange, adding a business is a
data change, and the same claim is verifiable by `grep` rather than asserted.
([`PLAN.md`](../PLAN.md) §1, §2.)

### 1.2 LangGraph as a state machine, not an agent framework

**Context.** The turn looks linear until you write it down. Three nodes can end
it early, each persisting different state first.

**Decision.** Build the runtime on LangGraph, used purely for control flow. LLM
calls leave through `SarvamOrchestrator`, so LangChain never sees a Sarvam
credential.

**Trade-off.** A dependency and a typed state dict for a seven-node graph. Paid
for by the conditional edges *being* the specification, and by the node that
causes a transition being the node that writes state for it.
(#15 · [request-lifecycle §1](./request-lifecycle.md#1-why-a-graph-at-all).)

### 1.3 Structured JSON, not tool-calling

**Context.** The classifier has to pick a capability from a manifest-derived
candidate list.

**Decision.** Ask for strict JSON — `{capability_id, inputs, confidence}` — and
validate it against the manifest before acting. Tolerate what reasoning models
actually emit: fenced blocks, preamble, embedded braces.

**Trade-off.** More parsing than a tool-call API would need. In exchange the
contract is explicit, the validation point is guaranteed, and it works
identically against any model. Crucially, the model's echoed `business_id` is
**ignored** — the router owns that decision, so no model output can move a
customer to a store they did not ask for.
([`PLAN.md`](../PLAN.md) §5.)

### 1.4 Rules evaluated over an AST allow-list

**Context.** Manifests are third-party data containing expressions
(`result.days_since_delivery > 7`) that must be evaluated.

**Decision.** Parse with `ast.parse(mode="eval")` and walk against an allow-list
of node types. No `eval`, no builtins, no calls.

**Trade-off.** The grammar is limited to comparisons, boolean and arithmetic
operators, literals, names and attribute access. That is the point. Unit-tested
that `__import__('os').system(…)` raises rather than executes.

### 1.5 A missing template key is a loud failure

**Context.** One renderer serves URLs, request bodies, response sentences and
receipts.

**Decision.** `render()` raises `RenderError` when a placeholder cannot be
resolved.

**Trade-off.** More failure paths for callers to handle — and each handles it
differently: `compose` falls through to the LLM, `_receipt` drops the card,
`executor` refuses to issue a half-rendered URL. Worth it, because a blank in a
demo is worse than a visible error.
([`PLAN.md`](../PLAN.md) §5.)

### 1.6 SQLite-or-simpler, and manifests as files

**Context.** The demo needs persistence but not a database team.

**Decision.** Local JSON manifests and a single-file conversation snapshot. No
Postgres, Mongo or Firebase in the runtime. Supabase was added later, for
published manifests and durable history, not for live turn state.

**Trade-off.** Single-node, and the whole store is rewritten each turn. Manifests
*as files* is also the protocol story made tangible — you can read one.
(#9, #23.)

---

## 2. Latency

The reasoning model dominates everything. `sarvam-105b` thinks before answering
and the thinking is billed against `max_tokens`; a voice round trip is ~6.8 s and
a text turn ~2.1 s at best. Every decision here is about not paying for it more
than once.

### 2.1 Gate the prompts — 58 s → ~10 s

**Context.** The first working runtime called the model three times per turn:
classify, prepare inputs, compose the reply. One turn took **58 seconds**.

**Decision.** Gate prompts 2 and 3. Prompt 2 runs only when a slot is missing
*and* a cheap regex says the message plausibly contains an identifier, date or
amount. Prompt 3 runs only when no manifest template renders.

**Trade-off.** Template-driven replies are less warm than model-written ones. For
a completed job — an ETA, a refund reference — determinism is the feature, not a
compromise. `UCXP_COMPOSE_WITH_LLM=always` restores the old behaviour for
comparison. (#16.)

### 2.2 Synthesise response templates from the manifest's own declared shape

**Context.** Published manifests describe an API *response shape*
(`{example, mapping}`), not a sentence. So `capability.response` was empty for
every merchant and §2.1's gate fell through on **every** turn: greeting 52 s,
order lookup 44 s.

**Decision.** Build a sentence from the fields the manifest already declares —
subject from whichever identifier the example echoes back, then status, ETA,
amount, in the order they read naturally.

**Trade-off.** The sentence is only as good as the declared example. The live
`ravi-electronics` row declares no `order_id`, so the reply says "Your request is
shipped" rather than naming the order. Production after: greeting **2.1 s**,
lookup **8.6 s**. (#37 ·
[manifest-spec §6.3](./manifest-spec.md#63-response-wording).)

### 2.3 Small talk answered from the manifest

**Context.** `compose` forced prompt 3 for `smalltalk` even when the manifest
contained everything needed — ~40 s to paraphrase a greeting.

**Decision.** Build the welcome from the manifest: business name, capability ids
rendered friendly, and the first required input as a hint.

**Trade-off.** A formulaic greeting. But it is the first thing anyone sends, so
it sets the impression — and 40 s of silence sets a worse one. (#38.)

### 2.4 Central chat and business chat are different routing modes

**Context.** Classifying a five-business catalogue to conclude "I don't know
which business" cost **38 s** and told us nothing the router had not already
established.

**Decision.** Three modes. Central: naming a business loads that manifest and
keeps it; naming another switches; naming none asks, in **364 ms** with no model
call. Business chat and WhatsApp are pinned and never route elsewhere.

**Trade-off.** The app must mark a chat `scoped` at creation, because a *general*
chat also acquires a `businessId` once resolved and must stay switchable. That
distinction is subtle and easy to get wrong.
(#39 · [channels §7](./channels.md#7-business-pinning).)

### 2.5 Skip redundant translation

**Context.** If the customer is already speaking the reasoning language, the two
translate hops are pure latency.

**Decision.** Skip them. Also resolve unknown source languages through
`/text-lid` first, because live `/translate` and `/transliterate` reject
`"auto"`.

**Trade-off.** One extra ~300 ms hop when the language is genuinely unknown — paid
only then. (#7, #12.)

### 2.6 Raise the Sarvam timeout to 90 s

**Context.** `sarvam-105b` legitimately reasons past 30 s on open-ended writing.
The old timeout killed a good call and retried it.

**Decision.** 90 s.

**Trade-off.** A genuinely hung call takes longer to fail. Better than doubling
latency on calls that were about to succeed. (#30.)

### 2.7 Two endpoints for the voice call

**Context.** `/agent/resolve` wraps the whole runtime and spends ~20 s in a single
classify pass. Unusable on a live phone call.

**Decision.** Add `POST /agent/execute`, which executes one named capability —
slots, confirm, rules, render, receipt — with **no Sarvam in the loop**, because
Samvaad's own sub-500 ms model has already chosen the capability. Measured
**0.40 s** through the public URL.

**Trade-off.** UCXP no longer *resolves* which capability on the call path, so
any consistency claim covers `/chat`, not the call. And it is a second
implementation of the resolution semantics, with two verified divergences — no
disk snapshot, no `last_<key>` facts.
(#44 · [channels §5](./channels.md#5-samvaad-agent-tools).)

---

## 3. Channels

### 3.1 Async WhatsApp replies

**Context.** A Twilio webhook must answer in ~10 s or it times out with error
11200 and drops the reply. Measured resolution is 20–27 s. No configuration
reconciles those.

**Decision.** Ack in ~0.4 s with TwiML, hand the work to a FastAPI
`BackgroundTask`, and deliver the answer out-of-band via the Twilio REST API.

**Trade-off.** `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN` become mandatory rather than
media-only. WhatsApp cannot unsend a delivered ack, so the "working on it…"
bubble lingers forever — `UCXP_WHATSAPP_ACK=0` trades that for 20 s of silence.
And a restart mid-resolution drops that one reply. (#19.)

### 3.2 Twilio sandbox, not Meta Cloud API

**Context.** Meta requires approval and template verification.

**Decision.** Twilio's WhatsApp sandbox.

**Trade-off.** Users must join the sandbox, and the webhook is Console-only — no
REST API exposes it. It works today. (#10.)

### 3.3 Text replies by default; spoken replies opt-in

**Decision.** Inbound voice notes always work. Outbound is text unless the
inbound was audio, or `UCXP_WHATSAPP_SPEAK=1`.

**Trade-off.** A spoken reply needs the engine's **WAV** transcoded to **MP3**
(WhatsApp rejects WAV) via `ffmpeg`, served from a short-lived in-memory store.
Text is instant and never fails; if TTS or the transcode dies, the text still
goes. (#18.)

### 3.4 Documents are channel-agnostic

**Context.** PDF and OCR reading lived inside `whatsapp.py`, so only WhatsApp
could read a file — the app and web had no attach path at all.

**Decision.** Move extraction *and* the framing that turns OCR noise into
reference material into `backend/app/documents.py`, and add `POST /document`. An
upload runs the same `runtime.run` a typed turn does, so a photographed order
produces a real receipt.

**Trade-off.** Costs a native dependency (`expo-document-picker`), so the shipped
APK must be rebuilt before attach works on Android. Two copies would have drifted
the moment one got a fix. (#17, #42-documents.)

### 3.5 `POST /document` answers 200 even when the file is unreadable

**Context.** A 4xx reaches a mobile client as a generic network error.

**Decision.** Return 200 with `state="failed"` and a next-step sentence in
`reply_text`, plus a `document_kind` saying which failure it was.

**Trade-off.** Unusual HTTP semantics. But the customer needs to be told "that
PDF is a scan — send a photo instead", in the same place every other reply
appears. ([`PLAN.md`](../PLAN.md) §6.)

### 3.6 `/transcribe` alongside `/voice`

**Context.** The app wants to show the customer their own words immediately.

**Decision.** A speech-to-text-only endpoint. The app transcribes, renders, then
sends text to `/chat`.

**Trade-off.** Two round trips instead of one. Pointing the app at `/voice` would
execute the capability twice. (#31.)

### 3.7 The phone call is a channel, not a second brain

**Context.** A live voice channel could be self-hosted (Pipecat) or delegated.

**Decision.** Managed Sarvam Samvaad owns telephony, STT, TTS and turn-taking;
UCXP is exposed as one Advanced Tool. This superseded an earlier self-hosted
design.

**Trade-off.** Samvaad's LLM decides *when* to call the tool, and on the fast path
*which* capability. No receipt card on a pure phone call — a caller has no
screen. In exchange, sub-500 ms voice and barge-in come free, and Samvaad
becomes *just another compliant UCXP client*, which is the thesis made literal.
No Sarvam client enters the repo, so the layering rule still holds.
(#42-voice, #43-samvaad.)

### 3.8 Per-business pinning as one parameter

**Context.** A business's WhatsApp number is its own support line. Routing across
five merchants there would be a bug.

**Decision.** `force_business_id` on `runtime.run()`, set by the app's business
chat, a call placed from a merchant screen, `UCXP_WHATSAPP_BUSINESS`, and a
constant `enum` in a scoped Samvaad tool spec.

**Trade-off.** One more parameter to get right in four places. It also hardened
`classify`: a capability id with no resolved business is now dropped as small
talk instead of crashing `gather` on a `None` manifest. (#22, #45.)

### 3.9 Whole-word confirmation, and a business switch cancels the pending action

**Context.** `CONFIRM_YES` matched as a substring, so the "ha" inside an ordinary
word confirmed a **refund** pending on a *different* business — a destructive
action executed with no yes given.

**Decision.** Whole-word matching, multi-word phrases checked separately, and
naming a different business cancels rather than inherits the pending action.

**Trade-off.** Slightly stricter parsing of a human "yeah, go on". Found while
testing #39 — the kind of bug that only appears when two features meet. (#40.)

---

## 4. Data and integrations

### 4.1 One generic connector, real or mock on the same path

**Context.** Five merchants, all `shopify_default`.

**Decision.** One route, `/connectors/shopify/{business_id}/…`, with the business
id carried in the path. It resolves that store's `data_source` and
`credential_ref` from the manifest, reads the token from the environment, and
calls the real Admin API — falling back to deterministic mock when no token or
no store domain is configured.

**Trade-off.** Mock and live differ by a credential, not by a branch, so the demo
path *is* the production path. But the fallback is silent: a missing
`store_subdomain` produces plausible fake data with `/health` green. That is
biting on the live deployment right now.
(#21 · [operations §8](./operations.md#the-live-shopify-issue-in-full).)

### 4.2 Refunds are initiated, never auto-committed

**Decision.** Register the refund request against the real order amount and hand
it to the team.

**Trade-off.** The receipt says "initiated", not "refunded". A real Shopify refund
is destructive and write-scoped; silently moving money on a hackathon credential
is not a defensible default. (#21.)

### 4.3 Adapt to the published manifest shape rather than rewriting the files

**Context.** The onboarding dashboard emits a richer, connector-oriented manifest
than [`PLAN.md`](../PLAN.md) §5 describes.

**Decision.** `runtime/normalize.py` maps the published shape into the internal
model at load time. The graph, executor and renderer are unchanged, both shapes
load, and `raw()` still returns the original JSON a judge will read.

**Trade-off, and the sharpest one in the codebase.** Because the published schema
has no `rules`, `confirm` or `response`, the adapter has to *invent* them:
`confirm` from a destructive-verb wordlist, receipts from name substrings,
`rules: []` for everyone. Structure-mapping became semantics-inference. It also
made `tests/test_runtime.py` red — it targets the retired manifest set.
(#20 · [manifest-spec §6](./manifest-spec.md#6-what-the-published-schema-cannot-express).)

### 4.4 Manifests published to Supabase, files as the floor

**Decision.** Local files load first and are kept as the fallback; active
Supabase rows override by id.

**Trade-off.** The file you read in the repo is not necessarily what is running.
In exchange, an unreachable database degrades to the committed demo set rather
than an empty directory — which is why the "show the judge a manifest" moment
survives a DB outage. ([`docs/manifest-sync.md`](./manifest-sync.md).)

### 4.5 Conversation memory persisted to disk

**Context.** A restart between a refund confirmation and the customer's "Yes"
lost the pending state, so the follow-up landed with nothing pending and fell
back to small talk.

**Decision.** Snapshot every conversation to one JSON file after every turn
(atomic `os.replace`), reload on startup, path overridable via
`UCXP_STATE_FILE`. Failures never break a reply.

**Trade-off.** O(conversations) per turn and single-node. At demo scale that is
microseconds. (#23 ·
[data-and-memory §4](./data-and-memory.md#4-how-a-mid-flow-confirmation-survives-a-restart).)

### 4.6 Auth was built, moving it out of "not building"

**Context.** [`PLAN.md`](../PLAN.md) §9 originally excluded auth.

**Decision.** Build it, with Supabase email + Sign in with Google. Sessions are
what let a customer's orders and conversations be *theirs* across the app, web
and a phone number — so it stopped being scope creep and became the thing memory
hangs off.

**Trade-off.** Supabase specifically because `@supabase/supabase-js` is pure JS:
no native module, so no `expo prebuild` to wipe the hand-patched `android/`.
Google uses the OAuth **redirect** flow via `expo-web-browser` for the same
reason. Server-side, auth stays **optional** — WhatsApp has no bearer token, so
requiring one would break a working channel.

**Trap, recorded because it cost time:** Supabase falls back to its Site URL when
`redirect_to` is not allow-listed, so a working sign-in silently landed on
`localhost:3000` until `onesupport://` was added to Redirect URLs. (#47.)

### 4.7 Web lookup for businesses with no manifest

**Decision.** Search (Tavily / Brave / Serper, provider inferred from whichever
key is set), answer usefully, then invite them to onboard — the protocol pitch
made concrete.

**Trade-off. Untested against a live provider** — no key was available when it
was written. With no key the feature is off and the ordinary "which business?"
reply stands. (#41.)

---

## 5. Deployment and build

### 5.1 `UCXP_PORT=$PORT` in the Docker `CMD`

**Context.** `config.from_env()` derives `mock_base_url` and
`connector_base_url` from `UCXP_PORT`, and the runtime calls its own connector
over loopback.

**Decision.** Export both from `$PORT` in the `CMD`, and keep the self-call on
loopback rather than the public origin.

**Trade-off.** None, once understood — but the failure it prevents is the worst
shape available: `/health` green, manifests loaded, and every capability failing
at `act` on a refused connection, with the manifest and the graph both looking
blameless. (#29, #35-loopback ·
[operations §4.1](./operations.md#41-the-ucxp_port-loopback-trap).)

### 5.2 Docker, not a buildpack

**Decision.** `python:3.12-slim` plus `tesseract-ocr` and `ffmpeg`.

**Trade-off.** A longer build. Both binaries are used through lazy imports, so a
buildpack build goes green and then silently loses image OCR and voice notes at
runtime.

### 5.3 Declare every dependency, and verify the committed tree

**Context.** Two deploys died the same way. First, `requirements.txt` declared
only the AI Engine's deps — `langgraph`, `twilio`, `pypdf`, `pytesseract` and
`pillow` were in `.venv` but never declared, so a clean container died on
`import langgraph`. Later, `main.py` imported `documents.py` and a schema that
were never committed, so the container died at import while everything ran
locally.

**Decision.** Cross-check imports against `requirements.txt` whenever a new
import lands, and verify the **committed** tree before every deploy:

```bash
git archive HEAD | tar -x -C /tmp/x && (cd /tmp/x && python -c 'import backend.app.main')
```

**Trade-off.** One more pre-deploy step, against a failure mode with no
application logs and a CLI that keeps showing the last *successful* deployment.
(#28, #46.)

### 5.4 Push Railway variables with a script

**Context.** `.env` is git-ignored, so Railway can only learn secrets manually. A
hand copy silently dropped the tail of a 78-line file — exactly where the Shopify
and Twilio keys live. `/health` green, `/chat` resolving, **every order lookup
quietly returning mock data**.

**Decision.** `scripts/sync-railway-env.sh` pushes a fixed key list in one call,
prints only a prefix and a length, and deliberately omits
`PORT`/`UCXP_PORT`/`*_BASE_URL` so §5.1 cannot come back.

**Trade-off.** The key list must be maintained by hand. (#35-envsync.)

### 5.5 Release APK, and web from the same codebase

**Context.** The APK only worked tethered because a debug build carries no JS
bundle — it pulls from Metro over `adb reverse`.

**Decision.** `--variant release`, which compiles the bundle in.
`build.gradle` already signs release with the debug keystore, so no keystore
work. Web ships via `expo export -p web` from the *same* Expo codebase rather
than a React+Vite rewrite.

**Trade-off.** One codebase serving two very different surfaces, with real
platform splits — see [`frontend/README.md`](../frontend/README.md). (#24.)

### 5.6 Build the APK before installing web dependencies

**Context.** Fifteen files under `node_modules` are hand-patched so Gradle can
find nvm's node. Any `npm install` reverts them.

**Decision.** Build the APK first, so a disturbed install costs the web build and
never the APK already on disk. Then `scripts/android-patches.sh` save/restore/check,
so the patches are recoverable rather than merely avoidable.

**Trade-off.** A build-order constraint that has to be remembered. The script
matches `.gradle`, `.gradle.kts` **and** `.kt`; an earlier `--include="*.gradle"`
matched only 5 of 15 and would have silently under-restored. (#25, #34, #43-patches.)

### 5.7 `EXPO_PUBLIC_API_URL` must be a full HTTPS URL in anything shipped

**Context.** A bare port is convenient in dev — a laptop's LAN IP changes with
the network, and a stale IP is indistinguishable from a broken backend, whereas
Metro's host is reachable by definition.

**Decision.** Accept a bare port for LAN dev, but require a full `https://` URL
for the APK and the Vercel build.

**Trade-off.** Two accepted formats. In a standalone build there is no Metro
host, so the bare form falls back to `http://localhost:8000` — the device itself
— and silently drops to mocks. Android 9+ also refuses cleartext. (#26, #32.)

### 5.8 The backend URL is editable at runtime

**Context.** `EXPO_PUBLIC_*` is inlined at bundle time, so a shipped APK could
otherwise never be repointed — every backend change would mean a full Gradle
rebuild.

**Decision.** Settings → Backend, stored in AsyncStorage, read once at startup
before any request, with a **Test** button that pings `/health`.

**Trade-off.** Two sources of truth for the base URL, with the override winning.
It is what made shipping with a placeholder viable while hosting was still being
set up. (#33.)

### 5.9 Web pinned to `output: "single"`, with a post-export head script

**Decision.** Pin the SPA mode in `app.json` so the Vercel catch-all rewrite
matches the build rather than assuming it. Finish the document `<head>` with
`scripts/finalize-web-head.mjs` after export.

**Trade-off.** A post-processing step instead of the documented `app/+html.tsx`
— which applies only to static rendering, verified by exporting with the file in
place and getting Expo's default head back. The script is idempotent and fails
loudly if Expo's template stops matching. (#36, #50.)

### 5.10 The landing page is DOM elements in a `.web.tsx`

**Context.** A scroll-driven marketing page — sticky nav, canvas particle field,
CSS-grid bento, keyframe choreography — expressed through React Native's layout
model would cost real fidelity for portability a page that never runs on a phone
does not need.

**Decision.** Plain DOM in a `.web.tsx`, with every CSS rule scoped under `.lp`
and injected as a `<style>` child living exactly as long as the component. Metro
resolves `.web.tsx`, so none of it reaches the native bundle.

**Trade-off.** Two styling systems in one repo. The `.lp` scoping is not
cosmetic: the app *is* React Native Web, so a bare `section`/`h2`/`*` reset would
otherwise reach straight into the app tree. (#49.)

### 5.11 The web auth gate moved into the router

**Context.** `_layout.tsx` rendered the sign-in screen in place of the whole tree
for any signed-out user, on every platform. Correct for an installed app —
someone who downloaded it has already been sold — but on the web a visitor hit a
password form before learning what Sahayak is.

**Decision.** On web the router always mounts; `/` and `/sign-in` are public and
a gate bounces every other route. Landing and app ship as **one SPA on one
domain**; the existing catch-all rewrite already serves both.

**Trade-off.** Platform-divergent auth behaviour, which has to be understood
before changing either. No second project or subdomain. (#48.)

---

## 6. Product and scope

### 6.1 Five merchants deep, not twenty-eight wide

**Decision.** Real manifests, real connector and real tests for a small set. The
directory can show more at zero cost, which demonstrates what a protocol scales
to; depth stays small.

**Trade-off.** Less impressive at a glance. Depth on a few businesses and four
languages beats breadth everywhere. (#3, [`PLAN.md`](../PLAN.md) §4.)

### 6.2 Four languages claimed, eleven supported

**Decision.** Claim `en-IN`, `hi-IN`, `te-IN`, `ta-IN`. The engine supports
eleven and they will work; we do not claim them.

**Trade-off.** Undersells the engine. The claim we make should be the claim we
can defend. ([`PLAN.md`](../PLAN.md) §4.)

### 6.3 `sarvam-105b`, not `sarvam-m` or `sarvam-30b`

**Context.** `sarvam-m` is deprecated. The current models are reasoning models
whose chain of thought is billed against `max_tokens`; `sarvam-30b` frequently
exhausted its 4096-token budget mid-thought and returned `content: null`.

**Decision.** `sarvam-105b` at `max_tokens=4096`, with one retry at a doubled
budget on truncation, then an actionable error.

**Trade-off.** Slower and larger. It finished every time. Thinking cannot be
disabled — `enable_thinking: false` is ignored. (#2.)

### 6.4 Prompts are files, not code

**Decision.** `ai_engine/prompt_library/*.md` and
`backend/app/runtime/prompts/*.md`, loaded through an `lru_cache` and rendered
with the same `{{placeholder}}` engine the manifests use.

**Trade-off.** Prompts are no longer type-checked or greppable as code. They are
editable during a demo without a redeploy. (#6.)

### 6.5 Web ships without working voice

**Decision.** Position web as the clickable proof that the protocol has more
than one client — text chat, real receipts, real multilingual — and let Android
and WhatsApp carry the voice story.

**Trade-off.** A capability gap between surfaces that must be stated, not hidden.
A browser-native recorder has since been written but is **not currently wired
correctly** — see [`frontend/README.md`](../frontend/README.md) for the verified
state. (#27.)

### 6.6 Renamed OneSupport → Sahayak; UCXP unchanged

**Decision.** Sahayak is the project; UCXP stays the protocol it speaks. Native
identifiers (`com.ucxp.onesupport`, the `onesupport://` scheme) were
**deliberately not renamed**.

**Trade-off.** Identity drift between the display name and the bundle ids. They
are invisible to users, and `android/` is hand-patched under a standing "do not
re-run `expo prebuild`" constraint — so renaming them needs a planned prebuild
and clean rebuild. (#14.)

---

## 7. Decisions still owed

Things this log should eventually contain, listed here so they are not lost.

| Open item | Why it matters |
|---|---|
| Let the published schema carry `rules`, `confirm` and `response` | Would return `normalize.py` to structure-mapping and make the rule engine live — [manifest-spec §6](./manifest-spec.md#6-what-the-published-schema-cannot-express) |
| Extract a shared capability-execution service | Removes the `/agent/execute` divergence — no disk snapshot, no `last_<key>` facts — [channels §5](./channels.md#5-samvaad-agent-tools) |
| Record WhatsApp turns to the durable store | `db/schema.sql` already reserves `channel` and `external_id` — [data-and-memory §7.3](./data-and-memory.md#73-whatsapp-turns-never-reach-the-durable-store) |
| Rewrite `tests/test_runtime.py` for the merchant set | 11 of 19 fail; the protocol claim currently has no passing regression test guarding it |
| Build the consistency harness, or drop it from the plan | [`PLAN.md`](../PLAN.md) §6 and §8 both promise it; `backend/app/harness/` does not exist |
| Fix the web voice recorder's API mismatch | [`frontend/README.md`](../frontend/README.md) |
| Renumber the duplicate log ids as 51–53 | See the note at the top of this file |
