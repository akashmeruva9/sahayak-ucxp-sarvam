# Architecture

How Sahayak is put together, why the layers sit where they do, and how the two
rules that make UCXP a protocol are enforced rather than merely intended.

**Related:** [request lifecycle](./request-lifecycle.md) ·
[manifest spec](./manifest-spec.md) · [channels](./channels.md) ·
[data & memory](./data-and-memory.md) · [operations](./operations.md) ·
[decisions](./decisions.md)

---

## 1. The one-sentence version

A generic resolution runtime reads a business's capabilities out of a JSON
manifest at request time, executes one of them against a real API, and returns a
receipt. Four different clients drive it. One module, and only one, is allowed
to talk to Sarvam.

Everything below is a consequence of that sentence.

---

## 2. Context view

Who and what the system talks to. This is a C4-style context diagram drawn as a
Mermaid flowchart — GitHub does not render Mermaid's experimental `C4Context`
renderer reliably, so the C4 *shape* is kept and the notation is plain.

```mermaid
flowchart TB
    subgraph people["People"]
        CUST["Customer<br/><i>Person</i><br/>speaks Hindi, Telugu,<br/>Tamil or English"]
        MERCH["Merchant<br/><i>Person</i><br/>publishes a manifest<br/>via the onboarding dashboard"]
    end

    SYS["<b>Sahayak</b><br/><i>Software System</i><br/>UCXP runtime + AI Engine + clients.<br/>Resolves customer jobs and returns receipts."]

    subgraph ext["External systems"]
        SARVAM["Sarvam AI<br/><i>System</i><br/>STT, translate, LLM, TTS, LID"]
        SAMVAAD["Sarvam Samvaad<br/><i>System</i><br/>managed voice agent —<br/>telephony, turn-taking"]
        TWILIO["Twilio<br/><i>System</i><br/>WhatsApp sandbox"]
        SHOP["Shopify Admin API<br/><i>System</i><br/>per-merchant order data"]
        SUPA["Supabase<br/><i>System</i><br/>auth, published manifests,<br/>durable history"]
    end

    CUST -->|"asks for something,<br/>by voice or text"| SYS
    MERCH -->|"publishes a manifest"| SUPA
    SUPA -->|"active manifest rows"| SYS
    SYS -->|"speech, reasoning,<br/>synthesis"| SARVAM
    SAMVAAD -->|"calls UCXP as<br/>an Advanced Tool"| SYS
    CUST -->|"phones"| SAMVAAD
    CUST -->|"messages"| TWILIO
    TWILIO -->|"webhook"| SYS
    SYS -->|"async reply"| TWILIO
    SYS -->|"order lookups,<br/>refund initiation"| SHOP
    SYS -->|"session + history"| SUPA
```

Two things to notice.

**Samvaad points at Sahayak, not the other way round.** On a phone call the
managed voice agent owns the conversation and calls UCXP as a tool. That makes
Samvaad *a UCXP client*, exactly like the mobile app — which is the protocol
thesis stated in the topology rather than in a slide.

**The merchant never touches this system.** They publish a manifest to Supabase
from a separate onboarding dashboard. The runtime discovers them. Adding a
merchant involves no deploy here.

---

## 3. Container view

