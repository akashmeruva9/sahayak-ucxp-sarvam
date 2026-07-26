#!/usr/bin/env bash
# Start the UCXP dashboard: FastAPI on :8000 and Vite on :5173.
#
#   ./run.sh            start both
#   ./run.sh --check    run preflight only and exit
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$OFF" "$1"; }

FAILED=0

echo
echo "UCXP preflight"
echo "${DIM}──────────────────────────────────────────────${OFF}"

# --- secrets ---------------------------------------------------------------
if [ -f .env ]; then
  ok ".env present"
else
  bad ".env missing — Sarvam credentials are read from it"
  FAILED=1
fi

if [ -f stores.json ]; then
  if ./venv/bin/python -c "import json;d=json.load(open('stores.json'));assert isinstance(d,dict) and d" 2>/dev/null \
     || python3 -c "import json;d=json.load(open('stores.json'));assert isinstance(d,dict) and d" 2>/dev/null; then
    COUNT=$(python3 -c "import json;print(len(json.load(open('stores.json'))))" 2>/dev/null || echo '?')
    ok "stores.json parses — $COUNT Shopify stores"
  else
    bad "stores.json is present but not valid JSON"
    FAILED=1
  fi
else
  bad "stores.json missing — no Shopify store can connect"
  FAILED=1
fi

# Both files hold live credentials. Refuse to start if git is tracking either.
if git rev-parse --git-dir >/dev/null 2>&1; then
  TRACKED=$(git ls-files --error-unmatch .env stores.json 2>/dev/null || true)
  if [ -n "$TRACKED" ]; then
    bad "SECRETS ARE TRACKED BY GIT: $TRACKED — remove them from the index before starting"
    FAILED=1
  else
    ok "secrets are untracked by git"
  fi
fi

# --- toolchain -------------------------------------------------------------
if [ -x venv/bin/python ]; then
  if venv/bin/python -c "import fastapi, uvicorn" 2>/dev/null; then
    ok "python venv ready (fastapi, uvicorn)"
  else
    bad "venv exists but fastapi/uvicorn are missing — run: ./venv/bin/pip install fastapi 'uvicorn[standard]' pydantic pytest"
    FAILED=1
  fi
else
  bad "venv missing — run: python3.12 -m venv venv && ./venv/bin/pip install fastapi 'uvicorn[standard]' pydantic pytest"
  FAILED=1
fi

if [ -d Dashboard/frontend/node_modules ]; then
  ok "frontend dependencies installed"
else
  bad "Dashboard/frontend/node_modules missing — run: npm --prefix Dashboard/frontend install"
  FAILED=1
fi

# --- ports -----------------------------------------------------------------
for PORT in 8000 5173; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    bad "port $PORT is already in use — stop the other process first"
    FAILED=1
  else
    ok "port $PORT free"
  fi
done

echo "${DIM}──────────────────────────────────────────────${OFF}"

if [ "$FAILED" -ne 0 ]; then
  echo
  bad "Preflight failed. Fix the items above and try again."
  exit 1
fi
ok "Preflight passed."

if [ "${1:-}" = "--check" ]; then
  exit 0
fi

# --- start -----------------------------------------------------------------
PIDS=()
cleanup() {
  echo
  echo "Shutting down…"
  for PID in "${PIDS[@]:-}"; do
    [ -n "$PID" ] && kill "$PID" 2>/dev/null
  done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

echo
echo "Starting backend  → http://localhost:8000"
./venv/bin/python -m uvicorn Dashboard.backend.main:app --host 127.0.0.1 --port 8000 --reload &
PIDS+=($!)

echo "Starting frontend → http://localhost:5173"
npm --prefix Dashboard/frontend run dev -- --host 127.0.0.1 &
PIDS+=($!)

echo
echo "${DIM}Open http://localhost:5173  ·  Ctrl-C to stop both${OFF}"
wait
