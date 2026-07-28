"""HTTP contracts for the runtime — PLAN.md §6."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    text: str = Field(min_length=1)
    conversation_id: str | None = None
    language: str | None = None
    user_id: str | None = None
    #: Pin the turn to one business (a scoped support chat opened from the
    #: directory) — skips cross-business routing, like the WhatsApp channel.
    business_id: str | None = None


class ReceiptOut(BaseModel):
    label: str
    tone: Literal["info", "success", "warning"] = "info"


class NeedsOut(BaseModel):
    """How the runtime asks for a missing slot."""

    input: str
    prompt: str


class ChatResponse(BaseModel):
    conversation_id: str
    reply_text: str
    business_id: str | None = None
    capability: str | None = None
    receipt: ReceiptOut | None = None
    needs: NeedsOut | None = None
    #: resolved | needs_input | denied | escalated | smalltalk | failed
    state: str = "resolved"
    language: str = "en-IN"
    degraded: list[str] = Field(default_factory=list)
    latency_ms: float = 0.0


class VoiceResponse(ChatResponse):
    transcript: str = ""
    detected_language: str = "en-IN"
    audio_base64: str = ""


class BusinessOut(BaseModel):
    id: str
    name: str
    category: str
    glyph: str
    color: str
    capabilities: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)


class HealthOut(BaseModel):
    status: str = "ok"
    #: Booleans only — never echo a key. Distinguishes "not wired up" from
    #: "wired up but the table is empty", which otherwise look identical.
    manifest_store: dict[str, Any] = Field(default_factory=dict)
    runtime: str = "ucxp"
    version: str = "0.1.0"
    manifests: list[str] = Field(default_factory=list)
    ai_engine: dict[str, Any] = Field(default_factory=dict)
