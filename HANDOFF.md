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

**Backend — all green.** `./venv/bin/python -m pytest tests/backend -v` → 22 passed, 1 skipped.

| Gate | Status |
|---|---|
| B1 five stores return real orders | PASS |
| B2 bad token → `{ok:false}`, HTTP 200, no trace | PASS |
| B3 no PII field in any GraphQL query | PASS |
| B4 manifest validates, has credential_ref, no `shpat_` | PASS |
| B5 activate writes both files, reloads, idempotent | PASS |
| B6 200 businesses create and list | PASS |

**Frontend — 7 of 11 verified.** `npx playwright test`

| Gate | Status |
|---|---|
| F1 every screen renders, zero console errors | PASS |
| F4 Shopify Customize unlocks all / Reset restores | PASS |
| F5 13 languages native script, no clipped matras | PASS |
| F6 preview byte-identical to download | PASS |
| F7 spinner + disabled button on async | PASS |
| F10 no dead buttons | PASS |
| F11 layout matches the design reference | PASS |
| F2 all 7 sections save and reload | **fix applied, NOT re-verified** |
| F3 custom REST fully editable | **fix applied, NOT re-verified** |
| F8 friendly inline errors | **fix applied, NOT re-verified** |
| F9 responsive at 375px | **never run** |
| E1 Ravi Electronics end to end ×3 | **never run** |
| E2 custom REST end to end ×3 | **never run** |

## The three fixes that are applied but unverified

1. **F2/F3 root cause — autosave signal.** The header reads "All changes saved"
   in the idle state as well as the saved state, so the test helper's
   `waitForSave` returned before anything had been queued; the test then reloaded
   and the pending edit was lost. Fixed by adding real dirty-tracking in
   `frontend/src/state/useBusiness.js` (a `dirty` flag set on every queued edit,
   cleared only when every queued section has come back from the server),
   surfaced as `data-dirty` on the `save-state` element, and `waitForSave` in
   `tests/e2e/helpers.js` now waits past the 600ms debounce and then for
   `data-dirty="false"`.
2. **F8 — test strictness only.** Two error panels legitimately render (one in the
   consent dialog, one on the section behind it); the assertion is now scoped to
   the dialog.
3. Also fixed earlier and already verified: `.ucxp-native` set `line-height` in
   Tailwind's components layer, where the `text-base` utility overrode it. Native
   leading is now an explicit `leading-[1.9]` utility at each call site.

## Exactly what is left

```bash
# 1. re-verify the three fixed gates
npx playwright test --project=desktop -g "F2 |F3 |F8 "

# 2. the responsive gate
npx playwright test --project=mobile

# 3. the journeys, 3 runs each (they hit the real Shopify store)
npx playwright test --project=desktop -g "E1 |E2 "

# 4. full suite, must be green in one run
./venv/bin/python -m pytest tests/backend -v
npx playwright test
```

Loop on any failure: fix → re-run the **full** suite, not just the failing gate.
Then report a final table of all 19 gates with PASS/FAIL.

Two things are known-unbuilt and were agreed out of scope: the playground /
"Send to UCXP runtime" screens (in the old spec, absent from the approved design
and from the brief's screen list).

## Layout of what was built

```
backend/     constants.py  manifest.py  shopify_client.py  vault.py  store.py  main.py
frontend/    src/{routes,sections,components,state,lib}  tailwind.config.js
tests/       backend/test_backend.py   e2e/{gates,responsive,e2e}.spec.js  e2e/helpers.js
manifests/   activation writes <id>.json and <id>.protocol.json here
run.sh       preflight + both servers
```

Existing root files (`fetch.py`, `stores.json`, `docs/`, `ucxp_handoff/`) were
left in place and are imported, never moved.
