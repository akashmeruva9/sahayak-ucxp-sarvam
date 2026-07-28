# Deploying the UCXP Dashboard to AWS

Written for someone who has not used AWS before. Every price here was checked
against AWS's own pricing API and docs on **28 July 2026** — not from memory.

Substitute anything in `<ANGLE_BRACKETS>` with your own value.

---

## Read this first: the free tier is not what the tutorials say

**The classic 12-month free tier no longer exists for new accounts.** AWS
replaced it on **15 July 2025**. There is no 750-hours-of-EC2, no 30 GB of free
EBS, none of it. Every blog post you find will be wrong about this.

What a new account gets instead:

| | |
|---|---|
| Sign-up credit | **$100**, plus up to $100 more in $20 chunks for trying services |
| Credits expire | 12 months |
| Free plan lasts | **6 months, or until credits run out — whichever is first** |
| Charges during it | **None.** |

The important consequence, quoted from AWS's docs:

> After your free account plan expires, your account closes automatically, and
> you lose access to your resources and data.

So the Free plan **cannot surprise you with a bill** — it fails closed. The real
risk is the opposite one: **at month six AWS deletes your account and your data
with it.** Back up before then (step 8).

**At sign-up you must pick "Free account plan", not "Paid account plan."** That
is the single most important click in this document.

### The trap: public IPv4 is not free

Since February 2024 AWS charges **$0.005/hour for every public IPv4 address** —
attached or not. Verified today from the pricing API for `ap-south-1`. That is
**$3.65/month**, and there is no free allowance for it on a new account. Any
design that puts a reachable server on the internet pays this. Accept it; it
comes out of credits.

### What you will actually spend

| Line item | $/month |
|---|---|
| EC2 t3.micro (Mumbai) | 8.18 |
| EBS 8 GB gp3 | 0.73 |
| Public IPv4 | 3.65 |
| Data out (first 100 GB always free) | 0.00 |
| HTTPS cert, hostname, budgets, alarms | 0.00 |
| **Total** | **$12.56/mo ≈ ₹1,100** |

**All of it absorbed by credits. You pay ₹0.** Six months costs $75 of your $100.

---

## Step 1 — Arm the cost tripwires before anything else

### 1.1 Sign up
`https://aws.amazon.com/free` → Create account. A card is required even on the
free plan (Indian cards get a ~₹2 verification charge, refunded). Support plan:
**Basic (Free)**. Account plan: **Free**.

### 1.2 Billing alerts
Account menu → **Billing and Cost Management** → **Billing preferences** →
tick **Receive AWS Free Tier alerts** and **Receive CloudWatch billing alerts** → Save.

### 1.3 A $1 budget (free — monitoring and notifications carry no charge)
Billing → **Budgets** → Create budget → **Customize (advanced)** → **Cost budget**
→ name `hard-zero-guard`, **Monthly**, **Fixed**, amount **1.00**.
Add two alert thresholds at **1%**: one **Actual**, one **Forecasted**, both to your email.

Do not add "budget actions" — those cost $0.10/day beyond the first two.

### 1.4 A CloudWatch billing alarm (second, independent tripwire)
Billing metrics live **only in us-east-1**. Switch region to **US East (N. Virginia)**.

CloudWatch → Alarms → Create alarm → Select metric → **Billing** → **Total
Estimated Charge** → **USD**. Statistic **Maximum**, period **6 hours**, static,
**greater than 1**. Create an SNS topic `billing-alerts` with your email.

**Then check your inbox and click the confirmation link** — the alarm does nothing until you do.

### 1.5 MFA on the root account
Account menu → Security credentials → Assign MFA device. Do it now. Never create
access keys for root.

---

## Step 2 — Region

**Use `ap-south-1` (Mumbai).** Lowest latency for you and for Indian merchants,
your Shopify stores are Indian, and data stays in India. It costs $0.58/month
more than us-east-1, which is irrelevant against credits.

Exception: the billing alarm in 1.4 must be in us-east-1. Everything else in Mumbai.
**Always check the region selector top-right before creating anything.**

---

## Step 3 — The architecture