```mermaid
flowchart TB
    subgraph clients["Clients — every one speaks the same HTTP contract"]
        APK["Android APK<br/><i>Expo / React Native</i><br/>text + real voice + documents"]
        WEB["Web SPA<br/><i>same Expo codebase, exported</i><br/>text + documents, simulated voice"]
        WA["WhatsApp<br/><i>Twilio sandbox</i><br/>text, voice notes, PDF, photos"]
        CALL["Phone call<br/><i>Sarvam Samvaad agent</i><br/>voice only"]
    end

    subgraph container["Railway container — ONE image, ONE process"]
        subgraph api["HTTP surface · backend/app/main.py + routers"]
            H1["/chat · /voice · /transcribe · /document"]
            H2["/whatsapp/webhook"]
            H3["/agent/resolve · /agent/execute"]
            H4["/businesses · /manifests · /health · /history"]
        end

        subgraph rt["UCXP Runtime · backend/app/runtime — no business code"]
            G["graph.py<br/>LangGraph state machine"]
            LO["loader.py + normalize.py<br/>manifest registry"]
            EX["executor.py<br/>calls declared endpoints"]
            RE["renderer.py<br/>templates + rule AST"]
            LL["llm.py<br/>the only route to a model"]
        end

        subgraph sup["Supporting modules · backend/app"]
            MEM["memory/<br/>conversation state + snapshot"]
            DOC["documents.py<br/>pypdf + Tesseract"]
            AU["auth.py<br/>optional Supabase JWT"]
            CN["connectors/shopify.py<br/>one generic connector"]
            MO["mock/router.py<br/>legacy deterministic APIs"]
        end

        AE["AI Engine · ai_engine/<br/><i>in-process Python import</i><br/>the ONLY Sarvam client"]
    end

    subgraph data["Data"]
        FILES["manifests/*.json<br/>committed demo set"]
        DB["Supabase<br/>ucxp_manifests · conversations ·<br/>messages · auth.users"]
        VOL["Railway volume /data<br/>.ucxp_state.json"]
    end

    SAR["Sarvam APIs"]
    SHOP["Shopify Admin API"]

    APK --> H1
    WEB --> H1
    WA --> H2
    CALL --> H3
    APK --> H4
    WEB --> H4

    H1 --> G
    H2 --> G
    H3 --> G
    H3 --> EX
    H4 --> LO

    G --> LO
    G --> EX
    G --> RE
    G --> LL
    G --> MEM
    EX --> RE
    LO --> FILES
    LO --> DB
    LL --> AE
    AE --> SAR
    EX --> CN
    EX --> MO
    CN --> SHOP
    CN --> LO
    H1 --> DOC
    H2 --> DOC
    H1 --> AU
    AU --> DB
    MEM --> VOL
    MEM --> DB
```

### Why the runtime and the AI Engine are one container

They are imported in-process, not called over HTTP. `ai_engine/` does ship a
standalone FastAPI surface (`ai_engine.app`), but that exists to test the engine
alone.

Splitting them into two services would add a network hop to the hottest path in
the system, on a pipeline that is already latency-bound by a reasoning model,
and buy nothing — they have identical scaling characteristics and are released
together. [`PLAN.md`](../PLAN.md) §6 makes this explicit: *"Do not call the AI
Engine over HTTP from the runtime — they deploy together."*

### Why the connector lives outside the runtime

`backend/app/connectors/shopify.py` is mounted on the same FastAPI app, but it
is not `runtime/` code. The runtime reaches it the same way it reaches any
business endpoint: by rendering a URL out of a manifest and issuing an HTTP
request. In production that request goes over loopback to the same process,
which is an optimisation, not a coupling — point `UCXP_CONNECTOR_BASE_URL` at a
different host and nothing in `runtime/` changes.

That indirection is what lets a merchant's manifest declare a Shopify endpoint,
a legacy mock endpoint, or eventually someone else's API, without the graph
knowing which.

---

## 4. The layering rules, as a dependency graph

[`PLAN.md`](../PLAN.md) §2 states two directional rules. Here they are as an
allowed-import graph. Solid arrows are imports that exist; the dashed arrows are
the ones that must never appear.

```mermaid
flowchart TB
    CLIENTS["frontend/ · WhatsApp adapter · agent_tools/<br/><i>transport adapters</i>"]
    MAIN["backend/app/main.py<br/><i>HTTP surface</i>"]
    RUNTIME["backend/app/runtime/<br/><i>generic resolution</i>"]
    ENGINE["ai_engine/<br/><i>the only Sarvam client</i>"]
    SARVAM["api.sarvam.ai"]
    MANIFESTS["manifests/*.json + Supabase<br/><i>business behaviour lives HERE</i>"]
    CONNECTORS["connectors/ · mock/<br/><i>business-shaped endpoints</i>"]

    CLIENTS --> MAIN
    MAIN --> RUNTIME
    RUNTIME --> ENGINE
    ENGINE --> SARVAM
    RUNTIME -->|"reads as data"| MANIFESTS
    RUNTIME -->|"HTTP, URL from a manifest"| CONNECTORS

    RUNTIME -.->|"FORBIDDEN — rule 1"| SARVAM
    MAIN -.->|"FORBIDDEN — rule 1"| SARVAM
    CONNECTORS -.->|"FORBIDDEN — rule 1"| SARVAM
    MANIFESTS -.->|"FORBIDDEN — rule 2:<br/>no business may reach<br/>back into the runtime"| RUNTIME
```

