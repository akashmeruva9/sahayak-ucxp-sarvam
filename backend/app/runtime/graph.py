"""The UCXP runtime, as a LangGraph state machine.

    understand → route → classify → gather → act → compose → localize

LangGraph owns the control flow; the AI Engine owns every model call; the
manifest owns every business decision. There is no business-specific code in
this file, and there must never be.

Three LLM steps, matching the three prompts in ``runtime/prompts``:
  1. classify.md  — which business, which capability, what did they supply
  2. prepare.md   — normalise the inputs, or answer from the business's docs
  3. respond.md   — turn the action's result into what the customer hears
"""

from __future__ import annotations

import re
import time
from typing import Any

from langgraph.graph import END, START, StateGraph
from loguru import logger

from ai_engine import SarvamOrchestrator

from ..config import RuntimeSettings, get_settings
from ..memory.context import Conversation, get_store
from ..schemas.manifest import Capability, Manifest
from .executor import ActionError, ActionExecutor
from .llm import build_prompt, think_json, think_text
from .loader import ManifestRegistry, get_registry
from .renderer import RenderError, RuleError, evaluate_condition, render
from .state import TurnState

CONFIRM_YES = {"yes", "yeah", "yep", "sure", "ok", "okay", "go ahead", "do it", "please do", "confirm", "haan", "ha"}
CONFIRM_NO = {"no", "nope", "don't", "dont", "cancel that", "stop", "nahi", "not now"}

