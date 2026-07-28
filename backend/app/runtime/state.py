"""The state that flows through the LangGraph."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict

from ..schemas.manifest import Manifest


def merge_latency(current: dict[str, float] | None, incoming: dict[str, float] | None) -> dict[str, float]:
    """Accumulate per-node timings instead of the last node overwriting them."""
    return {**(current or {}), **(incoming or {})}


def merge_degraded(current: list[str] | None, incoming: list[str] | None) -> list[str]:
    """Union of degraded stages, order preserved."""
    merged = list(current or [])
    for item in incoming or []:
        if item not in merged:
            merged.append(item)
    return merged


class TurnState(TypedDict, total=False):
    """One trip through the runtime graph.

    Every node reads and adds to this. Keys are optional because the graph
    short-circuits: a turn that only asks for a missing order ID never reaches
    the action or composition nodes.
    """

    # -- input ---------------------------------------------------------- #
    conversation_id: str
    user_id: str | None
    raw_text: str
    #: Caller-supplied language hint; otherwise detected.
    language_hint: str | None
    #: Pin resolution to one business (a dedicated channel); skips routing.
    forced_business_id: str | None

    # -- understand ------------------------------------------------------ #
    language: str
    english_text: str

    # -- route ----------------------------------------------------------- #
    business_id: str | None
    manifest: Manifest | None
    #: "alias" (brand named outright) | "context" (sticky) | "llm" | "none"
    business_source: str

    # -- classify (LLM 1) -------------------------------------------------- #
    capability_id: str | None
    confidence: float
    inputs: dict[str, Any]

    # -- gather / prepare (LLM 2) ------------------------------------------ #
    missing_input: str | None
    #: No business in context and none named — ask the customer to name one.
    needs_business: bool
    missing_prompt: str | None
    knowledge_answer: str | None

    # -- act ---------------------------------------------------------------- #
    result: dict[str, Any]
    denied_message: str | None
    action_error: str | None

    # -- compose (LLM 3) ------------------------------------------------------ #
    reply_en: str
    receipt: dict[str, Any] | None

    # -- output ---------------------------------------------------------------- #
    reply_text: str
    #: resolved | needs_input | confirm | denied | escalated | smalltalk | failed
    status: str
    degraded: Annotated[list[str], merge_degraded]
    latency: Annotated[dict[str, float], merge_latency]