**Rule 1 — nothing above the AI Engine knows Sarvam exists.** The runtime
imports the class `SarvamOrchestrator` and calls methods on it. It never names a
model, constructs an HTTP client for Sarvam, handles a retry, or reads
`SARVAM_API_KEY`. `runtime/llm.py` is the entire surface: two functions,
`think_json` and `think_text`, both of which return an empty result rather than
raising, so a model failure degrades into "ask the customer" instead of a 500.

**Rule 2 — nothing in the runtime knows a business exists.** Business behaviour
enters only as manifest data. There is no registry of handlers, no plugin
loader, no `if business ==`.

### Verifying both

```bash
# Rule 2 — no business name anywhere in the runtime.
grep -rniE "flipkart|airtel|apollo|ravi|lakshmi|meena|sri-pharma|anna-groceries" \
     backend/app/runtime/
# → no matches

# Rule 1 — no Sarvam wire access, model constant, or credential outside ai_engine/.
grep -rn "api\.sarvam\.ai\|SARVAM_API_KEY\|saarika\|bulbul\|sarvam-translate\|SARVAM_LLM_MODEL" \
     backend/
# → no matches

# Rule 1, positively — the runtime's complete set of model imports.
grep -rn "from ai_engine import" backend/app/runtime/
# → graph.py, llm.py; both import SarvamOrchestrator and nothing else
```

Both were run against the current tree and both return nothing. The runtime
*does* mention `sarvam-105b` in three code comments explaining measured latency
— comments, not behaviour, which is why the grep above targets wire access and
model constants rather than the string "sarvam".

### The nuance worth stating out loud

`runtime/normalize.py` contains the literal string `shopify`. It routes a
manifest whose `data_source.type` is `shopify` to
`/connectors/shopify/{business_id}/…`.