#: A token that could plausibly be an identifier, date or amount.
_VALUE_LIKE = re.compile(r"\d|\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I)


def _might_contain_value(text: str) -> bool:
    """Cheap gate before spending a reasoning call on input extraction.

    Identifiers, dates and amounts all contain a digit or a day word. If the
    message has neither, there is nothing for the extractor to find and the
    runtime should just ask the customer.
    """
    return bool(_VALUE_LIKE.search(text or ""))


class UcxpRuntime:
    """Builds and runs the graph. One instance per process."""

    def __init__(
        self,
        engine: SarvamOrchestrator,
        *,
        registry: ManifestRegistry | None = None,
        executor: ActionExecutor | None = None,
        settings: RuntimeSettings | None = None,
        compose_with_llm: str | None = None,
    ) -> None:
        self.engine = engine
        self.settings = settings or get_settings()
        self.registry = registry or get_registry()
        self.executor = executor or ActionExecutor(self.settings)
        self.store = get_store()
        #: "auto" | "always" | "never" — see RuntimeSettings.compose_with_llm.
        self.compose_with_llm = compose_with_llm or self.settings.compose_with_llm
        self.graph = self._build()

    # ------------------------------------------------------------------ #
    # Graph wiring
    # ------------------------------------------------------------------ #
    def _build(self):
        builder = StateGraph(TurnState)
        builder.add_node("understand", self.understand)
        builder.add_node("route", self.route)
        builder.add_node("classify", self.classify)
        builder.add_node("gather", self.gather)
        builder.add_node("act", self.act)
        builder.add_node("compose", self.compose)
        builder.add_node("localize", self.localize)

        builder.add_edge(START, "understand")
        builder.add_edge("understand", "route")
        builder.add_edge("route", "classify")
        # No capability matched ⇒ nothing to execute, go straight to composing.
        builder.add_conditional_edges(
            "classify",
            lambda s: "gather" if s.get("capability_id") else "compose",
            {"gather": "gather", "compose": "compose"},
        )
        # A missing slot or a pending confirmation ends the turn with a question.
        builder.add_conditional_edges(
            "gather",
            lambda s: "compose" if s.get("missing_input") or s.get("knowledge_answer") else "act",
            {"compose": "compose", "act": "act"},
        )
        builder.add_edge("act", "compose")
        builder.add_edge("compose", "localize")
        builder.add_edge("localize", END)
        return builder.compile()

    # ------------------------------------------------------------------ #
    # 1. understand — detect language, translate to English
    # ------------------------------------------------------------------ #
    async def understand(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        text = state["raw_text"].strip()
        hint = state.get("language_hint")

        detected = hint
        if not detected:
            detection = await self.engine.detect_language(text)
            detected = detection.language.value if detection.success else "en-IN"

        english = text
        degraded: list[str] = []
        if detected != "en-IN":
            translation = await self.engine.translate(
                text, target_language="en-IN", source_language=detected
            )
            if translation.success:
                english = translation.text
            else:
                # sarvam-105b is multilingual; reasoning on the original beats failing.
                degraded.append("translate_in")
                logger.warning(f"understand.translate_failed error={translation.error}")

        logger.info(f"understand language={detected} english={english[:70]!r}")
        return {
            "language": detected,
            "english_text": english,
            "degraded": degraded,
            "latency": {"understand_ms": (time.perf_counter() - started) * 1000},
        }

    # ------------------------------------------------------------------ #
    # 2. route — which business? alias > sticky context > LLM
    # ------------------------------------------------------------------ #
    async def route(self, state: TurnState) -> dict[str, Any]:
        conversation = self.store.get_or_create(state["conversation_id"])
        text = state["english_text"]

        # The brand was named outright: no inference needed, no LLM call.
        business_id = self.registry.match_alias(text) or self.registry.match_alias(state["raw_text"])
        source = "alias"

        if not business_id and conversation.business_id:
            # Sticky: "cancel it" stays with whoever we were just talking to.
            business_id = conversation.business_id
            source = "context"

        if not business_id:
            source = "none"

        manifest = self.registry.get(business_id)
        if manifest is None:
            business_id = None
        logger.info(f"route business={business_id} source={source}")
        return {"business_id": business_id, "manifest": manifest, "business_source": source}

    # ------------------------------------------------------------------ #
    # 3. classify — LLM prompt 1
    # ------------------------------------------------------------------ #
    async def classify(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        conversation = self.store.get_or_create(state["conversation_id"])
        manifest: Manifest | None = state.get("manifest")

        # A pending yes/no short-circuits the classifier entirely.
        if conversation.awaiting_confirmation:
            answer = state["english_text"].strip().lower()
            if any(word in answer for word in CONFIRM_YES):
                logger.info("classify confirmation=yes")
                return {
                    "capability_id": conversation.pending_capability,
                    "inputs": dict(conversation.pending_inputs),
                    "confidence": 1.0,
                    "latency": {"classify_ms": 0.0},
                }
            if any(word in answer for word in CONFIRM_NO):
                conversation.clear_pending()
                logger.info("classify confirmation=no")
                return {
                    "capability_id": None,
                    "inputs": {},
                    "confidence": 1.0,
                    "denied_message": "No problem — I haven't made any changes.",
                    "latency": {"classify_ms": 0.0},
                }

        prompt = build_prompt(
            "classify",
            businesses=self.registry.routing_catalogue(),
            capabilities=manifest.capability_catalogue() if manifest else "(no business identified yet)",
            history=conversation.history_text(),
            context=conversation.context_text(),
            text=state["english_text"],
        )
        parsed = await think_json(
            self.engine, prompt, step="classify", user_text=state["english_text"]
        )

        elapsed = (time.perf_counter() - started) * 1000
        business_id = state.get("business_id")
        manifest_out = manifest

        # The classifier may identify the business when no alias matched.
        chosen_business = parsed.get("business_id")
        if not business_id and isinstance(chosen_business, str):
            candidate = self.registry.get(chosen_business)
            if candidate:
                business_id, manifest_out = candidate.id, candidate
                logger.info(f"classify business={business_id} source=llm")

        capability_id = parsed.get("capability_id")
        confidence = float(parsed.get("confidence") or 0.0)
        if capability_id and manifest_out and manifest_out.capability(capability_id) is None:
            # Validate against the manifest before acting — never trust the model's id.
            logger.warning(f"classify.invalid_capability id={capability_id}")
            capability_id = None
        if capability_id and confidence < self.settings.min_capability_confidence:
            logger.info(f"classify.low_confidence id={capability_id} confidence={confidence}")
            capability_id = None

        inputs = parsed.get("inputs")
        return {
            "business_id": business_id,
            "manifest": manifest_out,
            "capability_id": capability_id,
            "confidence": confidence,
            "inputs": inputs if isinstance(inputs, dict) else {},
            "latency": {"classify_ms": elapsed},
        }

    # ------------------------------------------------------------------ #
    # 4. gather — fill slots; LLM prompt 2 when something is missing
    # ------------------------------------------------------------------ #
    async def gather(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        conversation = self.store.get_or_create(state["conversation_id"])
        manifest: Manifest = state["manifest"]
        capability: Capability = manifest.capability(state["capability_id"])  # validated in classify

        collected: dict[str, Any] = {**conversation.pending_inputs, **(state.get("inputs") or {})}
        collected = {k: v for k, v in collected.items() if v not in (None, "")}

        # Defaults declared by the manifest, e.g. context.last_order_id.
        scope = {"context": conversation.facts}
        for required in capability.required_inputs:
            if required.name in collected or not required.default_from:
                continue
            try:
                value = render(f"{{{{{required.default_from}}}}}", scope)
            except RenderError:
                continue
            if value:
                collected[required.name] = value
                logger.info(f"gather.default {required.name}={value} from={required.default_from}")

        missing = [r for r in capability.required_inputs if not r.optional and r.name not in collected]

        # Second prompt: normalise what we have, or answer straight from the
        # docs. Only worth a round trip when something is actually missing —
        # business rules run against the *result*, so they need no LLM here.
        knowledge_answer: str | None = None
        if missing and _might_contain_value(state["english_text"]):
            prepared = await think_json(
                self.engine,
                build_prompt(
                    "prepare",
                    capability=f"{capability.id}: {capability.description}",
                    required_inputs="\n".join(
                        f"- {r.name} ({r.type}){' [optional]' if r.optional else ''}: {r.prompt}"
                        for r in capability.required_inputs
                    )
                    or "(none)",
                    collected="\n".join(f"- {k}: {v}" for k, v in collected.items()) or "(nothing yet)",
                    context=conversation.context_text(),
                    knowledge=manifest.knowledge_text() or "(no documented policies)",
                    text=state["english_text"],
                ),
                step="prepare",
                user_text=state["english_text"],
            )
            extra = prepared.get("inputs")
            if isinstance(extra, dict):
                for name, value in extra.items():
                    if value not in (None, "") and name not in collected:
                        collected[name] = value
            answer = prepared.get("answer_from_knowledge")
            if isinstance(answer, str) and answer.strip():
                knowledge_answer = answer.strip()

            missing = [r for r in capability.required_inputs if not r.optional and r.name not in collected]

        elapsed = (time.perf_counter() - started) * 1000

        if knowledge_answer and missing:
            # The docs answered them; no action needed this turn.
            conversation.clear_pending()
            return {
                "inputs": collected,
                "knowledge_answer": knowledge_answer,
                "latency": {"gather_ms": elapsed},
            }

        if missing:
            first = missing[0]
            conversation.pending_capability = capability.id
            conversation.pending_inputs = collected
            conversation.awaiting_confirmation = False
            logger.info(f"gather.needs input={first.name}")
            return {
                "inputs": collected,
                "missing_input": first.name,
                "missing_prompt": first.prompt,
                "latency": {"gather_ms": elapsed},
            }

        # Everything present. Destructive capabilities confirm first.
        if capability.confirm and not conversation.awaiting_confirmation:
            conversation.pending_capability = capability.id
            conversation.pending_inputs = collected
            conversation.awaiting_confirmation = True
            summary = ", ".join(f"{k} {v}" for k, v in collected.items())
            logger.info(f"gather.confirm capability={capability.id}")
            return {
                "inputs": collected,
                "missing_input": "__confirm__",
                "missing_prompt": f"Just to confirm — you want me to {capability.description[0].lower()}"
                f"{capability.description[1:].rstrip('.')} ({summary})?",
                "latency": {"gather_ms": elapsed},
            }

        conversation.clear_pending()
        return {"inputs": collected, "latency": {"gather_ms": elapsed}}

    # ------------------------------------------------------------------ #
    # 5. act — call the endpoint the manifest declares, then apply its rules
    # ------------------------------------------------------------------ #
    async def act(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        conversation = self.store.get_or_create(state["conversation_id"])
        manifest: Manifest = state["manifest"]
        capability: Capability = manifest.capability(state["capability_id"])
        inputs = state.get("inputs") or {}

        if not capability.action:
            return {"result": {}, "latency": {"act_ms": 0.0}}

        scope: dict[str, Any] = {**inputs, "context": conversation.facts}
        try:
            result = await self.executor.execute(manifest, capability.action, scope)
        except ActionError as exc:
            logger.error(f"act.failed capability={capability.id} error={exc.message}")
            return {
                "result": {},
                "action_error": exc.message,
                "latency": {"act_ms": (time.perf_counter() - started) * 1000},
            }

        # Business rules are evaluated against the result — data, not code.
        rule_scope = {**inputs, "result": result, "context": conversation.facts}
        for rule in capability.rules:
            try:
                triggered = evaluate_condition(rule.when, rule_scope)
            except RuleError as exc:
                logger.error(f"act.rule_error rule={rule.id} error={exc}")
                continue
            if triggered:
                logger.info(f"act.denied rule={rule.id}")
                conversation.clear_pending()
                return {
                    "result": result,
                    "denied_message": rule.deny,
                    "latency": {"act_ms": (time.perf_counter() - started) * 1000},
                }

        conversation.remember(capability.id, inputs)
        for key, value in result.items():
            if isinstance(value, (str, int, float)) and key.endswith(("_id", "_ref")):
                conversation.facts[f"last_{key}"] = value
        conversation.clear_pending()
        return {"result": result, "latency": {"act_ms": (time.perf_counter() - started) * 1000}}

    # ------------------------------------------------------------------ #
    # 6. compose — LLM prompt 3, with the manifest template as the source of truth
    # ------------------------------------------------------------------ #
    async def compose(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        conversation = self.store.get_or_create(state["conversation_id"])
        manifest: Manifest | None = state.get("manifest")
        capability = manifest.capability(state["capability_id"]) if manifest and state.get("capability_id") else None

        outcome, facts, template, status = self._outcome(state, conversation, manifest, capability)

        # A question back to the user is already perfectly worded — don't
        # paraphrase it through a model and risk losing the ask.
        if status in ("needs_input", "confirm"):
            return {
                "reply_en": template,
                "status": status,
                "receipt": None,
                "latency": {"compose_ms": 0.0},
            }

        receipt = self._receipt(capability, state) if status == "resolved" else None

        # The manifest template is the business's own wording, already correct
        # and instant. Spending a reasoning round trip to paraphrase it makes
        # the demo slower and the outcome less predictable, so by default the
        # third prompt only runs when there is nothing good to say.
        if self.compose_with_llm == "always":
            use_llm = True
        elif self.compose_with_llm == "never":
            use_llm = False
        else:
            use_llm = not template or status in ("smalltalk", "escalated")

        reply = template
        if use_llm:
            crafted = await think_text(
                self.engine,
                build_prompt(
                    "respond",
                    business_name=manifest.business.name if manifest else "Sahayak",
                    text=state["english_text"],
                    outcome=outcome,
                    facts=facts or "(no data)",
                    template=template or "(no template)",
                ),
                step="respond",
                user_text=state["english_text"],
            )
            if crafted:
                reply = crafted
            else:
                logger.warning("compose.llm_failed falling back to the manifest template")

        if not reply:
            reply = "I couldn't complete that. Let me get a human to help."
            status = "escalated"

        return {
            "reply_en": reply,
            "status": status,
            "receipt": receipt,
            "latency": {"compose_ms": (time.perf_counter() - started) * 1000},
        }

    def _outcome(
        self,
        state: TurnState,
        conversation: Conversation,
        manifest: Manifest | None,
        capability: Capability | None,
    ) -> tuple[str, str, str, str]:
        """Return ``(outcome, facts, template, status)`` for the composer."""
        if state.get("missing_input"):
            prompt = state.get("missing_prompt") or "Could you give me a bit more detail?"
            kind = "confirm" if state["missing_input"] == "__confirm__" else "needs_input"
            return ("A required detail is missing.", "", prompt, kind)

        if state.get("knowledge_answer"):
            return ("Answered from the business's documented policy.", state["knowledge_answer"], state["knowledge_answer"], "resolved")

        if state.get("denied_message"):
            return ("A business rule blocked the action.", "", state["denied_message"], "denied")

        if state.get("action_error"):
            message = manifest.escalation.message if manifest else "I'll get a human to help."
            return (f"The action failed: {state['action_error']}", "", message, "escalated")

        if capability and state.get("result") is not None:
            result = state.get("result") or {}
            scope = {**(state.get("inputs") or {}), "result": result, "context": conversation.facts}
            try:
                rendered = render(capability.response, scope)
            except RenderError as exc:
                # Loud, per PLAN §5 — a blank reply in the demo is worse.
                logger.error(f"compose.template_error capability={capability.id} error={exc}")
                rendered = ""
            facts = "\n".join(f"- {k}: {v}" for k, v in result.items() if not isinstance(v, (dict, list)))
            return ("The action completed successfully.", facts, rendered, "resolved")

        # No capability matched: greeting, thanks, or something out of scope.
        known = manifest.business.name if manifest else "Sahayak"
        catalogue = (
            "; ".join(c.description for c in manifest.capabilities) if manifest else ""
        )
        template = (
            f"I can help with {catalogue}" if catalogue else
            "I can help with orders, connections and appointments. What do you need?"
        )
        return (f"Small talk or an out-of-scope request for {known}.", "", template, "smalltalk")

    def _receipt(self, capability: Capability | None, state: TurnState) -> dict[str, Any] | None:
        if not capability or not capability.receipt:
            return None
        scope = {**(state.get("inputs") or {}), "result": state.get("result") or {}}
        try:
            label = render(capability.receipt.label, scope)
        except RenderError as exc:
            logger.error(f"compose.receipt_error capability={capability.id} error={exc}")
            return None
        return {"label": label, "tone": capability.receipt.tone} if label else None

    # ------------------------------------------------------------------ #
    # 7. localize — back into the language the customer used
    # ------------------------------------------------------------------ #
    async def localize(self, state: TurnState) -> dict[str, Any]:
        started = time.perf_counter()
        reply = state.get("reply_en", "")
        language = state.get("language", "en-IN")
        degraded = list(state.get("degraded") or [])

        if language == "en-IN" or not reply:
            return {"reply_text": reply, "latency": {"localize_ms": 0.0}}

        translation = await self.engine.translate(
            reply, target_language=language, source_language="en-IN"
        )
        if not translation.success:
            degraded.append("translate_out")
            logger.warning(f"localize.failed error={translation.error}")
            return {"reply_text": reply, "degraded": degraded, "latency": {"localize_ms": 0.0}}

        return {
            "reply_text": translation.text,
            "degraded": degraded,
            "latency": {"localize_ms": (time.perf_counter() - started) * 1000},
        }

    # ------------------------------------------------------------------ #
    # Entry point
    # ------------------------------------------------------------------ #
    async def run(
        self,
        text: str,
        *,
        conversation_id: str | None = None,
        language: str | None = None,
        user_id: str | None = None,
    ) -> tuple[TurnState, Conversation]:
        conversation = self.store.get_or_create(conversation_id, user_id)
        conversation.add_turn("user", text)

        initial: TurnState = {
            "conversation_id": conversation.id,
            "user_id": user_id,
            "raw_text": text,
            "language_hint": language,
            "inputs": {},
            "degraded": [],
            "latency": {},
            "status": "resolved",
        }
        final: TurnState = await self.graph.ainvoke(initial)

        # Persist what we learned so the next turn can say "cancel it".
        if final.get("business_id"):
            conversation.business_id = final["business_id"]
        conversation.language = final.get("language", conversation.language)
        conversation.remember(final.get("capability_id"), final.get("inputs") or {})
        conversation.add_turn("assistant", final.get("reply_en", ""))
        return final, conversation
