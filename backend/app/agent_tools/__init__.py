"""Agent-tool surface for managed voice agents (Sarvam Samvaad).

Samvaad owns the live voice loop — telephony, STT, TTS, turn-taking. It reaches
UCXP through a single "Advanced Tool" (``POST /agent/resolve``) so that a phone
call resolves a *real* job and returns a receipt, instead of only talking.

Nothing here is business-specific and nothing here talks to Sarvam — the tool
just hands the caller's words to the runtime and returns what to say. See
PLAN.md §11.
"""

from __future__ import annotations

from .router import router

__all__ = ["router"]
