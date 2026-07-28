"""The tool endpoints a managed voice agent (Samvaad) calls during a call.

    Samvaad  ── POST /agent/resolve ──▶  UcxpRuntime.run()  ──▶  manifest → action → receipt

One tool, ``resolve_customer_request``, wraps the whole runtime. Samvaad keeps
owning the voice (STT/TTS/turn-taking); UCXP keeps owning the *resolution*
(which business, which capability, slot-filling, rules, the real action and the
receipt). That division is the point: Samvaad is just another compliant UCXP
client, so the manifest-driven story and the consistency guarantees are unchanged.

``GET /agent/tool-spec`` emits a ready-to-paste tool definition, built from the
live manifests, to configure in the Samvaad dashboard.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger

from ..runtime.loader import get_registry
from .execute import run_capability
from .schemas import ExecuteRequest, ResolveRequest, ResolveResponse

router = APIRouter(prefix="/agent", tags=["agent tools"])


def get_runtime_dep() -> Any:
    """The runtime singleton, resolved lazily to avoid a circular import.

    ``main`` includes this router at import time, so importing ``main`` here at
    module top would be circular. Deferring it into the dependency keeps the
    import graph clean and lets tests override the runtime.
    """
    from ..main import get_runtime

    return get_runtime()


async def _authorize(authorization: str | None = Header(default=None)) -> None:
    """Optional shared-secret gate. Off unless ``UCXP_AGENT_TOOL_TOKEN`` is set."""
    token = os.getenv("UCXP_AGENT_TOOL_TOKEN", "").strip()
    if not token:
        return
    if authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Invalid or missing agent tool token")


@router.post(
    "/resolve",
    response_model=ResolveResponse,
    dependencies=[Depends(_authorize)],
    summary="Resolve a caller's request end to end (the Samvaad tool)",
)
async def resolve(req: ResolveRequest, runtime: Any = Depends(get_runtime_dep)) -> ResolveResponse:
    final, conversation = await runtime.run(
        req.message,
        conversation_id=req.conversation_id,
        language=req.language,
        user_id=req.user_id,
        # A call placed from one merchant's screen (or a single-merchant agent)
        # pins every turn to that manifest — the same rule the app's business
        # chat and the WhatsApp line already follow. Omitted ⇒ route across all.
        force_business_id=req.business_id,
    )

    receipt = final.get("receipt")
    missing = final.get("missing_input")
    # "__confirm__" is a yes/no gate, not a data slot the agent must collect.
    needs_input = missing if (missing and missing != "__confirm__") else None
    reply = final.get("reply_text") or final.get("reply_en") or ""

    logger.info(
        f"agent.resolve conversation={conversation.id} business={final.get('business_id')} "
        f"capability={final.get('capability_id')} state={final.get('status')} "
        f"done={receipt is not None} needs={needs_input}"
    )

    return ResolveResponse(
        say=reply,
        done=receipt is not None,
        needs_input=needs_input,
        receipt=receipt,
        business=final.get("business_id"),
        capability=final.get("capability_id"),
        conversation_id=conversation.id,
        state=final.get("status", "resolved"),
        language=final.get("language", "en-IN"),
        degraded=list(final.get("degraded") or []),
    )


@router.post(
    "/execute",
    response_model=ResolveResponse,
    dependencies=[Depends(_authorize)],
    summary="Execute one capability directly — the fast, Sarvam-free path",
)
async def execute(req: ExecuteRequest) -> ResolveResponse:
    out = await run_capability(
        req.business,
        req.capability,
        req.inputs,
        conversation_id=req.conversation_id,
        confirmed=req.confirmed,
    )
    return ResolveResponse(
        say=out.get("say", ""),
        done=bool(out.get("done")),
        needs_input=out.get("needs_input"),
        receipt=out.get("receipt"),
        business=out.get("business"),
        capability=out.get("capability"),
        conversation_id=out.get("conversation_id") or (req.conversation_id or ""),
        state=out.get("state", "resolved"),
    )


@router.get("/execute-spec", summary="Per-capability tool definition for a fast voice agent")
async def execute_spec(business_id: str | None = None) -> dict[str, Any]:
    """Fast-path tool definition. ``?business_id=<id>`` scopes it to one merchant."""
    base = os.getenv("UCXP_PUBLIC_BASE_URL", "").strip().rstrip("/")
    url = f"{base}/agent/execute" if base else "/agent/execute"
    registry = get_registry()

    scoped = registry.get(business_id) if business_id else None
    if business_id and scoped is None:
        raise HTTPException(status_code=404, detail=f"No manifest for '{business_id}'")

    businesses: list[str] = []
    capabilities: set[str] = set()
    catalog_lines: list[str] = []
    for m in ([scoped] if scoped else registry.all()):
        businesses.append(m.business.id)
        for c in m.capabilities:
            capabilities.add(c.id)
            inputs = ", ".join(i.name for i in c.required_inputs) or "none"
            catalog_lines.append(f"{m.business.id}.{c.id} (inputs: {inputs})")

    lead = (
        f"Execute a customer-support action for {scoped.business.name} and get a receipt. "
        "Decide the capability from what the caller wants, "
        if scoped
        else "Execute a specific customer-support action and get a receipt. Decide the business "
             "and capability from what the caller wants, "
    )

    return {
        "name": "execute_capability",
        "description": (
            lead
            + "collect the listed inputs (ask the caller "
            "for anything you don't have), then call this. It returns { say, receipt, needs_input }. "
            "If needs_input is set, ask for that value and call again. For destructive actions it may "
            "return state 'confirm' — confirm with the caller, then call again with confirmed=true. "
            "Available actions: " + "; ".join(sorted(catalog_lines)) + "."
        ),
        "scoped_to": scoped.id if scoped else None,
        "method": "POST",
        "url": url,
        "parameters": {
            "type": "object",
            "properties": {
                "business": {"type": "string", "enum": sorted(businesses), "description": "Which business."},
                "capability": {"type": "string", "enum": sorted(capabilities), "description": "Which action."},
                "inputs": {"type": "object", "description": "The action's inputs, e.g. {\"order_id\": \"OD123\"}."},
                "conversation_id": {"type": "string", "description": "Reuse across turns so memory carries."},
                "confirmed": {"type": "boolean", "description": "Set true after the caller confirms a destructive action."},
            },
            "required": ["business", "capability"],
        },
        "usage": (
            "Speak the `say` field. If `needs_input` is set, ask for it and call again with the same "
            "conversation_id. On state 'confirm', confirm then call again with confirmed=true. When "
            "`receipt` is present the job is done."
        ),
    }


@router.get("/tool-spec", summary="Tool definition to paste into the Samvaad dashboard")
async def tool_spec(business_id: str | None = None) -> dict[str, Any]:
    """The Samvaad tool definition.

    Pass ``?business_id=<id>`` for a **single-merchant** agent — that merchant's
    own support line. The spec is then scoped to its manifest and the caller is
    never routed to another business, mirroring the app's business chat and the
    pinned WhatsApp number. Omit it for a central agent that serves everyone.
    """
    base = os.getenv("UCXP_PUBLIC_BASE_URL", "").strip().rstrip("/")
    url = f"{base}/agent/resolve" if base else "/agent/resolve"
    registry = get_registry()

    scoped = registry.get(business_id) if business_id else None
    if business_id and scoped is None:
        raise HTTPException(status_code=404, detail=f"No manifest for '{business_id}'")

    manifests = [scoped] if scoped else registry.all()
    catalog = "; ".join(
        f"{m.business.name}: {', '.join(c.id for c in m.capabilities)}" for m in manifests
    )

    if scoped:
        description = (
            f"Resolve a customer's request for {scoped.business.name} end to end — this runs the "
            "real workflow and returns a receipt (ETA, refund or booking reference). Call it "
            "whenever the caller asks about an order, delivery, bill, refund or cancellation. "
            f"You answer only for {scoped.business.name}; it handles — {catalog}."
        )
    else:
        description = (
            "Resolve a customer's request end to end — this runs the real workflow and "
            "returns a receipt (ticket ID, ETA, booking or refund reference). Call it whenever "
            "the caller asks about an order, delivery, bill, booking, refund, cancellation or "
            f"appointment. Covered businesses — {catalog}."
        )

    properties: dict[str, Any] = {
        "message": {
            "type": "string",
            "description": "The caller's request, transcribed verbatim in their own language.",
        },
        "conversation_id": {
            "type": "string",
            "description": "Echo back the conversation_id from the previous call so memory carries across turns.",
        },
        "language": {
            "type": "string",
            "description": "BCP-47 code Samvaad detected (e.g. te-IN, hi-IN). Optional.",
        },
    }
    if scoped:
        # A constant enum: the agent must send this id and cannot pick another
        # business, which is what makes the line single-merchant.
        properties["business_id"] = {
            "type": "string",
            "enum": [scoped.id],
            "description": f"Always \"{scoped.id}\" — this line answers only for {scoped.business.name}.",
        }

    return {
        "name": "resolve_customer_request",
        "description": description,
        "method": "POST",
        "url": url,
        "scoped_to": scoped.id if scoped else None,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": ["message", "business_id"] if scoped else ["message"],
        },
        "usage": (
            "Speak the `say` field to the caller. If `needs_input` is set, ask `say` and call "
            "again with the answer plus the same conversation_id. When `receipt` is present the "
            "job is done — read its label back as confirmation."
        ),
    }
