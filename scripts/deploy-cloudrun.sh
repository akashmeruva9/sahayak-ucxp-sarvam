#!/usr/bin/env bash
# Deploy Sahayak UCXP Runtime to Google Cloud Run
# Usage: ./scripts/deploy-cloudrun.sh [PROJECT_ID] [REGION]

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${1:-sahayak-ucxp}"
REGION="${2:-asia-south1}"
SERVICE_NAME="sahayak"
ENV_FILE=".env"
YAML_FILE="cloudrun.env.yaml"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found. Run from repo root." >&2
  exit 1
fi

echo "→ Extracting deployment variables from ${ENV_FILE} to ${YAML_FILE}..."
python3 - <<EOF
import yaml
from dotenv import dotenv_values

KEYS = [
    "SARVAM_API_KEY",
    "SARVAM_BASE_URL",
    "SARVAM_LLM_MODEL",
    "SARVAM_TTS_MODEL",
    "SARVAM_TTS_SPEAKER",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "UCXP_WHATSAPP_BUSINESS",
    "UCXP_WHATSAPP_SPEAK",
    "UCXP_WHATSAPP_ACK",
    "UCXP_LOG_LEVEL",
    "SHOPIFY_TOKEN_RAVI_ELECTRONICS",
    "SHOPIFY_TOKEN_MEENA_KITCHEN_STORE",
    "SHOPIFY_TOKEN_LAKSHMI_FASHION",
    "SHOPIFY_TOKEN_SRI_PHARMA",
    "SHOPIFY_TOKEN_ANNA_GROCERIES",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TAVILY_API_KEY",
    "BRAVE_API_KEY",
    "SERPER_API_KEY",
]

vals = dotenv_values("$ENV_FILE")
env_vars = {k: str(vals[k]) for k in KEYS if vals.get(k)}

with open("$YAML_FILE", "w", encoding="utf-8") as f:
    yaml.dump(env_vars, f, default_flow_style=False)

print(f"✓ Packaged {len(env_vars)} variables into $YAML_FILE")
EOF

echo "→ Enabling required GCP APIs on ${PROJECT_ID} (if not already enabled)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project "${PROJECT_ID}" || true

echo "→ Building and deploying ${SERVICE_NAME} to Cloud Run (${REGION})..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 120s \
  --quiet \
  --env-vars-file "$YAML_FILE"

rm -f "$YAML_FILE"
echo "✓ Deployment complete!"
