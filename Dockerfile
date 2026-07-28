# Sahayak — UCXP Runtime + AI Engine (they deploy together, per PLAN.md §6).
#
# Docker rather than a Python buildpack on purpose: the WhatsApp adapter shells
# out to ffmpeg (WAV→MP3 for spoken replies) and pytesseract (photo OCR). Both
# are imported lazily, so a buildpack build goes green and then silently loses
# image OCR and voice notes at runtime. PLAN.md §11.1.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# tesseract-ocr → WhatsApp photo OCR; ffmpeg → WAV to MP3 for voice replies.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      ffmpeg \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_engine/ ./ai_engine/
COPY backend/ ./backend/
COPY manifests/ ./manifests/

# Conversation state lives here; mount a volume so pending confirmations
# survive a redeploy (PLAN.md §7 #23).
ENV UCXP_STATE_FILE=/data/.ucxp_state.json
RUN mkdir -p /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

# $PORT is injected by the platform; 8000 is the local default. Shell form so
# the variable is expanded at runtime.
#
# UCXP_PORT must be exported too, not just passed to uvicorn. config.py derives
# mock_base_url and connector_base_url from it — the runtime calls its own mock
# and Shopify connector over loopback. Bind uvicorn to $PORT while UCXP_PORT
# still says 8000 and every capability dies at `act` on a connection refused,
# with the manifest looking blameless. Keeping them equal keeps the self-call
# in-container (no public round trip); override the two URLs only to point at a
# genuinely external service.
CMD UCXP_PORT=${PORT:-8000} uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
