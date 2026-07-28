# Sahayak — UCXP merchant dashboard (React build + FastAPI, one service).
#
# Docker rather than a buildpack because this image has two toolchains: the
# frontend is a Vite app whose dist/ is gitignored, so it cannot be committed
# and must be built here, while the runtime is Python. A single-language
# buildpack builds one and silently ships the app without the other.
#
# The API also serves the built frontend, on purpose. Same origin means the
# frontend keeps calling a relative /api and CORS never applies -- splitting
# them would mean editing the API base URL, the CORS allowlist, and handling
# preflight, for no benefit at this size.

# --------------------------------------------------------------------------
# Stage 1 — build the frontend
# --------------------------------------------------------------------------
FROM node:20-slim AS frontend

WORKDIR /build

# Dependencies first: this layer is cached unless the lockfile itself changes,
# so an edit to src/ does not reinstall node_modules.
COPY Dashboard/frontend/package.json Dashboard/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY Dashboard/frontend/ ./
RUN npm run build && test -f dist/index.html


# --------------------------------------------------------------------------
# Stage 2 — the runtime
# --------------------------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# curl is here only for the container healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY Dashboard/backend/ ./Dashboard/backend/
COPY --from=frontend /build/dist/ ./Dashboard/frontend/dist/

# State lives on a mounted volume, not in the image. Without this a redeploy
# silently discards every merchant and every published manifest, because the
# container filesystem is replaced on each deploy.
ENV UCXP_DB=/data/ucxp.db \
    UCXP_MANIFEST_DIR=/data/manifests
RUN mkdir -p /data/manifests

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1

# One worker deliberately: store.py keeps a SQLite connection per thread in a
# threading.local(), and multiple worker processes writing one SQLite file
# produce "database is locked" under concurrency.
CMD ["sh", "-c", "python -m uvicorn Dashboard.backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
