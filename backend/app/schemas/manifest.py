"""The UCXP manifest schema — PLAN.md §5.

This is the contract that makes the runtime generic: everything a business can
do is described here as *data*. The runtime reads these models and nothing else
about a business. Changing this schema changes every manifest, so update §5 in
the same change.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class BusinessInfo(BaseModel):
    id: str
    name: str
    category: str = "Other"
    glyph: str = "🏢"
    color: str = "#64748B"
    languages: list[str] = Field(default_factory=lambda: ["en-IN"])


class Routing(BaseModel):
    """Free-text hints for the business resolver. Data, not code."""

    aliases: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)


class Auth(BaseModel):
    type: Literal["none", "otp", "token"] = "none"
    identity_fields: list[str] = Field(default_factory=list)


class RequiredInput(BaseModel):
    name: str
    type: str = "string"
    prompt: str
    #: Dotted path resolved before asking the user, e.g. "context.last_order_id".
    default_from: str | None = None
    optional: bool = False


class Rule(BaseModel):
    """A business rule evaluated against the action result."""

    id: str
    when: str
    deny: str


class Receipt(BaseModel):
    """Structured proof the job completed — the UI renders this as a card."""

    label: str
    tone: Literal["info", "success", "warning"] = "info"


class Capability(BaseModel):
    id: str
    description: str
    examples: list[str] = Field(default_factory=list)
    required_inputs: list[RequiredInput] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list)
    confirm: bool = False
    action: str | None = None
    response: str = ""
    receipt: Receipt | None = None


class Endpoint(BaseModel):
    id: str
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict[str, Any] | None = None
    timeout_s: float = 5.0


class KnowledgeItem(BaseModel):
    id: str
    text: str


class Escalation(BaseModel):
    when: list[str] = Field(default_factory=list)
    message: str = "I'm handing this to a human agent."
    action: str | None = None


class Manifest(BaseModel):
    """A complete UCXP manifest."""

    ucxp_version: str = "0.1"
    business: BusinessInfo
    routing: Routing = Field(default_factory=Routing)
    auth: Auth = Field(default_factory=Auth)
    capabilities: list[Capability] = Field(default_factory=list)
    endpoints: list[Endpoint] = Field(default_factory=list)
    knowledge: list[KnowledgeItem] = Field(default_factory=list)
    escalation: Escalation = Field(default_factory=Escalation)

    # -- lookups ------------------------------------------------------- #
    @property
    def id(self) -> str:
        return self.business.id

    def capability(self, capability_id: str) -> Capability | None:
        return next((c for c in self.capabilities if c.id == capability_id), None)

    def endpoint(self, endpoint_id: str) -> Endpoint | None:
        return next((e for e in self.endpoints if e.id == endpoint_id), None)

    def knowledge_text(self) -> str:
        return "\n".join(f"- {item.text}" for item in self.knowledge)

    def capability_catalogue(self) -> str:
        """The candidate list handed to the classifier — built from data."""
        lines: list[str] = []
        for capability in self.capabilities:
            examples = "; ".join(capability.examples[:4])
            lines.append(f'- id: "{capability.id}" — {capability.description}')
            if examples:
                lines.append(f"  examples: {examples}")
            if capability.required_inputs:
                names = ", ".join(i.name for i in capability.required_inputs)
                lines.append(f"  inputs: {names}")
        return "\n".join(lines)
