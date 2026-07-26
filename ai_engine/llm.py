"""LLM reasoning.

Wraps Sarvam's OpenAI-compatible ``/v1/chat/completions`` endpoint (``sarvam-m``)
and owns conversation formatting: system prompt composition, history trimming
and message normalisation.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from loguru import logger

from .config import Settings, get_settings
from .models import ChatMessage, LLMUsage, Role, Service, Stage
from .prompts import PromptManager, get_prompt_manager
from .schemas import LLMResponse, new_request_id
from .utils import LLMError, SarvamHTTPClient, truncate

MessageLike = ChatMessage | dict[str, Any]


class LLMService:
    """Reasoning capability."""

    def __init__(
        self,
        client: SarvamHTTPClient,
        settings: Settings | None = None,
        prompts: PromptManager | None = None,
    ) -> None:
        self.client = client
        self.settings = settings or get_settings()
        self.prompts = prompts or get_prompt_manager()

    # ------------------------------------------------------------------ #
    # Conversation formatting
    # ------------------------------------------------------------------ #
    @staticmethod
    def normalize_messages(messages: Iterable[MessageLike]) -> list[ChatMessage]:
        """Accept dicts or ``ChatMessage`` objects; drop anything empty."""
        normalized: list[ChatMessage] = []
        for message in messages or []:
            if isinstance(message, ChatMessage):
                candidate = message
            elif isinstance(message, dict):
                role = message.get("role", Role.USER)
                content = message.get("content", "")
                candidate = ChatMessage(role=Role(role), content=str(content))
            else:  # pydantic models from the HTTP layer
                candidate = ChatMessage(
                    role=Role(getattr(message, "role", Role.USER)),
                    content=str(getattr(message, "content", "")),
                )
            if candidate.content.strip():
                normalized.append(candidate)
        return normalized

    def build_conversation(
        self,
        user_text: str | None = None,
        *,
        system_prompt: str | None = None,
        history: Sequence[MessageLike] | None = None,
        max_history_turns: int | None = None,
    ) -> list[ChatMessage]:
        """Assemble ``[system] + trimmed history + user`` in Sarvam's shape."""
        conversation: list[ChatMessage] = []
        if system_prompt and system_prompt.strip():
            conversation.append(ChatMessage.system(system_prompt.strip()))

        past = [m for m in self.normalize_messages(history or []) if m.role is not Role.SYSTEM]
        limit = max_history_turns if max_history_turns is not None else self.settings.llm_max_history_turns
        if limit >= 0 and len(past) > limit:
            past = past[-limit:]
        conversation.extend(past)

        if user_text and user_text.strip():
            conversation.append(ChatMessage.user(user_text.strip()))

        if not any(m.role is not Role.SYSTEM for m in conversation):
            raise LLMError("Cannot reason without at least one user message", stage=Stage.REASON)
        return conversation

    # ------------------------------------------------------------------ #
    # Completion
    # ------------------------------------------------------------------ #
    async def complete(
        self,
        messages: Sequence[MessageLike],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        model: str | None = None,
        wiki_grounding: bool | None = None,
        request_id: str | None = None,
    ) -> LLMResponse:
        """Call the chat model and return its reply."""
        request_id = request_id or new_request_id()
        conversation = self.normalize_messages(messages)
        if not conversation:
            raise LLMError("No messages to send to the model", stage=Stage.REASON)

        budget = max_tokens or self.settings.llm_max_tokens
        payload: dict[str, Any] = {
            "model": model or self.settings.llm_model,
            "messages": [m.to_wire() for m in conversation],
            "temperature": self.settings.llm_temperature if temperature is None else temperature,
            "top_p": self.settings.llm_top_p if top_p is None else top_p,
            "max_tokens": budget,
            "stream": False,
        }
        if self.settings.llm_reasoning_effort:
            payload["reasoning_effort"] = self.settings.llm_reasoning_effort
        grounding = self.settings.llm_wiki_grounding if wiki_grounding is None else wiki_grounding
        if grounding:
            payload["wiki_grounding"] = True

        elapsed = 0.0
        for attempt in (1, 2):
            body, call_ms = await self.client.request(
                "POST",
                self.settings.llm_endpoint,
                service=Service.LLM,
                json=payload,
                request_id=request_id,
            )
            elapsed += call_ms
            choice, message, content, reasoning = self._extract(body)

            if content:
                break

            # The model spent its whole budget thinking and never got to an
            # answer.  One retry with a bigger budget usually clears it.
            truncated = choice.get("finish_reason") == "length" and bool(reasoning)
            ceiling = self.settings.llm_max_tokens_ceiling
            can_grow = self.settings.llm_retry_on_truncation and payload["max_tokens"] < ceiling
            if truncated and can_grow and attempt == 1:
                payload["max_tokens"] = min(payload["max_tokens"] * 2, ceiling)
                logger.warning(
                    f"llm.truncated_reasoning reasoning_chars={len(reasoning)} "
                    f"retrying with max_tokens={payload['max_tokens']}"
                )
                continue

            if truncated:
                raise LLMError(
                    f"{payload['model']} used its entire {payload['max_tokens']}-token budget "
                    "reasoning and never produced an answer. Raise SARVAM_LLM_MAX_TOKENS "
                    "(or switch to sarvam-105b, which finishes more reliably).",
                    service=Service.LLM,
                    stage=Stage.REASON,
                    details={
                        "finish_reason": "length",
                        "max_tokens": payload["max_tokens"],
                        "reasoning_chars": len(reasoning),
                    },
                )
            raise LLMError(
                "Sarvam chat completion returned empty content",
                service=Service.LLM,
                stage=Stage.REASON,
                details={"finish_reason": choice.get("finish_reason")},
            )

        response = LLMResponse(
            request_id=request_id,
            content=content,
            model=body.get("model") or payload["model"],
            finish_reason=choice.get("finish_reason"),
            usage=LLMUsage.from_wire(body.get("usage")),
            messages=[m.to_wire() for m in conversation],
            reasoning=reasoning,
        )
        response.latency.record(Stage.REASON, elapsed)
        response.latency.total_ms = round(elapsed, 2)
        logger.info(
            f"llm.done model={response.model} tokens={response.usage.total_tokens} "
            f"reasoning_chars={len(reasoning)} latency_ms={elapsed:.0f} "
            f"text=\"{truncate(content, 80)}\""
        )
        return response

    @staticmethod
    def _extract(body: dict[str, Any]) -> tuple[dict, dict, str, str]:
        """Pull ``(choice, message, content, reasoning)`` out of a completion.

        The reasoning models put their chain of thought in ``reasoning_content``
        and leave ``content`` null until they are done thinking.
        """
        choices = body.get("choices") or []
        if not choices:
            raise LLMError(
                "Sarvam chat completion returned no choices",
                service=Service.LLM,
                stage=Stage.REASON,
                details={"body_keys": sorted(body)},
            )
        choice = choices[0] or {}
        message = choice.get("message") or {}
        content = (message.get("content") or "").strip()
        reasoning = (message.get("reasoning_content") or "").strip()
        return choice, message, content, reasoning

    async def ask(
        self,
        user_text: str,
        *,
        system_prompt: str | None = None,
        history: Sequence[MessageLike] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        request_id: str | None = None,
    ) -> LLMResponse:
        """One-shot convenience: build the conversation, then complete it."""
        conversation = self.build_conversation(
            user_text, system_prompt=system_prompt, history=history
        )
        return await self.complete(
            conversation,
            temperature=temperature,
            max_tokens=max_tokens,
            request_id=request_id,
        )
