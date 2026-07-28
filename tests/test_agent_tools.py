"""Tests for the ``/agent`` tool surface (the Samvaad integration point).

The runtime is faked — what's under test is the tool contract: lenient request
parsing, the mapping from a runtime turn to what the agent should say, and the
optional shared-secret gate. The runtime's own behaviour is covered elsewhere.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.agent_tools import execute as exec_mod  # noqa: E402
from backend.app.agent_tools.router import get_runtime_dep, router  # noqa: E402
from backend.app.memory.context import get_store  # noqa: E402
from backend.app.runtime.loader import get_registry  # noqa: E402
from backend.app.schemas.manifest import (  # noqa: E402
    BusinessInfo,
    Capability,
    Endpoint,
    Manifest,
    Receipt,
    RequiredInput,
    Rule,
)

REPO = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# Test doubles
# --------------------------------------------------------------------------- #
class FakeConversation:
    def __init__(self, cid: str) -> None:
        self.id = cid


class FakeRuntime:
    """Returns a scripted ``final`` dict and records every call."""

    def __init__(self, final: dict[str, Any]) -> None:
        self.final = final
        self.calls: list[dict[str, Any]] = []

    async def run(
        self,
        text: str,
        *,
        conversation_id: str | None = None,
        language: str | None = None,
        user_id: str | None = None,
    ):
        self.calls.append(
            {"text": text, "conversation_id": conversation_id, "language": language, "user_id": user_id}
        )
        return self.final, FakeConversation(conversation_id or "conv-1")


def make_client(final: dict[str, Any]) -> tuple[TestClient, FakeRuntime]:
    app = FastAPI()
    app.include_router(router)
    fake = FakeRuntime(final)
    app.dependency_overrides[get_runtime_dep] = lambda: fake
    return TestClient(app), fake


COMPLETED = {
    "reply_text": "Your order OD123 is out for delivery and arrives today.",
    "receipt": {"label": "Arriving today", "tone": "success"},
    "business_id": "flipkart",
    "capability_id": "track_order",
    "status": "resolved",
    "language": "te-IN",
    "degraded": [],
}


# --------------------------------------------------------------------------- #
# Mapping a completed job
# --------------------------------------------------------------------------- #
def test_completed_job_maps_to_say_and_receipt():
    client, _ = make_client(COMPLETED)
    r = client.post("/agent/resolve", json={"message": "నా Flipkart order ఎక్కడ ఉంది?"})
    assert r.status_code == 200
    body = r.json()
    assert body["say"].startswith("Your order OD123")
    assert body["done"] is True
    assert body["receipt"]["label"] == "Arriving today"
    assert body["business"] == "flipkart"
    assert body["capability"] == "track_order"
    assert body["needs_input"] is None


def test_needs_input_is_not_done():
    client, _ = make_client(
        {
            "reply_text": "What's your order ID?",
            "missing_input": "order_id",
            "missing_prompt": "What's your order ID?",
            "business_id": "flipkart",
            "status": "needs_input",
            "language": "en-IN",
        }
    )
    r = client.post("/agent/resolve", json={"message": "where is my order"})
    body = r.json()
    assert body["done"] is False
    assert body["needs_input"] == "order_id"
    assert body["receipt"] is None


def test_confirmation_gate_is_not_a_data_slot():
    client, _ = make_client(
        {
            "reply_text": "Cancel order OD9 — shall I go ahead?",
            "missing_input": "__confirm__",
            "status": "needs_input",
        }
    )
    body = client.post("/agent/resolve", json={"message": "cancel my order"}).json()
    # A yes/no gate must not surface as a slot the agent tries to collect.
    assert body["needs_input"] is None
    assert body["done"] is False


# --------------------------------------------------------------------------- #
# Lenient request parsing — Samvaad's field names aren't fixed
# --------------------------------------------------------------------------- #
def test_accepts_text_alias_for_message():
    client, fake = make_client(COMPLETED)
    r = client.post("/agent/resolve", json={"text": "track my order", "session_id": "abc"})
    assert r.status_code == 200
    assert fake.calls[0]["text"] == "track my order"
    assert fake.calls[0]["conversation_id"] == "abc"


def test_conversation_id_is_echoed_back():
    client, _ = make_client(COMPLETED)
    body = client.post("/agent/resolve", json={"message": "hi", "conversation_id": "call-42"}).json()
    assert body["conversation_id"] == "call-42"


def test_empty_message_is_rejected():
    client, _ = make_client(COMPLETED)
    assert client.post("/agent/resolve", json={}).status_code == 422


# --------------------------------------------------------------------------- #
# Optional shared-secret gate
# --------------------------------------------------------------------------- #
def test_token_gate_rejects_when_configured(monkeypatch):
    monkeypatch.setenv("UCXP_AGENT_TOOL_TOKEN", "s3cret")
    client, _ = make_client(COMPLETED)
    assert client.post("/agent/resolve", json={"message": "hi"}).status_code == 401
    ok = client.post(
        "/agent/resolve", json={"message": "hi"}, headers={"Authorization": "Bearer s3cret"}
    )
    assert ok.status_code == 200


def test_no_token_means_open(monkeypatch):
    monkeypatch.delenv("UCXP_AGENT_TOOL_TOKEN", raising=False)
    client, _ = make_client(COMPLETED)
    assert client.post("/agent/resolve", json={"message": "hi"}).status_code == 200


# --------------------------------------------------------------------------- #
# The tool specs are generated from whatever manifests are loaded
# --------------------------------------------------------------------------- #
def _loaded_capability_ids() -> set[str]:
    return {c.id for m in get_registry().all() for c in m.capabilities}


def test_tool_spec_is_generated_from_manifests():
    client, _ = make_client(COMPLETED)
    spec = client.get("/agent/tool-spec").json()
    assert spec["name"] == "resolve_customer_request"
    assert spec["method"] == "POST"
    assert spec["url"].endswith("/agent/resolve")
    # Built from the live manifests, not hardcoded: a real capability id appears.
    assert any(cid in spec["description"] for cid in _loaded_capability_ids())


def test_execute_spec_is_generated_from_manifests():
    client, _ = make_client(COMPLETED)
    spec = client.get("/agent/execute-spec").json()
    assert spec["name"] == "execute_capability"
    assert spec["url"].endswith("/agent/execute")
    # Enums are populated from whatever manifests are loaded — must be non-empty.
    assert spec["parameters"]["properties"]["business"]["enum"]
    assert spec["parameters"]["properties"]["capability"]["enum"]
    assert any(cid in spec["description"] for cid in _loaded_capability_ids())


# --------------------------------------------------------------------------- #
# The fast, Sarvam-free execute path — tested against a synthetic manifest so it
# is independent of whichever real businesses happen to be loaded.
# --------------------------------------------------------------------------- #
def _demo_manifest() -> Manifest:
    return Manifest(
        business=BusinessInfo(id="acme", name="Acme"),
        capabilities=[
            Capability(
                id="track_order",
                description="Track an order.",
                required_inputs=[
                    RequiredInput(name="order_id", prompt="What's your order ID?", default_from="context.last_order_id")
                ],
                action="get_order",
                response="Your order {{order_id}} is {{result.status}}.",
                receipt=Receipt(label="Arriving {{result.eta}}", tone="success"),
            ),
            Capability(
                id="cancel_order",
                description="Cancel an order.",
                required_inputs=[
                    RequiredInput(name="order_id", prompt="Which order?", default_from="context.last_order_id")
                ],
                confirm=True,
                action="cancel",
                response="Order {{order_id}} is cancelled.",
                receipt=Receipt(label="Cancelled", tone="success"),
                rules=[Rule(id="already_delivered", when="result.delivered == True", deny="That order is already delivered and can't be cancelled.")],
            ),
        ],
        endpoints=[Endpoint(id="get_order", url="x"), Endpoint(id="cancel", method="POST", url="x")],
    )


class _FakeRegistry:
    def __init__(self, manifest: Manifest) -> None:
        self._m = manifest

    def get(self, business_id):
        return self._m if business_id == self._m.id else None

    def all(self):
        return [self._m]


class _FakeExecutor:
    """Stands in for the HTTP action call — returns a scripted business result."""

    def __init__(self, result: dict) -> None:
        self.result = result

    async def execute(self, manifest, endpoint_id, scope):
        out = dict(self.result)
        out.setdefault("order_id", scope.get("order_id"))
        return out


def _wire(monkeypatch, result: dict) -> None:
    get_store().clear()
    monkeypatch.setattr(exec_mod, "get_registry", lambda: _FakeRegistry(_demo_manifest()))
    exec_mod._executor = _FakeExecutor(result)


async def test_execute_runs_an_action_and_returns_a_receipt(monkeypatch):
    _wire(monkeypatch, {"status": "packed", "eta": "Tuesday"})
    out = await exec_mod.run_capability("acme", "track_order", {"order_id": "OD1"})
    assert out["state"] == "resolved" and out["done"] is True
    assert out["receipt"]["label"] == "Arriving Tuesday"
    assert out["capability"] == "track_order"
    assert "OD1" in out["say"]


async def test_execute_asks_for_a_missing_required_input(monkeypatch):
    _wire(monkeypatch, {})
    out = await exec_mod.run_capability("acme", "track_order", {})
    assert out["state"] == "needs_input"
    assert out["needs_input"] == "order_id"
    assert out["done"] is False


async def test_execute_gates_a_destructive_action_on_confirmation(monkeypatch):
    _wire(monkeypatch, {"cancelled": True, "delivered": False})
    first = await exec_mod.run_capability("acme", "cancel_order", {"order_id": "OD1"})
    assert first["state"] == "confirm" and first["done"] is False
    done = await exec_mod.run_capability("acme", "cancel_order", {"order_id": "OD1"}, confirmed=True)
    assert done["state"] == "resolved" and done["done"] is True


async def test_execute_enforces_a_manifest_business_rule(monkeypatch):
    _wire(monkeypatch, {"cancelled": False, "delivered": True})
    out = await exec_mod.run_capability("acme", "cancel_order", {"order_id": "OD1"}, confirmed=True)
    assert out["state"] == "denied"
    assert "delivered" in out["say"].lower()


async def test_execute_memory_carries_order_id_across_turns(monkeypatch):
    _wire(monkeypatch, {"status": "packed", "eta": "Tue", "delivered": False, "cancelled": True})
    await exec_mod.run_capability("acme", "track_order", {"order_id": "OD9"}, conversation_id="c1")
    # Second capability omits the id — it should come from remembered facts.
    out = await exec_mod.run_capability("acme", "cancel_order", {}, conversation_id="c1", confirmed=True)
    assert out["state"] == "resolved" and out["done"] is True


async def test_execute_rejects_unknown_business_and_capability(monkeypatch):
    _wire(monkeypatch, {})
    assert (await exec_mod.run_capability("nope", "track_order", {}))["state"] == "unknown_business"
    assert (await exec_mod.run_capability("acme", "fly_me_to_the_moon", {}))["state"] == "unknown_capability"