```
Browser ──HTTPS──▶ Caddy :443   (automatic Let's Encrypt cert)
                     │
                     ├── /api/*  ──▶ uvicorn 127.0.0.1:8000   (systemd)
                     └── /*      ──▶ /srv/ucxp/dist/          (SPA fallback)

State, outside the code tree:  /srv/ucxp/data/ucxp.db   /srv/ucxp/manifests/
```

**Why one box with a reverse proxy, and not S3+CloudFront:**

The frontend calls the API on a **relative path** — `api.js:8` is `const BASE = '/api'`,
and there is not one hardcoded host anywhere in `src/`. Serve `dist/` and proxy
`/api` from the **same origin** and the app works with **zero code changes**, and
the localhost-only CORS list in `main.py:30-33` is never even consulted.

Splitting the frontend onto CloudFront would mean editing `api.js`, editing
`ALLOWED_ORIGINS`, and debugging CORS preflight — three changes this design needs
none of. It also would **not** save the IPv4 charge, because the API still needs a
reachable origin.

**Do not use:** Lightsail (flat $5/mo, not free), RDS (you have SQLite), NAT
Gateway (~$40/mo — your instance goes in a *public* subnet).

### ⚠️ Check your vCPU quota before launching

New Free-plan accounts are reported to have a **1 vCPU quota**, and `t3.micro`
has 2 vCPUs — it will fail to launch. I could not verify this against official
AWS docs (the re:Post threads block automated fetching), so check it yourself:

Console → **Service Quotas** → EC2 → *"Running On-Demand Standard (A, C, D, H, I,
M, R, T, Z) instances"* → read the applied value.

- **≥ 2** → launch `t3.micro`.
- **= 1** → request an increase to 8, or just launch **`t2.micro`** (1 vCPU, same
  1 GiB RAM, $9.05/mo). For a demo, take t2.micro and move on.

Avoid `t4g.micro` despite being cheapest — it is ARM, and you would hit
architecture friction you don't need.

---

## Step 4 — Build the frontend locally, don't build on the server

I measured the build: **peak RSS 343 MB, 0.6 seconds, output 292 KB in 3 files.**
So it *would* fit in 1 GB. Build locally anyway — building on the server means
installing Node and pulling **79 MB of node_modules** to produce a quarter-megabyte
you could copy in a second.

```bash
cd Dashboard/frontend
npm ci && npm run build
ls -lh dist          # ~292K, 3 files
```

**Add 1 GB of swap on the server regardless** ($0.09/mo). It stops the Linux OOM
killer from silently killing uvicorn under a spike — a genuinely nasty thing to debug:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Step 5 — Key, security group, launch

**5.1** EC2 → **Key Pairs** → Create → `ucxp-key`, RSA, `.pem`. Downloads once.
```bash
mkdir -p ~/.ssh && mv ~/Downloads/ucxp-key.pem ~/.ssh/
chmod 400 ~/.ssh/ucxp-key.pem      # SSH refuses looser permissions
```

**5.2** Find your own IP: `curl -s https://checkip.amazonaws.com`

**5.3** EC2 → **Launch instances**:

| Field | Value |
|---|---|
| Name | `ucxp-dashboard` |
| AMI | **Ubuntu Server 24.04 LTS**, 64-bit x86 |
| Type | `t3.micro` (or `t2.micro`, step 3) |
| Key pair | `ucxp-key` |
| Auto-assign public IP | **Enable** |
| Storage | 8 GiB gp3 |

**Choose Ubuntu 24.04, not Amazon Linux** — it ships Python 3.12 as the system
Python, exactly what this app needs. Amazon Linux 2023 gives you 3.9 and an
afternoon of adding repos.

