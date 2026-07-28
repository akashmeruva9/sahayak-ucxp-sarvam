# UCXP Dashboard — build handoff

State as of the last commit on branch `dashboard`. Read this first if you are
picking the build up in a fresh session.

## What this is

A merchant self-serve dashboard that produces a validated `support.manifest`.
Rebuilt from the approved Claude Design prototype (`UCXP prototype review` →
`UCXP Onboarding.dc.html`) as React + FastAPI + SQLite, with the design's indigo
palette replaced by the Sarvam monochrome theme.

## Run it

```bash
./run.sh                 # preflight, then uvicorn :8000 + vite :5173
./run.sh --check         # preflight only
```

Preflight refuses to start if `.env` or `stores.json` are missing, unparseable,
or — importantly — tracked by git.

## Decisions already locked (do not relitigate)

| Decision | Choice |
|---|---|
| Manifest schema | Flat `UCXP_Dashboard_Spec.md` §4 shape, with `capabilities` promoted from strings to full contract objects. Activation additionally writes `manifests/<id>.protocol.json` in the formal `docs/02-manifest-spec.md` schema. |
| Frontend/E2E testing | Playwright headless, `tests/e2e/` |
| 200-business gate | Test suite uses a temp DB; `backend/seed_demo.py` is the optional dev-DB seeder |
| Design precedence | The design file + the original brief beat the older markdown specs. `UCXP_Dashboard_Spec.md` describes a 6-step wizard with no completion % and no admin console; the design has 7 sections, a completion ring and an admin console. **Build the design's version.** |

## Facts worth not rediscovering

- The brief refers to `fetch_all.py`; **it does not exist**. The canonical Shopify
  logic is `ucxp_handoff/dump_shopify.py`, ported into `backend/shopify_client.py`.
- All 5 Shopify stores are **live** (verified: 200 OK, INR). Ravi Electronics
  returns 3 products / 3 orders.
- **Meena Kitchen is not demo-safe** — ₹0.00 totals, Shopify sample snowboards,
  three USD orders. Use `ravi-electronics-bmxitv46`, order `1001`
  (boAt Airdopes 141 Earbuds, ₹1299).
- Order numbers **collide across stores** (`1001` exists in four), so any lookup
  keys on `(business_id, order_number)`.
- The orders GraphQL query deliberately requests **no** customer fields. Gate B3
  fails the build if that changes.
- Python is 3.12 in `./venv`. System python is 3.9 and has no FastAPI.

## Gate status

**All green in one run.**

- `./venv/bin/python -m pytest tests/backend -q` → **129 passed, 1 skipped**
- `npx playwright test` → **26 passed**

| Gate | Status |
|---|---|
| B1 five stores return real orders | PASS |
| B2 bad token → `{ok:false}`, HTTP 200, no trace | PASS |
| B3 no PII field in any GraphQL query | PASS |
| B4 manifest validates, has credential_ref, no `shpat_` | PASS |
| B5 activate writes both files, reloads, idempotent | PASS |
| B6 200 businesses create and list | PASS |
| B8 Google sign-in, roles, and the default-deny gate | PASS |
| B9 Supabase mirror: manifests on activate, users on sign-in | PASS |
| F1 every screen renders, zero console errors | PASS |
| F2 all 7 sections save and reload | PASS |
| F3 custom REST fully editable | PASS |
| F4 Shopify Customize unlocks all / Reset restores | PASS |
| F5 13 languages native script, no clipped matras | PASS |
| F6 preview byte-identical to download | PASS |
| F7 spinner + disabled button on async | PASS |
| F8 friendly inline errors | PASS |
| F9 responsive at 375px | PASS |
| F10 no dead buttons | PASS |
| F11 layout matches the design reference | PASS |
| F12 the sign-in gate in the React app | PASS |
| F13 the admin Users tab | PASS |
| E1 Ravi Electronics end to end ×3 | PASS |
| E2 custom REST end to end ×3 | PASS |

The one skip is B1's live-Shopify case when no token is present in the
environment; it runs on any machine that has `.env`.

## The Supabase mirror

SQLite stays the source of truth. Supabase is a copy, written best-effort:
`Dashboard/backend/supabase.py` never raises and never blocks a request, so the
dashboard works unchanged when the project is unreachable or unconfigured.

- **Manifests** — `ucxp_manifests` (schema on `main`, `db/schema.sql`). Written
  on activate *and* on every later edit of an active business, upserted on
  `business_id`. Drafts are never published. Deleting a business deletes the row.
- **Users** — `ucxp_dashboard_users` (`db/dashboard-users.sql`, run it once in
  the Supabase SQL editor). Written on sign-in, on a background thread.

Both need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment.
Without them `supabase.enabled()` is false, the activate response says
`database.configured: false`, and nothing is sent anywhere.

Permission is never read from either table. It is decided per request from
`UCXP_ADMIN_EMAILS`, so removing someone takes effect on their next click rather
than whenever their session expires.

Two things are known-unbuilt and were agreed out of scope: the playground /
"Send to UCXP runtime" screens (in the old spec, absent from the approved design
and from the brief's screen list).

## Layout of what was built

```
backend/     constants.py  manifest.py  shopify_client.py  vault.py  store.py  main.py
             auth.py  envfile.py  supabase.py
frontend/    src/{routes,sections,components,state,lib}  tailwind.config.js
tests/       backend/*.py   e2e/{gates,responsive,e2e,auth}.spec.js  e2e/helpers.js
db/          dashboard-users.sql — run once in the Supabase SQL editor
manifests/   activation writes <id>.json and <id>.protocol.json here
run.sh       preflight + both servers
```

Existing root files (`fetch.py`, `stores.json`, `docs/`, `ucxp_handoff/`) were
left in place and are imported, never moved.
