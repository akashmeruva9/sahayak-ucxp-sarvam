"""Request/response contract for the ``/agent`` tool surface.

The exact field names Samvaad sends to a custom tool are configured in its
dashboard, so :class:`ResolveRequest` is deliberately lenient — it accepts the
common aliases for each field rather than depending on one spelling.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

#: Alternative spellings Samvaad (or any client) might use for each field.
_MESSAGE_ALIASES = ("text", "query", "utterance", "input", "prompt", "transcript")
_CONV_ALIASES = ("session_id", "call_id", "conversationId", "sessionId")
_LANG_ALIASES = ("lang", "language_code", "locale", "detected_language")
_USER_ALIASES = ("caller", "from", "phone", "userId")


class ResolveRequest(BaseModel):
    """What a voice agent sends when it calls the resolve tool mid-conversation."""

    message: str = Field(min_length=1, description="The caller's request, verbatim.")
    conversation_id: str | None = None
    language: str | None = None
    user_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _coalesce_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)

        def fill(target: str, aliases: tuple[str, ...]) -> None:
            if not d.get(target):
                for alias in aliases:
                    if d.get(alias):
                        d[target] = d[alias]
                        break

        fill("message", _MESSAGE_ALIASES)
        fill("conversation_id", _CONV_ALIASES)
        fill("language", _LANG_ALIASES)
        fill("user_id", _USER_ALIASES)
        return d


class ExecuteRequest(BaseModel):
    """Direct execution: the agent already decided business + capability + inputs."""

    business: str = Field(min_length=1, description="Manifest id, e.g. flipkart.")
    capability: str = Field(min_length=1, description="Capability id, e.g. track_order.")
    inputs: dict[str, Any] = Field(default_factory=dict)
    conversation_id: str | None = None
    confirmed: bool = False

    @model_validator(mode="before")
    @classmethod
    def _coalesce_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if not d.get("inputs"):
            for alias in ("arguments", "params", "parameters", "args"):
                if isinstance(d.get(alias), dict):
                    d["inputs"] = d[alias]
                    break
        for alias in _CONV_ALIASES:
            if not d.get("conversation_id") and d.get(alias):
                d["conversation_id"] = d[alias]
                break
        return d


class ResolveResponse(BaseModel):
    """What the agent should say next — plus the structured outcome.

    The agent reads ``say`` aloud. ``needs_input`` tells it the job isn't done
    and another turn is required; ``receipt`` present means the job completed.
    """

    say: str
    done: bool = False
    needs_input: str | None = None
    receipt: dict[str, Any] | None = None
    business: str | None = None
    capability: str | None = None
    conversation_id: str
    #: resolved | needs_input | denied | escalated | smalltalk | failed
    state: str = "resolved"
    language: str = "en-IN"
    degraded: list[str] = Field(default_factory=list)