Security group `ucxp-sg`, inbound:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | **My IP** — never `0.0.0.0/0` |
| HTTP | 80 | `0.0.0.0/0` (needed for the Let's Encrypt challenge) |
| HTTPS | 443 | `0.0.0.0/0` |

> **Read the security section at the bottom before you open 80/443 to the world.**

**5.4** Connect. Add to `~/.ssh/config`:
```
Host ucxp
  HostName <EC2_PUBLIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/ucxp-key.pem
```
Then `ssh ucxp`.

> Your public IP **changes on stop/start** (reboot is fine). An Elastic IP costs
> the same $0.005/hr, so attach one if you want stability — just remember to
> **release it at teardown** or it bills forever as idle.

---

## Step 6 — Install and run

**6.1 Base**
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install python3.12 python3.12-venv python3-pip git ufw sqlite3
```

**6.2 Layout — keep state out of the code directory.** This is what makes
redeploys and backups painless.
```bash
sudo mkdir -p /srv/ucxp && sudo chown ubuntu:ubuntu /srv/ucxp
mkdir -p /srv/ucxp/{data,manifests,dist,secrets}
```
- `/srv/ucxp/app` — code (disposable, replaced each deploy)
- `/srv/ucxp/data/ucxp.db` — database (**survives everything**)
- `/srv/ucxp/manifests/` — activated manifests (**survives everything**)

**6.3 Code onto the box.** Private repo → use a **deploy key**:
```bash
ssh-keygen -t ed25519 -C "ucxp-ec2" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
Paste into GitHub → repo Settings → Deploy keys → **without** write access. Then:
```bash
git clone -b dashboard-restructure git@github.com:<USER>/<REPO>.git /srv/ucxp/app
```

**6.4 Python.** There is **no `requirements.txt`** in this repo. The served app
imports only three third-party packages — everything else is stdlib:
```bash
cd /srv/ucxp/app
python3.12 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install fastapi 'uvicorn[standard]' pydantic httpx
./venv/bin/pip freeze > /srv/ucxp/requirements.lock.txt
```
(`httpx` is for the new knowledge-base scraper in `Dashboard/backend/scraper.py`.)

**6.5 Frontend**
```bash
# local
rsync -avz --delete -e "ssh -i ~/.ssh/ucxp-key.pem" \
  Dashboard/frontend/dist/ ubuntu@<EC2_PUBLIC_IP>:/srv/ucxp/dist/
```

**6.6 systemd**
```bash
sudo tee /etc/systemd/system/ucxp.service > /dev/null <<'EOF'
[Unit]
Description=UCXP Dashboard API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/srv/ucxp/app
Environment="UCXP_DB=/srv/ucxp/data/ucxp.db"
Environment="PYTHONUNBUFFERED=1"
ExecStart=/srv/ucxp/app/venv/bin/python -m uvicorn Dashboard.backend.main:app \
          --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/srv/ucxp

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now ucxp
curl -s localhost:8000/api/health     # {"ok":true}
```

**`--workers 1` is deliberate.** `store.py` holds one SQLite connection per thread
in a `threading.local()`. Multiple worker *processes* writing the same SQLite file
produce `database is locked`. One worker is ample for a demo.

**Manifest path caveat.** `main.py:27-28` derives `MANIFEST_DIR` from `__file__`
with no env override, so it writes inside the code tree. Symlink it onto durable
storage — and redo this after every git-based deploy:
```bash
rm -rf /srv/ucxp/app/manifests && ln -s /srv/ucxp/manifests /srv/ucxp/app/manifests
```

**6.7 Caddy — the entire web tier**
```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
<YOUR_HOSTNAME> {
    encode zstd gzip
    handle /api/* { reverse_proxy 127.0.0.1:8000 }
    handle {
        root * /srv/ucxp/dist
        try_files {path} /index.html
        file_server
    }
}
EOF

sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

`try_files … /index.html` is what stops a hard refresh on `/admin` or
`/business/ravi-electronics` from 404ing — the app uses `BrowserRouter`. Caddy
handles the certificate, the HTTP→HTTPS redirect and renewal with no further config.

**6.8 Host firewall**
```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## Step 7 — A free hostname with real HTTPS

Let's Encrypt **will not issue a certificate for a bare IP**, so you need a name.

**Option A — sslip.io (recommended: no signup, no config).** Wildcard DNS that
decodes the IP out of the name. If your instance is `13.234.56.78`, then
`13-234-56-78.sslip.io` resolves to it. Put that in the Caddyfile, reload, done.
Watch the cert arrive with `sudo journalctl -u caddy -f`.

**Option B — DuckDNS.** Free account, pick `ucxp-demo.duckdns.org`, point it at
your IP. Better than A if your IP might change — you just update it there.

**Option C — CloudFront's `*.cloudfront.net`.** No DNS work at all, AWS-managed
cert. Use as a fallback if Let's Encrypt misbehaves. Footgun: you must set the
`/api/*` cache behavior to forward everything and cache nothing, or your API
responses get cached and the app behaves bizarrely.

**Do not use Route 53** — $0.50/hosted zone/month, no free tier, no reason to pay it.

---

## Step 8 — Backups (do not skip: AWS deletes the account at month 6)

The DB is in **WAL mode**, so `cp` alone loses everything sitting in `-wal`. Use
SQLite's online backup:

```bash
sudo tee /usr/local/bin/ucxp-backup > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ); OUT=/srv/ucxp/backups; mkdir -p "$OUT"
sqlite3 /srv/ucxp/data/ucxp.db ".backup '$OUT/ucxp-$STAMP.db'"
tar -czf "$OUT/ucxp-$STAMP.tgz" -C /srv/ucxp "backups/ucxp-$STAMP.db" manifests
rm -f "$OUT/ucxp-$STAMP.db"
ls -t "$OUT"/ucxp-*.tgz | tail -n +8 | xargs -r rm --
echo "$OUT/ucxp-$STAMP.tgz"
EOF
sudo chmod +x /usr/local/bin/ucxp-backup && ucxp-backup

( crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/ucxp-backup >> /var/log/ucxp-backup.log 2>&1" ) | crontab -
```

Pull them down periodically:
```bash
scp -i ~/.ssh/ucxp-key.pem 'ubuntu@<EC2_PUBLIC_IP>:/srv/ucxp/backups/*.tgz' ~/Desktop/ucxp-backups/
```

> **Backups contain plaintext Shopify admin tokens** (the `vault` table). Treat
> the `.tgz` files exactly as you treat `stores.json`. Never in the repo, never
> in a shared drive.

---

## Step 9 — Secrets

`.env` and `stores.json` are gitignored, and `run.sh:45-53` refuses to start if
git ever tracks them. Keep that property — copy them out of band:

```bash
# local
scp -i ~/.ssh/ucxp-key.pem .env stores.json ubuntu@<EC2_PUBLIC_IP>:/srv/ucxp/secrets/
```
```bash
# server
chmod 700 /srv/ucxp/secrets && chmod 600 /srv/ucxp/secrets/*
ln -sf /srv/ucxp/secrets/.env        /srv/ucxp/app/.env
ln -sf /srv/ucxp/secrets/stores.json /srv/ucxp/app/stores.json
chmod 600 /srv/ucxp/data/ucxp.db
```

`vault.py:19` resolves `stores.json` from the repo root, so the symlink is what
makes the five seeded demo stores work. Also: the **scraper reads `SARVAM_API_KEY`
from `.env`**, so that symlink is load-bearing for FAQ import too.

Do not create IAM access keys on the box. Nothing in this app calls an AWS API.

---

## Step 10 — Redeploying

```bash
sudo tee /usr/local/bin/ucxp-deploy > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP=/srv/ucxp/app
/usr/local/bin/ucxp-backup
cd "$APP"
git fetch --all && git reset --hard origin/dashboard-restructure
rm -rf "$APP/manifests" && ln -s /srv/ucxp/manifests "$APP/manifests"
ln -sf /srv/ucxp/secrets/.env "$APP/.env"
ln -sf /srv/ucxp/secrets/stores.json "$APP/stores.json"
"$APP/venv/bin/pip" install -q --upgrade fastapi 'uvicorn[standard]' pydantic httpx
sudo systemctl restart ucxp && sleep 2
curl -fsS localhost:8000/api/health && echo "  backend OK"
EOF
sudo chmod +x /usr/local/bin/ucxp-deploy
```

Backend change: `ssh ucxp 'ucxp-deploy'`
Frontend change: `npm run build` locally, then the `rsync` from 6.5. No restart needed.

Logs: `sudo journalctl -u ucxp -n 100 --no-pager` (and `-u caddy` for TLS issues).

---

## Step 11 — Teardown checklist

- [ ] **Pull your data off first** — `ucxp-backup`, then scp the `.tgz` down and
      verify with `tar -tzf`. AWS deletes everything at month 6.
- [ ] **Terminate** the EC2 instance (terminate, not stop — a stopped instance still bills its EBS).
- [ ] EC2 → **Volumes** → delete anything left in state `available`.
- [ ] EC2 → **Elastic IPs** → **release**. *This is the #1 forgotten charge* — an
      unattached EIP bills $3.65/mo forever.
- [ ] Delete snapshots, deregister AMIs.
- [ ] Delete the CloudFront distribution / S3 bucket / Route 53 zone if you made any.
- [ ] **Check every region**, not just Mumbai — it's easy to leave something in
      us-east-1 from the billing-alarm step. Cost Explorer → group by Region.
- [ ] Wait 24–48 h, confirm **$0.00** in Billing → Bills.
- [ ] Leave the budget and alarm in place until the account is closed.

---

## Security: read before opening port 443

**There is no authentication on any endpoint.** The only middleware registered is
CORS (`main.py:42-48`), and CORS is a browser convention, not a security control —
`curl` ignores it entirely.

Anyone who finds your hostname can:

| Endpoint | What they get |
|---|---|
| `GET /api/admin/merchants` | The **full merchant list** — names, emails, cities, status |
| `DELETE /api/business/{id}` | **Destroys a merchant**, cascading to sections and vault |
| `PUT /api/business/{id}/section/{n}` | Rewrites any section of any business |
| `GET /api/meta` | **Enumerates your five real Shopify store subdomains** |

### The one worth understanding

`main.py:280-281`:
```python
if not token:
    token = vault.token_for_subdomain(subdomain) or ""
```

An anonymous request with an **empty** token makes the server look up your real
Shopify admin token and use it. Combined with `/api/meta` handing out the
subdomain list, the whole attack is two unauthenticated requests, and it gives a
stranger free authenticated reads against your store — and a free way to burn
your Shopify rate limit.

They never see the token itself (the vault design holds), but that is cold comfort.

Aggravating: tokens are stored **in plaintext** in the `vault` table, so anyone
with file read on the box — or a copy of a backup `.tgz` — has your live credentials.

### Mitigations, by effort

**Tier 0 — 2 minutes, no code.** Set security group ports **80 and 443 to "My IP"**,
like SSH. For a demo you drive yourself this closes everything above. Trade-off:
Let's Encrypt needs port 80 open to the world to issue and renew, so open it
briefly, get the cert, then narrow it back.

**Tier 1 — 5 minutes, no code. Use this if you need to share a link.**
```bash
caddy hash-password --plaintext '<YOUR_PASSWORD>'
```
Add inside the site block, before the `handle` directives:
```caddy
basic_auth {
    ucxp <PASTE_BCRYPT_HASH>
}
```
Reload. Page loads and `/api/*` both require credentials, and the SPA keeps
working unchanged because `fetch()` reuses the browser's cached basic-auth.

**Tier 2 — 15 minutes.** Block the admin surface at the proxy
(`handle /api/admin/* { respond 403 }`, placed before the `/api/*` handler);
enforce IMDSv2 on the instance (EC2 → Actions → Instance settings → Modify
instance metadata options → IMDSv2 **Required**, hop limit 1).

**Tier 3 — hours, proper.** Real auth on `/api/admin/*`, per-merchant authorization,
requiring an explicit merchant-supplied token in `connect/shopify` instead of
silently falling back to the seeded one, and encrypting `vault.secret`.

> **Bottom line: this app is fine behind a closed door and not safe wide open.**
> Apply Tier 0 at minimum, Tier 1 if anyone else needs the link. Both are
> configuration only.

---

## Order of operations

billing alarms → region → check vCPU quota → build locally → key/SG/launch →
code, venv, systemd, Caddy → hostname + TLS → verify a reboot survives →
secrets → **lock it down (Tier 0/1)** → demo → teardown.