That is an *integration type*, not a business — five different merchants share
it, which is precisely the claim being made. But it is the seam where a second
integration type (WooCommerce, a bespoke REST API) would force a runtime edit,
and it should be named rather than glossed. The clean version pushes endpoint
resolution into the manifest itself so `normalize.py` only rewrites templates.
See [manifest-spec.md §6](./manifest-spec.md#6-what-the-published-schema-cannot-express).

---

## 5. Component view of `backend/app/`

Real imports, verified against the source. Deferred imports (used to break
import cycles) are dashed.

```mermaid
flowchart LR
    MAIN["main.py<br/>FastAPI app + lifespan"]

    subgraph runtime["runtime/"]
        GRAPH["graph.py<br/>UcxpRuntime · 7 nodes"]
        STATE["state.py<br/>TurnState + reducers"]
        LOADER["loader.py<br/>ManifestRegistry"]
        NORM["normalize.py<br/>published → internal"]
        MSTORE["manifest_store.py<br/>Supabase PostgREST"]
        EXEC["executor.py<br/>ActionExecutor"]
        REND["renderer.py<br/>render + evaluate_condition"]
        RLLM["llm.py<br/>think_json / think_text"]
        WSEARCH["websearch.py<br/>Tavily / Brave / Serper"]
        PROMPTS["prompts/*.md<br/>classify · prepare ·<br/>respond · unknown_business"]
    end

    subgraph adapters["Channel adapters"]
        WA["api/whatsapp.py"]
        AGENT["agent_tools/router.py"]
        AEXEC["agent_tools/execute.py"]
    end

    subgraph shared["Shared"]
        MEMCTX["memory/context.py<br/>ConversationStore"]
        MEMSESS["memory/session_store.py<br/>SessionStore"]
        DOCS["documents.py"]
        AUTH["auth.py"]
        CFG["config.py<br/>RuntimeSettings"]
        SCHEMA["schemas/manifest.py<br/>schemas/api.py"]
        VP["voice_phrases.py"]
    end

    subgraph endpoints["Business-shaped endpoints"]
        SHOPC["connectors/shopify.py"]
        MOCKR["mock/router.py"]
    end

    ENG["ai_engine/<br/>SarvamOrchestrator"]

    MAIN --> GRAPH
    MAIN --> LOADER
    MAIN --> DOCS
    MAIN --> AUTH
    MAIN --> MEMSESS
    MAIN --> MEMCTX
    MAIN --> VP
    MAIN --> SCHEMA
    MAIN --> ENG
    MAIN --> WA
    MAIN --> AGENT
    MAIN --> SHOPC
    MAIN --> MOCKR

    GRAPH --> STATE
    GRAPH --> LOADER
    GRAPH --> EXEC
    GRAPH --> REND
    GRAPH --> RLLM
    GRAPH --> MEMCTX
    GRAPH --> WSEARCH
    GRAPH --> SCHEMA
    GRAPH --> ENG
    RLLM --> ENG
    RLLM --> PROMPTS
    RLLM --> REND
    LOADER --> NORM
    LOADER --> MSTORE
    LOADER --> SCHEMA
    EXEC --> REND
    EXEC --> SCHEMA

    WA --> DOCS
    WA --> CFG
    WA -.->|"deferred"| MAIN
    AGENT --> AEXEC
    AGENT --> LOADER
    AGENT -.->|"deferred"| MAIN
    AEXEC --> EXEC
    AEXEC --> REND
    AEXEC --> LOADER
    AEXEC --> MEMCTX
    SHOPC --> LOADER
```

### Module responsibilities

| Module | Owns | Explicitly does not |
|---|---|---|
| `main.py` | HTTP surface, request/response shaping, singletons, lifespan | Any resolution logic |
| `runtime/graph.py` | Control flow and the seven nodes | HTTP clients, business names, model names |
| `runtime/state.py` | `TurnState` TypedDict and the two LangGraph reducers that merge per-node latency and degraded stages | — |
| `runtime/loader.py` | Loading, validating and indexing manifests; alias matching; classifier catalogues | Knowing what any manifest means |
| `runtime/normalize.py` | Mapping the published manifest shape onto the internal one | *Should not*, but currently does, infer semantics — see [manifest-spec.md §6](./manifest-spec.md#6-what-the-published-schema-cannot-express) |
| `runtime/executor.py` | Rendering and calling one declared endpoint; turning HTTP failures into an `ActionError` with a customer-safe message | Deciding which endpoint |
| `runtime/renderer.py` | `{{template}}` substitution and safe rule evaluation over an AST allow-list | `eval` |
| `runtime/llm.py` | The only route to a model; prompt loading from `.md`; tolerant JSON extraction from reasoning-model output | Raising — every failure returns an empty result |
| `connectors/shopify.py` | Credential resolution, real Admin API calls, deterministic mock fallback | Being reachable except through a manifest-declared URL |
| `documents.py` | Bytes → text (pypdf, Tesseract), and the framing that turns OCR noise into reference material | Any business logic; any channel specifics |
| `memory/context.py` | Live conversation state, pending confirmations, disk snapshot | Durable history |
| `memory/session_store.py` | Durable, fire-and-forget Supabase history | Being on the critical path |
| `auth.py` | Optional Supabase JWT verification, local or remote, cached 5 minutes | Being required — anonymous callers are served |

### Two deferred imports, on purpose

`api/whatsapp.py` and `agent_tools/router.py` both need the runtime singleton
from `main.py`, but `main.py` includes their routers at import time. Importing
`main` at module scope would be circular. Both defer it into a function
(`_get_runtime()` / `get_runtime_dep()`), which also lets tests override the
runtime. This is noted in both files.

### Every optional native dependency is imported lazily

`pypdf`, `pytesseract`, `PIL`, `twilio` and `jwt` are all imported inside the
function that uses them. A missing `tesseract-ocr` binary degrades one document
rather than failing app startup — which matters because the failure would
otherwise be a container that never becomes healthy, with the true cause three
layers down.

---

## 6. Deployment topology

```mermaid
flowchart TB
    subgraph user["End users"]
        PHONE["Android phone<br/>release APK"]
        BROWSER["Browser"]
        WAPP["WhatsApp"]
        PSTN["Phone line"]
    end

    subgraph vercel["Vercel — static"]
        SPA["frontend/dist<br/>Expo web export, output mode 'single'<br/>SPA catch-all rewrite<br/>EXPO_PUBLIC_API_URL inlined at build"]
    end

    subgraph railway["Railway — Docker, python:3.12-slim"]
        subgraph proc["one uvicorn process"]
            RUN["backend.app.main:app<br/>UCXP runtime"]
            ENG["ai_engine<br/>in-process import"]
        end
        BIN["tesseract-ocr · ffmpeg<br/>installed in the image"]
        VOLUME[("Volume mounted at /data<br/>UCXP_STATE_FILE=/data/.ucxp_state.json")]
        HC["Healthcheck GET /health<br/>120 s timeout, restart x3"]
    end

    subgraph saas["Managed services"]
        SUPA[("Supabase<br/>ucxp_manifests · conversations ·<br/>messages · auth.users")]
        TW["Twilio WhatsApp sandbox"]
        SARV["Sarvam APIs"]
        SAMV["Sarvam Samvaad agent"]
        SHOPIFY["Shopify Admin API<br/>per merchant store"]
    end

    PHONE --> RUN
    BROWSER --> SPA
    SPA --> RUN
    WAPP --> TW
    TW -->|"POST /whatsapp/webhook"| RUN
    RUN -->|"REST, async reply"| TW
    PSTN --> SAMV
    SAMV -->|"POST /agent/execute"| RUN

    RUN --- ENG
    ENG --> SARV
    RUN --> VOLUME
    RUN --> SUPA
    RUN --> SHOPIFY
    RUN --> BIN
    HC --> RUN

    RUN -.->|"loopback 127.0.0.1:$PORT<br/>connector + mock self-call"| RUN
```

That dashed self-loop is not decoration. The runtime calls its own Shopify
connector and mock APIs over loopback, at a port derived from `UCXP_PORT`. If
`UCXP_PORT` and the port uvicorn binds ever disagree, `/health` stays green and
every capability fails at `act` on a refused connection. It has a diagram and a
full write-up in [operations.md §4](./operations.md#4-railway).

### What is deliberately not in the topology

- **No separate AI Engine service** — §3.
- **No message queue.** The WhatsApp async reply uses a FastAPI `BackgroundTask`
  in the same process. At demo scale a queue would add an operational component
  and a failure mode without changing behaviour; the trade-off is that a
  container restart mid-resolution drops that one reply.
- **No cache layer.** The only caching is a 5-minute in-process auth-token cache
  and an `lru_cache` on prompt file reads.
- **Single node.** Conversation state is a process-local dict snapshotted to one
  file. Two replicas would split-brain the pending-confirmation state. This is
  an explicit demo-scale choice — see
  [data-and-memory.md §7](./data-and-memory.md#7-known-gaps).

---

## 7. Cross-cutting invariants

These hold everywhere and are worth knowing before changing anything.

| Invariant | Where it is enforced | Why |
|---|---|---|
| Public AI Engine methods **never raise** | `ai_engine/`, relied on by `runtime/llm.py` | Callers check `success` and a structured `error`. Wrapping in try/except and assuming exceptions is a bug |
| The runtime's LLM helpers **never raise either** | `think_json` returns `{}`, `think_text` returns `""` | A classifier that falls over degrades to "ask the customer", not a 500 |
| A missing template key is a **loud failure** | `renderer.render(strict=True)` raises `RenderError` | [`PLAN.md`](../PLAN.md) §5: a blank in the demo is worse than a visible error. The caller logs it and falls back |
| The model's `capability_id` is **validated against the manifest** before use | `graph.classify` | Never act on an id the manifest does not declare |
| The model's `business_id` is **ignored entirely** | `graph.classify` | The router owns the business decision, so no model output can move a customer to a store they did not ask for |
| Rules are evaluated over an **AST allow-list**, never `eval` | `renderer.evaluate_condition` | Manifests are third-party data. Unit-tested that `__import__('os').system(…)` is refused |
| Confirmation matching is **whole-word** | `graph.classify`, `CONFIRM_YES` | Substring matching once let the "ha" inside an ordinary word confirm a pending refund on a different business |
| Destructive actions are **initiated, never auto-committed** | `connectors/shopify.py:refund_order` | A real refund is destructive and write-scoped |
| Persistence failures are **logged and swallowed** | `ConversationStore.save`, `SessionStore._post` | The customer must never lose an answer to a database hiccup |
| Optional deps are **imported lazily** | `documents.py`, `whatsapp.py`, `auth.py` | A missing binary degrades one request, not startup |
| Chain-of-thought is **never serialised** | `ai_engine` `LLMResponse.reasoning` | It must not reach a user or a log verbatim |

---

## 8. Known architectural debt

Carried here deliberately rather than left for a reader to discover.

### 8.1 `normalize.py` infers semantics, not just structure

The adapter was meant to map one schema onto another. Because the published
schema has no `rules`, `confirm` or `response` field, it also has to invent
them: `confirm` from a destructive-verb wordlist matched against the capability
*name*, receipts from name substrings, response sentences from the declared
`response.example` fields, and `rules: []` for every merchant.

It is in the right place — one module, at the boundary, business-generic — but
the honest fix is in the published schema. Full detail and the mapping table in
[manifest-spec.md §6](./manifest-spec.md#6-what-the-published-schema-cannot-express).

**Consequence:** the manifest rule engine is inert in production. The evaluator
and its AST allow-list are unit-tested, and the denial branch is covered on the
`/agent/execute` path, but no live capability exercises them.

### 8.2 `/agent/execute` is a second implementation of the resolution semantics

`agent_tools/execute.py:run_capability()` reuses `ActionExecutor`, `render` and
`evaluate_condition`, but re-implements slot-filling, the confirmation gate and
receipt rendering outside the graph. Two consequences, both verified by reading
the source:

- it never calls `store.save()`, so the disk-persistence guarantee does not
  cover the fast call path;
- it never writes `last_<key>` context facts after a successful action, so
  memory diverges between `/chat` and a phone call.

The duplication exists for a real reason — the graph's `gather`/`act`/`compose`
are `async` node methods bound to `TurnState` and LangGraph, not callable
standalone — but the fix is to extract a capability-execution service both call,
not to keep two. See [channels.md §5](./channels.md#5-samvaad-agent-tools).

### 8.3 The connector reaches back into the runtime registry

`connectors/shopify.py` imports `runtime.loader.get_registry()` to read a
store's `data_source` and `credential_ref` from the raw manifest. The direction
is acceptable (connector → runtime, not the reverse), but it means the connector
is coupled to the registry singleton and cannot be lifted out of the process
without also moving manifest access. Passing the store config in the request, or
resolving it at normalize time, would decouple it.

### 8.4 WhatsApp turns never reach the durable session store

`/chat` and `/document` call `record_turn_later`; `api/whatsapp.py` does not,
despite `db/schema.sql` reserving `channel = 'whatsapp'` and an `external_id`
column clearly intended for `whatsapp:+91…`. `/agent/*` does not either. See
[data-and-memory.md §7](./data-and-memory.md#7-known-gaps).

### 8.5 The consistency harness does not exist

[`PLAN.md`](../PLAN.md) §3 lists `backend/app/harness/`, §6 lists
`POST /harness/run`, and §8 makes a consistency dashboard the seventh demo step.
The directory was never created and the route is absent from the live
`/openapi.json`. Multilingual consistency is currently demonstrated, not
measured.
