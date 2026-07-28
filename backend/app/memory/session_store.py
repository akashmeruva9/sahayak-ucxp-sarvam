"""Persist conversations and messages to Supabase.

Complements the in-process :class:`ConversationStore`, which stays the source of
truth for a *live* turn (pending confirmations, slot state) because the graph
reads it synchronously. This module is the durable record: what was said, by
whom, and what it resolved to — so a signed-in customer can see their history
after a redeploy, and so history survives Railway's ephemeral disk.

Writes are best-effort and fire-and-forget. A database hiccup must never cost a
customer their answer, so every failure is logged and swallowed.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from loguru import logger

from ..config import RuntimeSettings, get_settings


def _headers(settings: RuntimeSettings) -> dict[str, str]:
    return {
        "apikey": settings.supabase_key,
        "Authorization": f"Bearer {settings.supabase_key}",
        "Content-Type": "application/json",
    }


class SessionStore:
    """Best-effort persistence of chat history."""

    def __init__(self, settings: RuntimeSettings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def enabled(self) -> bool:
        return self.settings.supabase_configured and self.settings.persist_sessions

    def _url(self, table: str) -> str:
        return f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{table}"

    async def _post(self, table: str, payload: dict[str, Any], *, upsert: bool = False) -> None:
        headers = _headers(self.settings)
        params: dict[str, str] = {}
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates"
            params["on_conflict"] = "id"
        try:
            async with httpx.AsyncClient(timeout=self.settings.supabase_timeout_s) as client:
                response = await client.post(
                    self._url(table), json=payload, headers=headers, params=params
                )
            if response.status_code >= 400:
                logger.warning(
                    f"session_store.rejected table={table} status={response.status_code} "
                    f"body={response.text[:180]}"
                )
        except httpx.HTTPError as exc:
            logger.warning(f"session_store.failed table={table} error={exc}")

    async def record_turn(
        self,
        *,
        conversation_id: str,
        user_id: str | None,
        channel: str,
        external_id: str | None,
        business_id: str | None,
        language: str,
        user_text: str,
        reply_text: str,
        capability: str | None,
        receipt: dict[str, Any] | None,
        latency_ms: float,
    ) -> None:
        """Upsert the conversation, then append both turns."""
        if not self.enabled:
            return

        await self._post(
            self.settings.conversations_table,
            {
                "id": conversation_id,
                "user_id": user_id,
                "channel": channel,
                "external_id": external_id,
                "business_id": business_id,
                "language": language,
            },
            upsert=True,
        )
        # One request for both turns. PostgREST requires every object in a batch
        # to carry the *same* keys — a shorter user row is rejected outright
        # with PGRST102 "All object keys must match" — so the columns that only
        # apply to the assistant turn are sent explicitly as null.
        await self._post(
            self.settings.messages_table,
            [
                {
                    "conversation_id": conversation_id,
                    "role": "user",
                    "text": user_text,
                    "capability": None,
                    "receipt": None,
                    "latency_ms": None,
                },
                {
                    "conversation_id": conversation_id,
                    "role": "assistant",
                    "text": reply_text,
                    "capability": capability,
                    "receipt": receipt,
                    "latency_ms": round(latency_ms, 2),
                },
            ],
        )

    def record_turn_later(self, **kwargs: Any) -> None:
        """Fire-and-forget: never make the customer wait on the database."""
        if not self.enabled:
            return
        task = asyncio.create_task(self.record_turn(**kwargs))
        # Hold a reference so the task isn't garbage-collected mid-flight.
        _pending.add(task)
        task.add_done_callback(_pending.discard)

    async def history(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Conversations for a signed-in customer, newest first."""
        if not self.enabled or not user_id:
            return []
        params = {
            "select": "id,business_id,language,channel,updated_at",
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": str(limit),
        }
        try:
            async with httpx.AsyncClient(timeout=self.settings.supabase_timeout_s) as client:
                response = await client.get(
                    self._url(self.settings.conversations_table),
                    params=params,
                    headers=_headers(self.settings),
                )
                response.raise_for_status()
                rows = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(f"session_store.history_failed error={exc}")
            return []
        return rows if isinstance(rows, list) else []


_pending: set[asyncio.Task] = set()

_store: SessionStore | None = None


def get_session_store() -> SessionStore:
    global _store
    if _store is None:
        _store = SessionStore()
    return _store
