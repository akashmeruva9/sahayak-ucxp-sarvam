# UCXP Merchant Dashboard — Build Specification

**Purpose:** The onboarding "front door" of UCXP. A merchant fills in their business
details, connects their systems, and clicks **Export** to generate a `support.manifest`
JSON file. That manifest plugs into the UCXP runtime so the voice assistant can serve
the merchant's customers in Indian languages.

This document is the build spec for the frontend (Claude Design) and the backend that
generates + validates the manifest.

---

## 1. The core idea in one line

> A merchant describes their support once, in a form. UCXP turns that description into a
> standard `support.manifest` file. One AI assistant then serves every merchant's
> customers — in their own language — by reading these manifests.

The dashboard is where a merchant *produces* their manifest. It is the human-facing half
of the protocol; the runtime is the machine-facing half.

---

## 2. User & flow

**Primary user:** a merchant admin (e.g. the owner of "Ravi Electronics") who wants their
customers served by the UCXP assistant.

**Flow (happy path):**

1. Merchant lands on dashboard → clicks **"Onboard my business"**
2. **Step 1 — Business basics:** name, category, logo (optional), primary contact
3. **Step 2 — Connect data source:** how the assistant reads live order data
   (Shopify connect, or a generic API, or "no live data — FAQ only")
4. **Step 3 — Capabilities:** tick what the assistant may do (track_order, refund,
   return_policy, reorder, warranty, exchange…)
5. **Step 4 — Languages:** tick which languages to support (Telugu, Hindi, Tamil…)
6. **Step 5 — Knowledge:** paste/upload FAQ + policies (or auto-generate from a help URL)
7. **Step 6 — Escalation:** SLA + grievance ladder (defaults pre-filled per Indian rules)
8. **Review → Export:** preview the generated `support.manifest`, then **Download** /
   **Send to UCXP runtime**

**Key UX principle:** every step has smart defaults so a merchant can finish in ~3 minutes.
The manifest is always previewable live on the right side as they fill the form.

---

## 3. Screens & components

### 3.1 Landing / dashboard home
- Header: "UCXP — Serve every customer in their language"
- Primary CTA: **Onboard my business**
- Secondary: list of already-onboarded businesses (cards showing name, languages,
  capabilities, manifest status: Draft / Active)
- Each card: **Edit** · **Export manifest** · **Test in playground**

### 3.2 Onboarding wizard (6 steps, left = form, right = live manifest preview)

**Step 1 — Business basics**
- Business name (text)
- Category (dropdown: Electronics, Fashion, Kitchen, Pharmacy, Grocery, Other)
- Business ID (auto-slug from name, editable) — e.g. `ravi-electronics`
- Logo upload (optional)
- Support contact email/phone (optional)

**Step 2 — Connect data source** (how the assistant reads orders)
- Radio choice:
  - **Shopify** → "Connect Shopify" button (OAuth in prod; in demo, paste store subdomain + token)
    - fields: store subdomain, admin token (masked)
    - note under field: "We only read orders & products. We never see customer PII."
  - **Custom REST API** → base URL + auth header + a mapping of endpoints
    (track_order URL, refund URL…)
  - **No live data (FAQ only)** → assistant answers from knowledge base only
- Test connection button → shows ✅ "Connected — found N products, M orders" or ❌ error

**Step 3 — Capabilities**
- Multi-select checkboxes (each with a short description):
  - `track_order` — tell customers where their order is
  - `refund` — initiate/explain refunds
  - `return_policy` — answer return questions
  - `reorder` — repeat a previous order
  - `warranty` — warranty status/claims
  - `exchange` — size/product exchange
  - `cancel_order` — cancel an order
- Each capability the merchant enables must be backed by either the connected API or an FAQ answer.

**Step 4 — Languages**
- Multi-select of supported languages (checkbox grid):
  - Telugu (te-IN), Hindi (hi-IN), Tamil (ta-IN), Kannada (kn-IN), Malayalam (ml-IN),
    Marathi (mr-IN), Bengali (bn-IN), English (en-IN), + more
- Note: "Voice output currently supports 11 languages via Bulbul; text/translation covers 22+."
- A "primary language" selector (the default the assistant greets in)

**Step 5 — Knowledge (FAQ + policies)**
- Two input modes:
  - **Manual:** repeatable rows of {question, answer}; plus policy text fields
    (return_policy, refund_policy, shipping_policy)
  - **Auto-generate:** paste a public help/FAQ URL → backend scrapes → LLM drafts
    FAQ + policies → merchant reviews/edits (this is the "shadow manifest" generator)
- Character counter; markdown allowed in answers

**Step 6 — Escalation & SLA**
- SLA fields (pre-filled defaults per Consumer Protection E-Commerce Rules 2020):
  - first_response: 48h
  - resolution: 30 days
- Escalation ladder (editable list, pre-filled):
  1. Support agent (immediate)
  2. Grievance officer (after 48h) — name/email fields
  3. National Consumer Helpline 1915 (after 30 days)
- Toggle: "Auto-escalate when SLA breached"

### 3.3 Review & Export
- Left: full summary of all entered data
- Right: the generated `support.manifest` JSON, syntax-highlighted, live
- Buttons:
  - **Download manifest** (.json)
  - **Copy JSON**
  - **Send to UCXP runtime** (POST to backend; marks business Active)
  - **Open in playground** (test a query against this manifest immediately)

### 3.4 Playground (optional but high-impact for demo)
- A mini chat/voice box where the merchant types or speaks a test customer question
- Runs it against their just-built manifest + connected store
- Shows: detected intent, which capability fired, the answer (text + play voice)
- This proves the manifest works before going live — great "aha" moment

---

## 4. The `support.manifest` output schema

This is the artifact the whole dashboard produces. Keep it stable — the runtime reads it.

