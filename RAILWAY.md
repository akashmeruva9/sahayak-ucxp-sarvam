# Deploying the UCXP dashboard to Railway

The dashboard runs as **its own Railway service**, alongside the runtime service
already deployed from `main`. Different branch, different tree, different
healthcheck — they cannot collide.

Everything here was verified by building the real image and running it with a
volume before writing this. `DEPLOY.md` is the AWS alternative if you ever want it.

---

## What's already done in the repo

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage: Node builds the frontend, Python serves it |
| `railway.json` | Builder = Dockerfile, healthcheck `/api/health` |
| `requirements.txt` | fastapi, uvicorn, pydantic, httpx |

The Dockerfile already sets `UCXP_DB=/data/ucxp.db` and
`UCXP_MANIFEST_DIR=/data/manifests`, so you do **not** need to set those by hand.

---

## Step 1 — Create the service

1. Open your existing Railway project (the one with the runtime service).
2. **New** → **GitHub Repo** → pick `akashmeruva9/sahayak-ucxp-sarvam`.
3. Once it appears, open the service → **Settings**:
   - **Branch**: `dashboard-restructure`  ← **not `main`**
   - **Root Directory**: leave empty
   - **Builder**: it should already read *Dockerfile* from `railway.json`
4. Rename the service to `dashboard` so you can tell the two apart.

> If Railway picked `main`, it will build the runtime instead and the healthcheck
> will fail on `/api/health`. Change the branch, then redeploy.

## Step 2 — Attach the volume (do this before the first successful deploy)

Without a volume, **every redeploy wipes all merchants and manifests** — the
container filesystem is replaced each deploy.

1. Service → **Variables** tab → **+ New Volume** (or right-click the service → *Attach Volume*).
2. **Mount path**: `/data`
3. Save.

## Step 3 — Set the variables

Service → **Variables** → **Raw Editor**, paste, and edit the values:

```
SARVAM_API_KEY=sk_your_key_here
UCXP_STORES_JSON_CONTENT={"meena-kitchen-store":"shpat_...","lakshmi-fashion-4kmotaah":"shpat_...","ravi-electronics-bmxitv46":"shpat_...","sri-pharma":"shpat_...","anna-groceries":"shpat_..."}
```

**Do not wrap values in quotes.** A quoted key is sent to Sarvam verbatim and
rejected with a 403 that surfaces as *"The FAQ importer isn't configured"* — the
code now strips them defensively, but don't rely on it.

For `UCXP_STORES_JSON_CONTENT`, paste the **entire contents of your local
`stores.json` on one line**. Get it with:

```bash
cat stores.json | tr -d '\n'
```

**Alternative:** if you'd rather reuse the runtime's variables, set the five
`SHOPIFY_TOKEN_RAVI_ELECTRONICS`-style variables instead — the dashboard reads
those too. Note Railway variables are **per-service**, so you must either copy
them onto this service or promote them to shared variables at the project level.

## Step 4 — Deploy and get a URL

1. **Deploy**. The first build takes ~2 minutes (npm install + pip install).
2. Service → **Settings** → **Networking** → **Generate Domain**.
   You'll get something like `dashboard-production-a1b2.up.railway.app`.

## Step 5 — Point the manifest URLs at your real domain

Add one more variable, using the domain from step 4:

```
UCXP_PUBLIC_BASE_URL=https://dashboard-production-a1b2.up.railway.app
```

Redeploy. Without this, the Success screen and every published manifest advertise
`https://api.ucxp.in/...`, which nothing serves.

---

## Step 6 — Verify

```bash
BASE=https://your-domain.up.railway.app

curl -s $BASE/api/health                      # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/        # 200 — the app loads
curl -s -o /dev/null -w "%{http_code}\n" $BASE/admin   # 200 — SPA fallback works

# the five demo stores resolved from the env var
curl -s $BASE/api/meta | python3 -c "import json,sys; print([s['subdomain'] for s in json.load(sys.stdin)['seeded_stores']])"
```

Then in the browser: onboard a business, connect `ravi-electronics-bmxitv46`,
import FAQs from a real storefront, and activate.

**The persistence test that matters** — click *Redeploy* in Railway, wait, then
reload. Your businesses must still be there. If they vanish, the volume is not
mounted at `/data`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Healthcheck fails, build succeeded | Branch is `main` — that service answers `/health`, not `/api/health` |
| Everything gone after a redeploy | Volume missing or not mounted at `/data` |
| *"The FAQ importer isn't configured"* | `SARVAM_API_KEY` missing, or pasted with quotes |
| Shopify connect fails, dropdown empty | `UCXP_STORES_JSON_CONTENT` missing or not valid JSON on one line |
| Success screen shows `api.ucxp.in` | `UCXP_PUBLIC_BASE_URL` not set |
| `/admin` 404s on hard refresh | Old image — the SPA fallback is in this build |

Logs: service → **Deployments** → click the active one → **View Logs**.

---

## What is NOT protected

You decided this is an open demo, so stating it plainly: **anyone with the URL
can read every merchant, edit them, and delete them.** There is no login.

Two specifics worth knowing while it's public:

- `GET /api/meta` lists your five real Shopify store subdomains.
- `POST /api/connect/shopify` with an **empty token** makes the server look up
  your real Shopify credential and use it. An anonymous caller gets free
  authenticated reads against your stores and can burn your API rate limit.

The token itself never leaves the server, and no manifest ever contains one —
gate B4 enforces that. But if the demo is going to sit up for a while, the
cheapest fix is a single env-var password checked in middleware.

Also: the vault stores Shopify tokens **in plaintext** on the volume. Fine for a
demo; needs encryption before real merchants.
