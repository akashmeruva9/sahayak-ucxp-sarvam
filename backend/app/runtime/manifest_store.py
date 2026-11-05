"""Read published manifests from Supabase.

The enterprise dashboard writes a row per business on Activate; the runtime
reads the active ones here. Talks to PostgREST directly with httpx rather than
pulling in the `supabase` package — the runtime already speaks httpx, and the
client library would add gotrue/postgrest/storage/realtime for one SELECT.

Never raises into startup: an unreachable or unconfigured database leaves the
registry on the local ``manifests/*.json``, so the demo degrades instead of
ending. That fallback is the reason ``GET /manifests/{id}`` keeps working for
PLAN.md §8 step 8 even with the DB down.
"""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from ..config import RuntimeSettings


class ManifestStoreUnavailable(RuntimeError):
    """Supabase is not configured, or the request failed."""


def _headers(settings: RuntimeSettings) -> dict[str, str]:
    return {
        "apikey": settings.supabase_key,
        "Authorization": f"Bearer {settings.supabase_key}",
        "Accept": "application/json",
    }


async def fetch_manifests(settings: RuntimeSettings) -> list[dict[str, Any]]:
    """Return the raw manifest documents from Cloud Firestore or Supabase.

    Only ``status = active`` rows are loaded — a draft in the dashboard must not
    become a live business in the app.
    """
    # 1. Try Google Cloud Firestore (primary)
    try:
        import os
        from google.cloud import firestore
        proj = os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or "sahayak-ucxp"
        db = firestore.Client(project=proj)
        docs = db.collection("ucxp_manifests").where("status", "==", "active").stream()
        documents: list[dict[str, Any]] = []
        rows_count = 0
        for doc in docs:
            rows_count += 1
            row = doc.to_dict()
            m = row.get("manifest")
            if isinstance(m, dict):
                m.setdefault("business_id", row.get("business_id") or doc.id)
                documents.append(m)
        if rows_count > 0:
            logger.info(f"manifest_store.firestore_fetched rows={rows_count} usable={len(documents)}")
            return documents
    except Exception as exc:
        logger.warning(f"manifest_store.firestore_skipped {exc}")

    # 2. Fall back to Supabase (secondary / fallback)
    if not settings.supabase_configured:
        raise ManifestStoreUnavailable("Neither Firestore nor Supabase configured")

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{settings.manifest_table}"
    params = {"select": "business_id,manifest,status,version", "status": "eq.active"}

    try:
        async with httpx.AsyncClient(timeout=settings.supabase_timeout_s) as client:
            response = await client.get(url, params=params, headers=_headers(settings))
            response.raise_for_status()
            rows = response.json()
    except httpx.HTTPError as exc:
        raise ManifestStoreUnavailable(str(exc)) from exc
    except ValueError as exc:
        raise ManifestStoreUnavailable(f"non-JSON response from {url}") from exc

    if not isinstance(rows, list):
        raise ManifestStoreUnavailable(f"expected a list of rows, got {type(rows).__name__}")

    documents: list[dict[str, Any]] = []
    for row in rows:
        document = row.get("manifest")
        if not isinstance(document, dict):
            logger.warning(f"manifest_store.skipped business={row.get('business_id')} reason=not-an-object")
            continue
        # The dashboard's own id wins over anything inside the blob, so a
        # renamed business can't silently shadow another row.
        document.setdefault("business_id", row.get("business_id"))
        documents.append(document)

    logger.info(f"manifest_store.fetched rows={len(rows)} usable={len(documents)}")
    return documents
