# Publishing manifests to the runtime

The enterprise dashboard is the source of truth for manifests. It publishes to
a Supabase table; the UCXP runtime reads from it on startup and on demand.

This file is the **contract between the two codebases**. If the dashboard writes
different column names than the runtime reads, nothing loads and it looks like a
runtime bug — so change this file first, then both sides.

## The table

`db/schema.sql` creates it. One row per business:

| Column | Type | Written by the dashboard |
|---|---|---|
| `business_id` | `text` primary key | the slug, e.g. `ravi-electronics` |
| `manifest` | `jsonb` | **the whole assembled manifest**, exactly as `GET /api/admin/merchant/{id}/manifest` returns it |
| `status` | `text` | `active` on Activate, `draft` otherwise |
| `version` | `integer` | the activation version the dashboard already tracks (section 7) |
| `name`, `category` | `text` | optional, for dashboard listing only — the runtime reads them from the manifest |
| `updated_at` | `timestamptz` | defaults to `now()` |

**Only `status = 'active'` is loaded.** A draft in the dashboard must never
become a live business in the app.

## What the dashboard should do on Activate

`POST /api/business/{id}/activate` already validates, versions and assembles the
manifest. Add one write after the existing `manifest_mod.validate(built)` passes:

```python
# Dashboard/backend/store.py (or a new publish.py)
import os, httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]   # service role — server-side only

def publish(business_id: str, manifest: dict, version: int, name: str = "", category: str = ""):
    """Upsert the published manifest so the runtime picks it up."""
    httpx.post(
        f"{SUPABASE_URL}/rest/v1/ucxp_manifests",
        params={"on_conflict": "business_id"},
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            # merge-duplicates makes this an upsert rather than a conflict
            "Prefer": "resolution=merge-duplicates",
        },
        json={
            "business_id": business_id,
            "manifest": manifest,
            "status": "active",
            "version": version,
            "name": name,
            "category": category,
        },
        timeout=10,
    ).raise_for_status()
```

Deactivating is the same call with `"status": "draft"` — the runtime drops it on
the next refresh.

## How the runtime picks it up

- **On startup** — `lifespan` calls `registry.refresh_from_store()`.
- **On demand** — `POST /manifests/reload` returns
  `{"loaded": [...], "from_database": n}`. Use this on stage: activate in the
  dashboard, hit reload, and the business appears without a redeploy.

Local `manifests/*.json` are loaded **first and always**, then database rows are
layered on top (same `business_id` wins). So:

- Supabase unreachable or unset ⇒ the committed demo set still serves. Startup
  never fails on the database.
- `GET /manifests/{id}` keeps returning the original JSON either way, which is
  what PLAN.md §8 step 8 shows a judge.

## Environment

Runtime (Railway):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service-role key>
# optional, defaults shown
UCXP_MANIFEST_TABLE=ucxp_manifests
UCXP_SUPABASE_TIMEOUT=10
```

Dashboard needs the same two, since it writes with the service role.

The **service role key bypasses RLS and must never reach a client** — it belongs
in Railway/dashboard server env only. The app uses the anon key.
