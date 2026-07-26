# UCXP / Sahayak

**Read [`PLAN.md`](./PLAN.md) before doing anything in this repo.** It is the single
source of truth for architecture, scope, and cross-layer contracts. This applies
whether you're working in `frontend/`, `backend/`, or `ai_engine/`.

## Non-negotiables

1. **The runtime contains no business-specific code.** No `if business == "flipkart"`
   anywhere in `backend/app/runtime/`. Business behaviour enters only through
   `manifests/*.json`. A grep for a business name in the runtime must return nothing.
2. **Only `ai_engine/` talks to Sarvam.** The runtime imports `SarvamOrchestrator`;
   it never sees a model name, an HTTP client, or a retry.
3. **The AI Engine's public interface is frozen.** It is done and live-verified. If
   something new is needed, add a method — don't change an existing one.
4. **Jobs complete.** Every capability executes an action and returns a receipt
   (ticket ID, ETA, booking ref). A reply that only explains policy is not done.

## Keep the plan true

When you change scope, a contract, or the structure, update `PLAN.md` **in the same
change** — see its §0 for which section. Deviations get one appended row in the §7
decision log with the reason. Never rewrite the log; judges ask "why".

Don't mark anything `DONE` in the §3 status board until it has actually run.

## Scope guard

`PLAN.md` §9 lists what we are deliberately not building (auth, payments, analytics,
admin, notifications, 22 languages…). Don't build them, and don't suggest them.
Depth on 3 businesses and 4 languages beats breadth everywhere.

## Commands

```bash
# AI Engine — offline suite (no API key needed)
.venv/bin/python -m pytest

# AI Engine against a local fake Sarvam
.venv/bin/python tools/mock_sarvam.py                     # :8099
SARVAM_BASE_URL=http://127.0.0.1:8099 SARVAM_API_KEY=mock \
  .venv/bin/python tools/demo.py text "मेरा ऑर्डर कहाँ है?"

# Frontend
cd frontend && npx expo start
cd frontend && npx tsc --noEmit
```

Exported shell variables beat `.env` — `unset SARVAM_BASE_URL SARVAM_API_KEY` before
running against the real API.
