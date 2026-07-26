#!/usr/bin/env bash
# One command to run the Sahayak app reliably against the local runtime.
#
# The dev build loads its JS from Metro (:8081) and calls the UCXP runtime
# (:8000), both reached over USB via `adb reverse`. That mapping is wiped every
# time the phone reconnects, which is the usual cause of "stuck on splash" or
# "could not reach the backend". This script re-establishes it and starts Metro.
#
#   ./scripts/dev.sh
#
# Prereqs: phone on USB with debugging authorized, and the backend running
# (uvicorn backend.app.main:app --port 8000).
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"

if [ ! -x "$ADB" ]; then
  echo "adb not found at $ADB — set ANDROID_HOME." >&2
  exit 1
fi

DEVICE="$("$ADB" devices | awk '/device$/{print $1; exit}')"
if [ -n "${DEVICE:-}" ]; then
  echo "→ device $DEVICE: mapping ports over USB (Metro 8081, runtime 8000)"
  "$ADB" -s "$DEVICE" reverse tcp:8081 tcp:8081 >/dev/null
  "$ADB" -s "$DEVICE" reverse tcp:8000 tcp:8000 >/dev/null
  "$ADB" -s "$DEVICE" reverse --list | sed 's/^/   /'
else
  echo "⚠ no USB device detected — connect the phone, or use a LAN IP in .env.local"
fi

echo "→ backend health:"
if curl -s -m 3 http://localhost:8000/health >/dev/null 2>&1; then
  echo "   ✓ runtime up on :8000"
else
  echo "   ✗ runtime NOT reachable on :8000 — start it first:"
  echo "     .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"
fi

echo "→ starting Metro…"
exec npx expo start