```json
{
  "ucxp_version": "0.1",
  "business": "Ravi Electronics",
  "business_id": "ravi-electronics",
  "category": "Electronics",
  "primary_language": "te-IN",
  "languages": ["te-IN", "hi-IN", "ta-IN", "en-IN"],
  "capabilities": ["track_order", "refund", "return_policy", "warranty"],
  "data_source": {
    "type": "shopify",
    "store_subdomain": "ravi-electronics-bmxitv46",
    "credential_ref": "vault://ravi-electronics",   // NEVER the raw token in the file
    "reads": ["orders", "products"],
    "pii_available": false                            // Basic plan = no customer names
  },
  "identify_by": "order_number",                      // how a customer is matched (order # not name)
  "policies": {
    "return_policy": "Electronics can be returned within 10 days if unopened.",
    "refund_policy": "Refunds processed within 5-7 business days.",
    "warranty": "All products carry 1 year manufacturer warranty."
  },
  "faq": [
    {"q": "Do you deliver to villages?", "a": "Yes, 5-7 days across the state."},
    {"q": "Is COD available?", "a": "Cash on delivery for orders under Rs.10000."}
  ],
  "sla": { "first_response": "48h", "resolution": "30d" },
  "escalation": [
    {"level": 1, "to": "support agent", "after": "0h"},
    {"level": 2, "to": "grievance officer", "after": "48h", "contact": "grievance@ravi.example"},
    {"level": 3, "to": "National Consumer Helpline 1915", "after": "30d"}
  ],
  "created_at": "2026-07-26T00:00:00Z",
  "status": "active"
}
```

**Critical design rules for the schema:**
- **The raw API token NEVER goes in the manifest file.** Store it server-side (a vault /
  DB keyed by business_id); the manifest holds only a `credential_ref`. This is the
  security story judges will ask about.
- `identify_by: "order_number"` — because Shopify Basic plan blocks customer PII, the
  assistant matches customers by order number, not name. (This is a real constraint we hit.)
- `pii_available: false` tells the runtime not to attempt name lookups.
- `languages` is a first-class field — this is what makes UCXP different from MCP
  (which has no concept of language negotiation).
- `escalation` + `sla` encode Indian consumer-protection reality — also unique vs MCP.

---

## 5. Backend responsibilities (for later — after FE)

The dashboard FE talks to a small backend that:

1. **POST /connect/shopify** — validate a store subdomain+token, return
   `{ ok, product_count, order_count, currency }`. Stores the token server-side keyed by
   business_id; returns only a `credential_ref`.
2. **POST /generate-manifest** — take the form data, return the assembled `support.manifest`
   JSON (validated against the schema).
3. **POST /scrape-faq** — take a help URL, scrape it, run through the LLM (Sarvam 105B) to
   draft FAQ + policies, return editable JSON. (The shadow-manifest generator.)
4. **POST /activate** — save the manifest, mark business active, make it available to the runtime.
5. **GET /businesses** — list onboarded businesses for the dashboard home.
6. **POST /playground/query** — take {business_id, text/audio}, run the full runtime pipeline
   against that manifest, return the answer (for the test playground).

---

## 6. Visual / design direction (for Claude Design)

- **Tone:** clean, trustworthy, "infrastructure" feel — think Stripe/Plaid dashboards, not
  a flashy consumer app. This is a B2B tool merchants trust with their systems.
- **Layout:** two-pane wizard — form on the left, live JSON manifest preview on the right
  (so merchants see the artifact taking shape as they fill it).
- **Color:** one calm primary (deep teal or indigo), lots of white space, mono font for the
  JSON preview.
- **Progress:** a 6-step progress indicator across the top.
- **India-first cues:** language names shown in native script (తెలుగు, हिंदी, தமிழ்);
  rupee symbol; the escalation ladder referencing "National Consumer Helpline 1915".
- **Trust signals:** near the Shopify connect field, a small lock icon + "We never store
  customer personal data. We only read orders and products."
- **The manifest preview** is the hero — it visually reinforces that the output is a real,
  portable, standard file.

---

## 7. Demo narrative this dashboard enables

On stage:
1. "Here's how a business joins UCXP." Open dashboard → onboard "Ravi Electronics" live.
2. Connect Shopify (pre-filled in demo) → ✅ "found 3 products, 3 orders".
3. Tick capabilities, tick Telugu + Hindi, paste a couple of FAQ lines.
4. Click **Export** → the `support.manifest` appears on the right.
5. Click **Open in playground** → speak a Telugu question → assistant answers from the
   real store, in Telugu.
6. Line: "Any business — Shopify or not — joins by producing one manifest. The assistant
   speaks every Indian language. And we never touch their customers' personal data."

---

## 8. Build order (recommendation)

1. **This spec** → feed to Claude Design to generate the FE (wizard + preview + playground).
2. **Manifest schema** (Section 4) → lock it; both FE and runtime depend on it.
3. **Backend endpoints** (Section 5) → build after FE shape is set; wire to the Sarvam +
   Shopify code already written and tested.
4. **Playground** → connect to the existing runtime pipeline (the last piece we build).

---

## 9. What's already built and tested (foundation this sits on)

- 5 real Shopify stores (Meena, Lakshmi, Ravi, Sri, Anna) — real products, orders, INR,
  all queryable via Admin API.
- Sarvam voice pipeline: Saaras STT, 105B reasoning, Bulbul TTS, Mayura/Translate,
  language-ID — all verified end to end.
- Twilio WhatsApp (send + receive) working.
- ngrok tunneling ready.
- Known constraint: Shopify Basic plan blocks customer PII via API → the manifest uses
  `identify_by: order_number` and `pii_available: false`.

The dashboard is the onboarding layer that turns this proven foundation into a
self-serve protocol.
