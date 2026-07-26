# UCXP

Merchant self-serve dashboard that produces a validated `support.manifest`.
React + Vite + Tailwind (:5173) · FastAPI (:8000) · SQLite. Branch: `dashboard`.

**→ Read `HANDOFF.md` before doing anything.** It carries the locked decisions,
the current gate status, and the exact work remaining.

## Commands

```bash
./run.sh                                  # preflight + both servers
./venv/bin/python -m pytest tests/backend -v   # backend gates B1-B6
npx playwright test                            # frontend gates F1-F11, E1, E2
```

Python is 3.12 in `./venv`. System python is 3.9 and has no FastAPI — always use
`./venv/bin/python`. Run everything from the repo root.

## Hard rules

- **`.env` and `stores.json` hold live Shopify tokens. Never commit them.**
  They are gitignored and `run.sh` refuses to start if either becomes tracked.
- **A raw token never enters a manifest, a response, or a log.** The vault
  (`Dashboard/backend/vault.py`) is the only place secrets live; everything else carries a
  `credential_ref` of the form `vault://<business_id>`. Gate B4 enforces this.
- **Never add customer fields to a Shopify GraphQL query.** The Basic plan blocks
  customer PII, so customers are identified by order number
  (`identify_by: "order_number"`, `pii_available: false`). Gate B3 enforces this.
- **No capability contract field is ever permanently read-only.** Shopify-seeded
  contracts start locked but "Customize" unlocks every field; Custom REST and
  No-data-source contracts start blank and editable. Gates F3/F4 enforce this.
- **All colour comes from `Dashboard/frontend/tailwind.config.js`.** No component hardcodes
  a hex value.

## Design source of truth

The approved prototype is the Claude Design project `UCXP prototype review` →
`UCXP Onboarding.dc.html` (readable via the DesignSync tool). Where it disagrees
with the older markdown specs in `docs/`, **the design wins** — see HANDOFF.md.

## Data gotchas

- Use `ravi-electronics-bmxitv46` for demos. **Meena Kitchen is not demo-safe**
  (₹0.00 totals, Shopify sample data, three USD orders).
- Order numbers collide across stores — always key on `(business_id, order_number)`.
- The brief mentions `fetch_all.py`; it does not exist. The real client is
  `ucxp_handoff/dump_shopify.py`, ported to `Dashboard/backend/shopify_client.py`.
