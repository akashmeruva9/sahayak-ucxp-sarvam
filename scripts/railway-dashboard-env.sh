#!/usr/bin/env bash
# Print the dashboard's Railway variables, ready to paste into the Raw Editor.
#
# Values are read from .env and stores.json, which are gitignored and stay
# local. Nothing here is committed and nothing is sent anywhere -- it just
# reshapes what you already have into the two lines Railway wants.
#
#   ./scripts/railway-dashboard-env.sh            # print, to copy by hand
#   ./scripts/railway-dashboard-env.sh --copy     # straight to the clipboard (macOS)
#
# UCXP_DB and UCXP_MANIFEST_DIR are deliberately absent: the Dockerfile already
# sets them to /data, and overriding them by hand is how state ends up written
# somewhere the volume is not mounted.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $1" >&2; exit 1; }

[ -f .env ]        || fail ".env not found — run from the repo root."
[ -f stores.json ] || fail "stores.json not found — run from the repo root."

# Strip the surrounding quotes a .env commonly carries. A quoted key reaches
# Sarvam verbatim, is rejected with a 403, and surfaces as "not configured".
key="$(grep -E '^[[:space:]]*SARVAM_API_KEY' .env | tail -1 | sed 's/^[^=]*=[[:space:]]*//')"
key="$(printf '%s' "$key" | tr -d "\"'" | tr -d '[:space:]')"
[ -n "$key" ] || fail "SARVAM_API_KEY is empty in .env"

stores="$(tr -d '\n\r' < stores.json)"
printf '%s' "$stores" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null \
  || fail "stores.json is not valid JSON"

block="SARVAM_API_KEY=${key}
UCXP_STORES_JSON_CONTENT=${stores}"

if [ "${1:-}" = "--copy" ] && command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$block" | pbcopy
  echo "✓ Copied to clipboard — paste into Railway → Variables → Raw Editor."
  echo "  SARVAM_API_KEY            ${#key} chars"
  echo "  UCXP_STORES_JSON_CONTENT  ${#stores} chars"
else
  echo "# Paste into Railway → your dashboard service → Variables → Raw Editor"
  echo "$block"
  echo
  echo "# Then, after you generate a domain, add this one and redeploy:"
  echo "# UCXP_PUBLIC_BASE_URL=https://<your-domain>.up.railway.app"
fi
