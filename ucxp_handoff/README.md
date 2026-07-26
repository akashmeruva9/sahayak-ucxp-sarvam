# UCXP handoff — 5 merchant manifests + mock-API seed data

Everything the runtime needs to serve five **real** Shopify merchants. No Shopify
credentials required to use any of it: the order and product facts are already
baked into `seed/`.

```
ucxp_handoff/
├── manifests/          5 support manifests  ← the protocol contract
├── seed/               5 order/product files ← what the mock business API serves
├── registry.json       business_id → manifest + seed + capability index
├── real_data.json      raw Shopify dump the two above are generated from
├── dump_shopify.py     re-fetch real_data.json (needs ../stores.json + tokens)
├── build_manifests.py  real_data.json → manifests/ + seed/ + registry.json
└── validate.py         contract check; exit 0 = clean
```

## The five businesses

| business_id | Name | Category | Capabilities | Orders | Products |
|---|---|---|---|---|---|
| `ravi-electronics` | Ravi Electronics | Electronics | `track_order` · `request_refund` · `warranty_claim` | 3 | 3 |
| `lakshmi-fashion` | Lakshmi Fashion | Fashion | `track_order` · `request_exchange` · `cancel_order` | 4 | 3 |
| `sri-pharma` | Sri Pharma | Pharmacy | `track_order` · `reorder_prescription` · `cancel_order` | 3 | 3 |
| `anna-groceries` | Anna Groceries | Grocery | `track_order` · `reorder` · `cancel_order` | 3 | 3 |
| `meena-kitchen` | Meena Kitchen Store | Kitchen | `track_order` · `request_refund` · `cancel_order` | 9 ⚠ | 5 |

Every capability executes an action and returns a **receipt** — no capability
only talks, per `PLAN.md` §4.

## Which schema this is

**`PLAN.md` §5** — the runtime's declared contract. Chosen because that section
says it verbatim: *"This schema is what makes the runtime generic. Both the
runtime and every manifest conform to it."*

Top level: `ucxp_version` · `business` · `routing` · `auth` · `capabilities[]` ·
`endpoints[]` · `knowledge[]` · `escalation`.

> Three other manifest shapes exist across the project docs
> (`docs/02-manifest-spec.md`, `docs/06-manifest-generator.md`,
> `UCXP_Dashboard_Spec.md` §4). They are **not** interchangeable. If the runtime
> ends up reading a different one, say so and re-run `build_manifests.py` —
> the generator is one file and the shape is in `build_manifest()`.

## Using it

Drop the two folders into the repo root:

```bash
cp -r ucxp_handoff/manifests  ucxp_handoff/seed  /path/to/sahayak-ucxp-sarvam/
```

`manifests/` is what the loader reads. `seed/` is what `backend/app/mock/`
should serve, so that:

```
GET  {{mock_base}}/ravi-electronics/orders/1001
  → {"item": "boAt Airdopes 141 Earbuds", "status": "being prepared",
     "amount": 1299.0, "currency": "INR", "eta": "30 Jul", ...}
```

resolves the manifest's `response` template:

```
"Your order {{order_id}} — {{result.item}} — is {{result.status}}.
 Total ₹{{result.amount}}. Expected by {{result.eta}}."
```

The write actions (`cancel_order`, `create_refund`, `create_exchange`,
`create_warranty_claim`, `create_reorder`) are **not** in the seed — the mock API
generates those responses. The fields each one must return are listed in
`validate.py → ACTION_RESULT_KEYS`; that dict is the contract for what to
implement, and `validate.py` fails if a manifest asks for a field not listed there.

## What's real and what isn't

**Real** — pulled live from the Shopify Admin GraphQL API (`2026-01`) today:
product titles, prices, SKUs, stock, order numbers, line items, quantities,
fulfilment status, payment status, totals, currency, timestamps.

**Filler** — invented, safe to rewrite:
- all `knowledge[]` policy and FAQ text
- `routing.aliases` / `routing.domains`
- `business.glyph` and `business.color`
- three per-order fields, tagged in every record under `_synthetic_fields`:
  `eta` (Shopify carries no delivery estimate), `days_since_delivery`
  (drives the refund/exchange/warranty `rules`), `prescription_on_file`

Customer names are **absent by design** — the Shopify Basic plan blocks customer
PII over the API, so `auth.identify_by` is `order_id` and no manifest references
a customer name. This is a real constraint, not an oversight.

## ⚠ Meena Kitchen Store — don't demo it

It is the one contaminated store. **All 9 orders are unusable**, in two ways:

- `Meena_1007/1008/1009` — correct kitchen products, but **₹0.00 totals**
- `Meena_1001–1006` — Shopify's built-in **sample data** (snowboards, ski wax),
  three of them in **USD** rather than INR

Every affected order carries a `_flags` array (`zero_total`,
`shopify_sample_data`, `off_currency`) and `seed/meena-kitchen.json` has the full
list under `_warnings`. The manifest is valid and will load fine — the *data*
behind it is the problem.

**Use `ravi-electronics` as the primary demo store.** It is clean, it is INR, and
order `1001` is `boAt Airdopes 141 Earbuds · ₹1299 · being prepared`, which is
exactly the line the pitch script already promises.

One more thing worth knowing: outside Meena, **every order is
`being prepared` (`UNFULFILLED`)**. A track-order demo gives the same status for
all four stores, and no `days_since_delivery > 7` rule can ever fire. If you want
the refund/exchange denial paths to be demonstrable, some orders need marking
fulfilled in Shopify — or just edit `days_since_delivery` in the seed.

## Regenerating

```bash
python3.13 dump_shopify.py       # re-fetch from Shopify (needs ../stores.json)
python3.13 build_manifests.py    # rebuild manifests/ + seed/ + registry.json
python3.13 validate.py           # exit 0 = clean
```

`validate.py` checks what would otherwise show up as a blank chat bubble:
every `action` resolves to an endpoint, every `{{placeholder}}` resolves to a
collected input or a documented `result.*` field, every endpoint URL only
interpolates inputs the capability actually collects, and every `rule.when`
tests a field its action returns.
