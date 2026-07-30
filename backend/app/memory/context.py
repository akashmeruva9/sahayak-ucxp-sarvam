"""Conversation memory.

Holds enough state that "Cancel it." resolves without the customer repeating
the business, the service or the ID — PLAN.md §1, "Memory & Context".

In-process and intentionally simple: the demo is single-node, and a database
would add setup without adding a point.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

from loguru import logger

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
    #: Policy triage for a pending gated action — what we've understood so far
    #: and the verdict the business's own documents support. Kept apart from
    #: ``pending_inputs`` because those become the action's arguments, and a
    #: triage answer ("the seal is broken") is not one.
    triage: dict[str, Any] = field(default_factory=dict)
    #: Files the customer has sent, newest last. This is the claim's evidence
    #: trail, so it deliberately outlives ``clear_pending()`` — a photo sent for
    #: a refund is still the photo they sent, whatever happens to the request.
    attachments: list[dict[str, Any]] = field(default_factory=list)
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
        self.triage = {}

    def add_attachment(self, kind: str, filename: str | None, digest: str, chars: int = 0) -> None:
        """Record a file the customer sent, as the evidence trail for a claim."""
        self.attachments.append(
            {
                "kind": kind,
                "filename": filename or "",
                "digest": digest,
                "chars": chars,
                "at": time.time(),
            }
        )
        self.updated_at = time.time()

    def has_photo(self) -> bool:
        """True once the customer has sent an actual photograph.

        A PDF or a screenshot of an order confirmation is a *document*: it
        proves what was bought, not what arrived damaged. Only a photo counts
        as the picture a refund asks for.
        """
        return any(a.get("kind") in {"photo", "image"} for a in self.attachments)

    def triage_text(self, include_evidence: bool = True) -> str:
        """What triage has established, for the confirm line and the prompt.

        Evidence (looked up from the business's own systems) is labelled as
        such, so the reasoning step knows it is fact rather than something the
        customer said — and knows not to ask for it again.
        """
        triage = self.triage or {}
        lines = []
        if include_evidence:
            for key, value in (triage.get("evidence") or {}).items():
                if value not in (None, "", []):
                    lines.append(f"- {key.replace('_', ' ')}: {value}   (from the store's records)")
        for key, value in (triage.get("learned") or {}).items():
            if value not in (None, "", []):
                lines.append(f"- {key.replace('_', ' ')}: {value}")
        return "\n".join(lines)

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
    """Conversation registry with lightweight disk persistence.

    Multi-step flows (a refund waiting on a yes/no, a slot waiting to be filled)
    keep their state on the Conversation object. Without persistence a process
    restart mid-flow loses that state and the next message ("Yes") lands with no
    pending action — so we snapshot to a JSON file after every turn and reload it
    on startup. Single-node and simple, per PLAN.md §9.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._conversations: dict[str, Conversation] = {}
        env_path = os.getenv("UCXP_STATE_FILE")
        self._path = path or (Path(env_path) if env_path else Path(".ucxp_state.json"))
        self._load()

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
        self.save()

    # -- persistence ---------------------------------------------------- #
    def save(self) -> None:
        """Atomically snapshot all conversations. Never raises into a turn."""
        try:
            data = {cid: asdict(conv) for cid, conv in self._conversations.items()}
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, self._path)
        except Exception as exc:  # noqa: BLE001 — persistence must not break a reply
            logger.warning(f"conversation.save_failed path={self._path} {exc}")

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            valid = {f.name for f in fields(Conversation)}
            for cid, raw in data.items():
                self._conversations[cid] = Conversation(**{k: v for k, v in raw.items() if k in valid})
            logger.info(f"conversation.loaded count={len(self._conversations)} path={self._path}")
        except Exception as exc:  # noqa: BLE001 — a corrupt file must not block startup
            logger.warning(f"conversation.load_failed path={self._path} {exc}")


_store: ConversationStore | None = None


def get_store() -> ConversationStore:
    global _store
    if _store is None:
        _store = ConversationStore()
    return _store
