#!/usr/bin/env bash
# Push the deploy-relevant variables from .env to Railway — PLAN.md §11.1.
#
# Why this exists: .env is git-ignored (secrets must never reach GitHub), so
# Railway cannot learn these on its own. Pasting them by hand is how half of
# them went missing — the Shopify and Twilio keys sit at the END of a 78-line
# file, and a partial copy stops before reaching them, leaving /health green
# while every order lookup silently returns mock data.
#
#   ./scripts/sync-railway-env.sh            # push
#   ./scripts/sync-railway-env.sh --dry-run  # show what would be pushed
#
# Prereqs:  brew install railway  &&  railway login  &&  railway link
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# Exactly the variables the hosted runtime needs. Everything else in .env is
# either a local-only path or an AI Engine tuning default that the image
# already carries. PORT/UCXP_PORT/*_BASE_URL are deliberately absent: the
# Dockerfile derives them from Railway's $PORT, and setting them by hand
# breaks the loopback self-call (PLAN.md §7 #29).
KEYS=(
  SARVAM_API_KEY
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  UCXP_WHATSAPP_BUSINESS
  UCXP_WHATSAPP_SPEAK
  UCXP_WHATSAPP_ACK
  UCXP_LOG_LEVEL
  SHOPIFY_TOKEN_RAVI_ELECTRONICS
  SHOPIFY_TOKEN_MEENA_KITCHEN_STORE
  SHOPIFY_TOKEN_LAKSHMI_FASHION
  SHOPIFY_TOKEN_SRI_PHARMA
  SHOPIFY_TOKEN_ANNA_GROCERIES
  # Published manifests + (soon) conversation history. SERVICE key, not anon:
  # the runtime reads every row and writes history, so it must bypass RLS.
  # It must never reach the app — server env only.
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  # Web lookup for businesses with no manifest. Set whichever one you have;
  # the provider is inferred from it (PLAN.md §7 #41).
  TAVILY_API_KEY
  BRAVE_API_KEY
  SERPER_API_KEY
)

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found — run from the repo root." >&2
  exit 1
fi
if ! command -v railway >/dev/null 2>&1; then
  echo "✗ railway CLI missing.  brew install railway && railway login && railway link" >&2
  exit 1
fi

args=()
missing=()
for key in "${KEYS[@]}"; do
  # Last definition wins, matching dotenv's own precedence.
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)"
  value="${line#*=}"
  if [ -z "$line" ] || [ -z "$value" ]; then
    missing+=("$key")
    continue
  fi
  args+=(--set "${key}=${value}")
  # Never print the value — this output can end up in a terminal transcript.
  printf '  %-34s %s…(%d chars)\n' "$key" "${value:0:4}" "${#value}"
done

if [ ${#missing[@]} -gt 0 ]; then
  echo ""
  echo "⚠ not set in $ENV_FILE, skipped: ${missing[*]}"
fi

if [ ${#args[@]} -eq 0 ]; then
  echo "✗ nothing to push." >&2
  exit 1
fi

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "(dry run — nothing sent). Re-run without --dry-run to push."
  exit 0
fi

echo "→ pushing $(( ${#args[@]} / 2 )) variables to Railway…"
railway variables "${args[@]}"
echo "✓ done. Railway redeploys automatically (~1-2 min)."
echo "  Verify:  curl -s \$BASE/connectors/shopify/ravi-electronics/orders/1001"
echo "  Success is \"mock\" absent/false and the real order amount."
