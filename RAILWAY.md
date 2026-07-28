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
GOOGLE_CLIENT_ID=000000000000-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here
UCXP_ADMIN_EMAILS=you@gmail.com
UCXP_REQUIRE_AUTH=1
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

### The four sign-in variables

| Variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console → **Clients**. Ends `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Beside it. Starts `GOCSPX-` |
| `UCXP_ADMIN_EMAILS` | Comma-separated. These addresses see every merchant and the admin console; everyone else sees only what they created |
| `UCXP_REQUIRE_AUTH` | `1` on any host. Makes a missing variable a **refusal to boot** rather than a dashboard that is quietly open |

`UCXP_REQUIRE_AUTH=1` is the one people skip. Without it, deleting
`GOOGLE_CLIENT_SECRET` by accident does not break anything visibly — it just
turns sign-in off and serves every merchant to anyone with the URL.

The OAuth client needs the return address registered, exactly, under
**Authorized redirect URIs**:

```
https://<your-domain>.up.railway.app/api/auth/callback
http://localhost:5173/api/auth/callback
http://127.0.0.1:5173/api/auth/callback
```

The server derives that URI from the incoming `Host` and `X-Forwarded-Proto`, so
it matches without further configuration. A **custom domain** is the exception:
add it to the Google client too, or set `UCXP_AUTH_BASE_URL` to pin one origin.

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
| Google says **redirect_uri_mismatch** | The URI on the OAuth client is not character-for-character `https://<domain>/api/auth/callback`. A trailing slash or a missing `/api` is enough |
| Deploy crash-loops, log names a variable | `UCXP_REQUIRE_AUTH=1` with sign-in unconfigured. That is the intended behaviour — set the missing variable |
| Signed in, but the dashboard is empty | Those merchants predate sign-in, so they are unowned. Add yourself to `UCXP_ADMIN_EMAILS` |
| *"The admin console is limited to…"* | You are signed in with a Google account not in `UCXP_ADMIN_EMAILS` |

Logs: service → **Deployments** → click the active one → **View Logs**.

---

## What is and is not protected

With the four sign-in variables set, every `/api` route except `/api/health` and
the sign-in dance itself requires a session. A merchant reaches only businesses
they created; the admin console is limited to `UCXP_ADMIN_EMAILS`. That closes
what this section used to warn about — `/api/meta` leaking your store
subdomains, and an anonymous `POST /api/connect/shopify` with an empty token
spending your real Shopify credentials.

**Without those variables there is still no login at all.** That is deliberate,
so local development and the test suite run unchanged — and it is exactly why
`UCXP_REQUIRE_AUTH=1` belongs on every host.

Three things sign-in does *not* fix:

- The vault stores Shopify tokens **in plaintext** on the volume. Fine for a
  demo; needs encryption before real merchants.
- Businesses created **before** sign-in existed have no owner, so they are
  visible to admins only. Sign in as an admin to see them.
- Published manifests under `manifests/` are public artifacts by design. No
  token has ever been in one — gate B4 enforces that.
