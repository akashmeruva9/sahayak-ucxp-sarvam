"""Direct capability execution — the fast path for live voice agents.

Samvaad's own (sub-500ms) LLM decides the business + capability and collects the
inputs; this endpoint then just *executes* — no Sarvam reasoning in the loop, so
it returns in well under a second instead of the ~20s a full classify costs.

It reuses the runtime's executor, renderer and rule engine unchanged, so a
capability behaves identically whether it's reached through `/chat` or here. It
never talks to Sarvam, so it works even with no API key.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from ..memory.context import get_store
from ..runtime.executor import ActionError, ActionExecutor
from ..runtime.loader import get_registry
from ..runtime.renderer import RenderError, RuleError, evaluate_condition, render

_executor: ActionExecutor | None = None


def get_executor() -> ActionExecutor:
    """A dedicated action executor. No Sarvam, no runtime graph — just HTTP."""
    global _executor
    if _executor is None:
        _executor = ActionExecutor()
    return _executor


async def aclose_executor() -> None:
    global _executor
    if _executor is not None:
        await _executor.aclose()
        _executor = None


def _resolve_inputs(cap: Any, provided: dict[str, Any], facts: dict[str, Any]) -> tuple[dict[str, Any], str | None, str | None]:
    """Fill required inputs from what was provided, else the conversation's memory.

    Returns (collected, first_missing_name, its_prompt). A non-optional input
    that is neither provided nor known stops execution so the agent can ask.
    """
    collected: dict[str, Any] = {}
    for spec in cap.required_inputs:
        value = provided.get(spec.name)
        if value in (None, "") and spec.default_from and spec.default_from.startswith("context."):
            value = facts.get(spec.default_from.split(".", 1)[1])
        if value in (None, ""):
            if not spec.optional:
                return collected, spec.name, spec.prompt
            continue
        collected[spec.name] = value
    return collected, None, None


async def run_capability(
    business: str,
    capability: str,
    inputs: dict[str, Any] | None,
    *,
    conversation_id: str | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Execute one manifest capability and return what the agent should say."""
    registry = get_registry()
    manifest = registry.get(business)
    if manifest is None:
        return {"say": f"I don't handle '{business}'.", "state": "unknown_business", "done": False}

    cap = manifest.capability(capability)
    if cap is None:
        return {
            "say": f"I can't do '{capability}' for {manifest.business.name}.",
            "state": "unknown_capability",
            "business": manifest.id,
            "done": False,
        }

    conversation = get_store().get_or_create(conversation_id)
    conversation.business_id = manifest.id

    collected, missing, prompt = _resolve_inputs(cap, inputs or {}, conversation.facts)
    if missing:
        conversation.pending_capability = capability
        conversation.pending_inputs = collected
        return {
            "say": prompt,
            "needs_input": missing,
            "state": "needs_input",
            "business": manifest.id,
            "capability": capability,
            "conversation_id": conversation.id,
            "done": False,
        }

    if cap.confirm and not confirmed:
        return {
            "say": f"Just to confirm — {cap.description.rstrip('.')}. Shall I go ahead?",
            "state": "confirm",
            "awaiting_confirmation": True,
            "business": manifest.id,
            "capability": capability,
            "conversation_id": conversation.id,
            "done": False,
        }

    scope: dict[str, Any] = {**collected, "context": conversation.facts}
    result: dict[str, Any] = {}
    if cap.action:
        try:
            result = await get_executor().execute(manifest, cap.action, scope)
        except ActionError as exc:
            return {
                "say": exc.message,
                "state": "failed",
                "business": manifest.id,
                "capability": capability,
                "conversation_id": conversation.id,
                "done": False,
            }
    scope["result"] = result

    for rule in cap.rules:
        try:
            if evaluate_condition(rule.when, scope):
                return {
                    "say": rule.deny,
                    "state": "denied",
                    "business": manifest.id,
                    "capability": capability,
                    "conversation_id": conversation.id,
                    "done": False,
                }
        except RuleError as exc:
            logger.warning(f"agent.execute rule '{rule.id}' unevaluable: {exc}")

    try:
        say = render(cap.response, scope) if cap.response else ""
    except RenderError as exc:
        logger.warning(f"agent.execute response render failed: {exc}")
        say = ""

    receipt: dict[str, Any] | None = None
    if cap.receipt:
        try:
            receipt = {"label": render(cap.receipt.label, scope), "tone": cap.receipt.tone}
        except RenderError as exc:
            logger.warning(f"agent.execute receipt render failed: {exc}")

    conversation.remember(capability, collected)
    conversation.clear_pending()

    logger.info(
        f"agent.execute business={manifest.id} capability={capability} "
        f"done={receipt is not None} conversation={conversation.id}"
    )
    return {
        "say": say,
        "done": receipt is not None,
        "receipt": receipt,
        "business": manifest.id,
        "capability": capability,
        "state": "resolved",
        "conversation_id": conversation.id,
    }
