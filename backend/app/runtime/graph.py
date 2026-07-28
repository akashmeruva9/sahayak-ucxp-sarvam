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
from .websearch import SearchUnavailable, as_context, search

#: Whole-word tokens only — substring matching once let "sri p(ha)rma" confirm
#: a pending refund. Multi-word phrases are checked separately.
CONFIRM_YES = {"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "haan", "ha", "proceed"}
CONFIRM_NO = {"no", "nope", "dont", "stop", "nahi", "cancel", "nevermind"}
CONFIRM_YES_PHRASES = ("go ahead", "do it", "please do", "yes please")

#: Said when the customer signals they're finished. Deliberately says nothing
#: about hanging up: this same reply is read in a chat window, where there is no
#: call to end. The voice channel adds that instruction itself.
FAREWELL_REPLY = "Happy to have helped — thanks for talking to us!"

#: Whole phrases only. A word like "bye" inside a sentence about something else
#: must not end the conversation, and "no" on its own is a decline, not a
#: goodbye — the pending-confirmation branch above owns that case.
FAREWELL_PHRASES = (
    "that's all", "thats all", "that is all", "that's it", "thats it",
    "nothing else", "nothing more", "no more questions", "no further questions",
    "i don't have anything else", "i dont have anything else",
    "i don't need anything else", "i dont need anything else",
    "i'm done", "im done", "i am done", "we're done", "were done",
    "end this call", "end the call", "end call", "hang up", "disconnect",
    "goodbye", "good bye", "bye bye", "thank you bye", "thanks bye",
)

#: Single words that only ever mean goodbye when they are the whole message.
FAREWELL_WORDS = {"bye", "goodbye", "cheers", "khatam", "bas", "done"}


#: Openers that are the whole message. Anything longer is a question, even when
#: it starts with one ("hi, where is my order").
GREETING_WORDS = {
    "hi", "hii", "hiya", "hey", "heya", "hello", "helo", "yo", "hola",
    "namaste", "namaskar", "namaskaram", "vanakkam", "sat sri akal", "adaab",
    "good morning", "good afternoon", "good evening", "gm", "ge",
}


def _is_greeting(text: str) -> bool:
    """True when the message is only an opener, with nothing asked."""
    cleaned = re.sub(r"[^\w\s']", " ", (text or "").lower()).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned in GREETING_WORDS


def _is_farewell(text: str) -> bool:
    """True when the customer is signing off rather than asking for something."""
    cleaned = re.sub(r"[^\w\s']", " ", (text or "").lower()).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        return False
    if cleaned in FAREWELL_WORDS:
        return True
    # "thanks" alone closes; "thanks, where is my order" does not.
    if cleaned in {"thanks", "thank you", "thank you so much", "thanks a lot"}:
        return True
    return any(phrase in cleaned for phrase in FAREWELL_PHRASES)
CONFIRM_NO_PHRASES = ("don't", "not now", "cancel that", "never mind")

#: A token that could plausibly be an identifier, date or amount.
_VALUE_LIKE = re.compile(r"\d|\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I)


def _friendly_input(name: str) -> str:
    """`order_number` → `order number`, for use in a sentence."""
    return name.replace("_", " ").replace("-", " ").strip()


#: Words that start a sentence or a question and are not a business name.
_NOT_A_NAME = {
    "i", "my", "me", "the", "a", "an", "is", "are", "was", "where", "what",
    "when", "how", "why", "can", "could", "would", "please", "hi", "hello",
    "hey", "order", "refund", "status", "help", "need", "want", "check",
    "track", "cancel", "delivery", "package", "it", "this", "that", "for",
    "from", "about", "with", "and", "or", "do", "does", "did", "you", "your",
}


def _candidate_business_name(text: str) -> str | None:
    """Pull a plausible brand name out of a message, or None.

    Capitalised runs are the signal ("my Acme order", "Acme Traders").
    Deliberately conservative: a false positive sends us searching the web for
    something that isn't a business, which is slower and reads oddly.
    """
    runs = re.findall(r"\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)", text or "")
    for run in runs:
        words = [w for w in run.split() if w.lower() not in _NOT_A_NAME]
        if not words:
            continue
        candidate = " ".join(words)
        # A single short token is usually a sentence start, not a brand.
        if len(candidate) >= 4:
            return candidate
    return None


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

        # A pinned channel (e.g. a business's own WhatsApp line) resolves against
        # exactly one business — no routing, no cross-business leakage.
        forced = state.get("forced_business_id")
        if forced:
            manifest = self.registry.get(forced)
            if manifest is not None:
                logger.info(f"route business={forced} source=pinned")
                return {"business_id": forced, "manifest": manifest, "business_source": "pinned"}
            logger.warning(f"route.pinned_unknown business={forced}")

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

        # A pending yes/no short-circuits the classifier entirely — but only for
        # an actual yes/no, and only while the customer is still talking about
        # the same business.
        #
        # This used to substring-match, so a two-letter token like "ha" inside
        # an ordinary word silently confirmed a *refund* that was pending for a
        # different business. Confirmation is now whole-word, and naming another
        # business cancels the pending action rather than inheriting it.
        if conversation.awaiting_confirmation:
            answer = state["english_text"].strip().lower()
            words = set(re.findall(r"[\w']+", answer))

            if state.get("business_source") == "alias" and conversation.business_id and \
                    state.get("business_id") != conversation.business_id:
                logger.info(
                    f"classify.confirmation_abandoned business changed "
                    f"{conversation.business_id} -> {state.get('business_id')}"
                )
                conversation.clear_pending()
            elif words & CONFIRM_YES or any(p in answer for p in CONFIRM_YES_PHRASES):
                logger.info("classify confirmation=yes")
                return {
                    "capability_id": conversation.pending_capability,
                    "inputs": dict(conversation.pending_inputs),
                    "confidence": 1.0,
                    "latency": {"classify_ms": 0.0},
                }
            if words & CONFIRM_NO or any(p in answer for p in CONFIRM_NO_PHRASES):
                conversation.clear_pending()
                logger.info("classify confirmation=no")
                return {
                    "capability_id": None,
                    "inputs": {},
                    "confidence": 1.0,
                    "denied_message": "No problem — I haven't made any changes.",
                    "latency": {"classify_ms": 0.0},
                }

        # Signing off. Checked after the pending yes/no above, so "no" answering
        # a confirmation is still a decline rather than a goodbye, and before the
        # classifier, because there is no capability to find and no reason to
        # spend a model call establishing that.
        if _is_farewell(state["english_text"]):
            logger.info("classify.farewell")
            return {
                "capability_id": None,
                "inputs": {},
                "confidence": 1.0,
                "denied_message": FAREWELL_REPLY,
                "farewell": True,
                "latency": {"classify_ms": 0.0},
            }

        # The router has already decided the business: pinned to a channel,
        # named in this message, or carried over from earlier in the chat.
        resolved = state.get("business_id")

        # No business, and none named in this message. Naming one is the only
        # way in, so ask — and skip the model entirely. Classifying against a
        # five-business catalogue to conclude "I don't know which" cost ~38 s
        # and told us nothing the router hadn't already established.
        if not resolved:
            unknown = _candidate_business_name(state["english_text"]) or _candidate_business_name(
                state["raw_text"]
            )
            logger.info(f"classify.no_business unknown={unknown!r}")
            return {
                "capability_id": None,
                "inputs": {},
                "confidence": 0.0,
                "needs_business": True,
                "unknown_business": unknown,
                "latency": {"classify_ms": 0.0},
            }

        # Nothing to classify into. A merchant onboarded without endpoints has a
        # profile and maybe some policy, and no actions at all — handing that to
        # the classifier invites it to answer with a capability the manifest
        # never declared, which the gather step then chases inputs for. That is
        # how a store with no APIs ended up asking customers for order numbers.
        # It also saves a model call on every turn for such a business.
        if manifest is not None and not manifest.capabilities:
            logger.info(f"classify.no_capabilities business={resolved}")
            return {
                "capability_id": None,
                "inputs": {},
                "confidence": 1.0,
                "latency": {"classify_ms": 0.0},
            }

        # A business is loaded — pinned, named in this message, or carried over
        # from earlier in the chat. Either way the conversation belongs to it
        # until the customer names a different one (which the router catches
        # before we get here), so classify against that manifest alone: one
        # small prompt instead of the whole directory.
        businesses = f'Already resolved: "{resolved}". Use it; do not consider any other business.'
        capabilities = manifest.capability_catalogue() if manifest else "(none)"

        prompt = build_prompt(
            "classify",
            businesses=businesses,
            capabilities=capabilities,
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

        # The router owns the business decision now — pinned, named in this
        # message, or carried over — and we return early when it found none.
        # Whatever the model echoes back for business_id is ignored, so it can
        # never route a customer to a store they didn't ask for.
        capability_id = parsed.get("capability_id")
        confidence = float(parsed.get("confidence") or 0.0)
        if capability_id and manifest_out is None:
            # A capability with no business can't be acted on — treat as smalltalk
            # rather than crashing gather on a None manifest.
            logger.warning(f"classify.capability_without_business id={capability_id}")
            capability_id = None
        elif capability_id and manifest_out.capability(capability_id) is None:
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

        # A business we don't serve: look it up so the answer is useful rather
        # than a flat "no". Runs before _outcome so it can supply the reply.
        if state.get("needs_business") and state.get("unknown_business"):
            looked_up = await self._lookup_unknown_business(state)
            if looked_up:
                return {
                    "reply_en": looked_up,
                    "status": "unknown_business",
                    "receipt": None,
                    "latency": {"compose_ms": (time.perf_counter() - started) * 1000},
                }

        outcome, facts, template, status = self._outcome(state, conversation, manifest, capability)

        # A question back to the user is already perfectly worded — don't
        # paraphrase it through a model and risk losing the ask.
        if status in ("needs_input", "confirm", "needs_business"):
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
            # Only when there is genuinely nothing renderable. Forcing a
            # reasoning call for small talk cost ~40 s to paraphrase a greeting
            # we can already write from the manifest.
            use_llm = not template

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
                    knowledge=(manifest.knowledge_text() if manifest else "")
                    or "(no documented policies)",
                    fallback=self._fallback_offer(manifest),
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

        if state.get("needs_business"):
            names = [m.business.name for m in self.registry.all()]
            listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else (names[0] if names else "")
            ask = (
                f"Which business is this about? I can help with {listed}. "
                "Tell me the name and I'll take it from there."
                if listed
                else "Which business is this about?"
            )
            return ("The customer has not said which business this is about.", "", ask, "needs_business")

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

        # No capability matched. That is a greeting, a thank-you, or a general
        # question — "what's your return policy", "what are your hours" — and
        # the last of those is most of what a business without connected APIs
        # will ever be asked.
        known = manifest.business.name if manifest else "Sahayak"
        offers = [_friendly_input(c.id) for c in (manifest.capabilities if manifest else [])]
        knowledge = bool(manifest and manifest.knowledge)

        # An opener is answered from the manifest, instantly. Paraphrasing a
        # greeting through the reasoning model costs ~40s to say hello.
        if _is_greeting(state["english_text"]):
            template = self._welcome(manifest)
            close = (
                f"and point them to what you can do here ({', '.join(offers)})."
                if offers
                else "and do not offer to look anything up."
            )
            outcome = (
                f"The customer greeted {known}. Greet them back warmly as {known} {close}"
            )
            return (outcome, "", template, "smalltalk")

        # A real question. Leaving the greeting here as the template was the
        # bug: compose only calls the model when there is no template, so every
        # question — including ones the published policies answer outright —
        # was replied to with "Hello! Welcome to ...". Handing back no template
        # is what lets the composer read the knowledge.
        if knowledge:
            outcome = (
                f"The customer asked {known} a general question. Answer it from the documented "
                f"policies below, as {known}."
            )
            return (outcome, manifest.knowledge_text(), "", "smalltalk")

        # Nothing published and nothing connected: say so rather than inventing
        # something to offer.
        template = self._welcome(manifest)
        return (
            f"The customer asked {known} a question, but {known} has published nothing and "
            "connected no services, so there is nothing to answer from.",
            "",
            template,
            "smalltalk",
        )

    async def _lookup_unknown_business(self, state: TurnState) -> str | None:
        """Search the web for a business with no manifest; None ⇒ fall through.

        Never raises into a turn: if search is unconfigured or the provider is
        down, the customer just gets the ordinary "which business?" reply.
        """
        name = state["unknown_business"]
        try:
            results = await search(f"{name} customer support contact", self.settings)
        except SearchUnavailable as exc:
            logger.info(f"compose.websearch_skipped business={name!r} reason={exc}")
            return None
        if not results:
            return None

        reply = await think_text(
            self.engine,
            build_prompt(
                "unknown_business",
                text=state["english_text"],
                business=name,
                results=as_context(results),
                available=", ".join(m.business.name for m in self.registry.all()),
            ),
            step="unknown_business",
            user_text=state["english_text"],
        )
        return reply or None

    @staticmethod
    def _welcome(manifest: Manifest | None) -> str:
        """A greeting written from the manifest — no model call.

        Small talk is the first thing anyone sends, so it sets the impression.
        Paraphrasing this through the reasoning model cost ~40 s for a sentence
        the manifest already contains everything to write.
        """
        if manifest is None:
            # The central line, where no business is resolved yet. Naming
            # "order status, refunds" here was the third copy of the same
            # assumption: what any of these businesses can do is in their
            # manifests, and this greeting does not know which one is meant.
            return (
                "Hello! I can reach the businesses on Sahayak for you. "
                "Which one can I help with?"
            )

        # Capability *ids* read cleanly ("track order", "refund"); published
        # descriptions are noun-phrases that don't fit a sentence.
        actions = [_friendly_input(c.id) for c in manifest.capabilities]

        # A merchant can be onboarded without connecting anything — a profile
        # and some published policy, no endpoints. Offering "your recent orders"
        # there, as this used to, promises a lookup that cannot happen and then
        # asks for an order number to perform it with. The manifest is the
        # contract: with no capabilities there is nothing to offer.
        if not actions:
            if manifest.knowledge:
                return (
                    f"Hello! Welcome to {manifest.business.name}. Ask me anything about them "
                    "and I'll answer from what they've published."
                )
            return (
                f"Hello! Welcome to {manifest.business.name}. They haven't connected any "
                "services here yet, so I can't look anything up for you."
            )

        offer = (
            ", ".join(actions[:-1]) + f" and {actions[-1]}" if len(actions) > 1 else actions[0]
        )
        asks = [
            i.name
            for c in manifest.capabilities
            for i in c.required_inputs
            if not i.optional
        ]
        hint = (
            f" Just share your {_friendly_input(asks[0])} whenever you're ready."
            if asks
            else ""
        )
        return f"Hello! Welcome to {manifest.business.name}. I can help with {offer}.{hint}"

    @staticmethod
    def _fallback_offer(manifest: Manifest | None) -> str:
        """What to point at when the docs don't cover the question.

        Read off the manifest, because it is the only thing that knows. The
        prompt used to name "order status and refunds" and ask for an order
        number regardless — so a merchant who had connected nothing still
        offered lookups it could not perform.
        """
        if manifest is None:
            return "ask them which business they need, and nothing else"
        offers = [_friendly_input(c.id) for c in manifest.capabilities]
        if offers:
            listed = ", ".join(offers[:-1]) + f" and {offers[-1]}" if len(offers) > 1 else offers[0]
            return f"you can help with {listed}"
        return (
            "there is nothing you can look up for them here, so say that plainly and suggest "
            "they contact the business directly"
        )

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
        force_business_id: str | None = None,
    ) -> tuple[TurnState, Conversation]:
        conversation = self.store.get_or_create(conversation_id, user_id)
        conversation.add_turn("user", text)

        initial: TurnState = {
            "conversation_id": conversation.id,
            "user_id": user_id,
            "raw_text": text,
            "language_hint": language,
            "forced_business_id": force_business_id,
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
        # Snapshot to disk so a mid-flow restart doesn't lose pending state
        # (a confirmation or an unfilled slot) between turns.
        self.store.save()
        return final, conversation
