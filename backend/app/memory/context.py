"""Conversation memory.

Holds enough state that "Cancel it." resolves without the customer repeating
the business, the service or the ID — PLAN.md §1, "Memory & Context".

In-process and intentionally simple: the demo is single-node, and a database
would add setup without adding a point.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..config import get_settings


@dataclass
class Conversation:
    id: str
    user_id: str | None = None
    #: Sticky business — the reason a follow-up doesn't need the brand name.
    business_id: str | None = None
    last_capability: str | None = None
    language: str = "en-IN"
    #: Slot values seen so far, e.g. {"last_order_id": "OD123"}.
    facts: dict[str, Any] = field(default_factory=dict)
    #: A capability waiting on a missing input.
    pending_capability: str | None = None
    pending_inputs: dict[str, Any] = field(default_factory=dict)
    #: A capability waiting for yes/no confirmation.
    awaiting_confirmation: bool = False
    turns: list[dict[str, str]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def add_turn(self, role: str, content: str) -> None:
        if not content.strip():
            return
        self.turns.append({"role": role, "content": content.strip()})
        limit = get_settings().max_history_turns
        if len(self.turns) > limit:
            self.turns = self.turns[-limit:]
        self.updated_at = time.time()

    def remember(self, capability_id: str | None, inputs: dict[str, Any]) -> None:
        """Persist collected inputs as ``last_<name>`` so later turns can reuse them."""
        for name, value in (inputs or {}).items():
            if value in (None, ""):
                continue
            self.facts[f"last_{name}"] = value
        if capability_id:
            self.last_capability = capability_id
        self.updated_at = time.time()

    def clear_pending(self) -> None:
        self.pending_capability = None
        self.pending_inputs = {}
        self.awaiting_confirmation = False

    def history_text(self, limit: int = 6) -> str:
        recent = self.turns[-limit:]
        if not recent:
            return "(this is the first message)"
        return "\n".join(f"{t['role']}: {t['content']}" for t in recent)

    def context_text(self) -> str:
        known = {k: v for k, v in self.facts.items() if v not in (None, "")}
        if self.business_id:
            known["business"] = self.business_id
        if not known:
            return "(nothing known yet)"
        return "\n".join(f"- {k}: {v}" for k, v in known.items())


class ConversationStore:
    """In-memory conversation registry."""

    def __init__(self) -> None:
        self._conversations: dict[str, Conversation] = {}

    def get_or_create(self, conversation_id: str | None, user_id: str | None = None) -> Conversation:
        if conversation_id and conversation_id in self._conversations:
            return self._conversations[conversation_id]
        new_id = conversation_id or uuid.uuid4().hex
        conversation = Conversation(id=new_id, user_id=user_id)
        self._conversations[new_id] = conversation
        return conversation

    def get(self, conversation_id: str) -> Conversation | None:
        return self._conversations.get(conversation_id)

    def all(self) -> list[Conversation]:
        return sorted(self._conversations.values(), key=lambda c: c.updated_at, reverse=True)

    def clear(self) -> None:
        self._conversations.clear()


_store: ConversationStore | None = None


def get_store() -> ConversationStore:
    global _store
    if _store is None:
        _store = ConversationStore()
    return _store
