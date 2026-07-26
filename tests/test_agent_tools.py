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

import httpx  # noqa: E402

from backend.app.agent_tools import execute as exec_mod  # noqa: E402
from backend.app.agent_tools.router import get_runtime_dep, router  # noqa: E402
from backend.app.config import RuntimeSettings  # noqa: E402
from backend.app.memory.context import get_store  # noqa: E402
from backend.app.mock.router import router as mock_router  # noqa: E402
from backend.app.runtime.executor import ActionExecutor  # noqa: E402

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
# The tool spec is generated from the live manifests
# --------------------------------------------------------------------------- #
def test_tool_spec_lists_real_businesses():
    client, _ = make_client(COMPLETED)
    spec = client.get("/agent/tool-spec").json()
    assert spec["name"] == "resolve_customer_request"
    assert spec["method"] == "POST"
    assert spec["url"].endswith("/agent/resolve")
    # Built from manifests, not hardcoded — the three demo brands must show up.
    for brand in ("Flipkart", "Airtel", "Apollo"):
        assert brand in spec["description"]


# --------------------------------------------------------------------------- #
# The fast, Sarvam-free execute path (real manifests + mock business APIs)
# --------------------------------------------------------------------------- #
def _wire_executor() -> None:
    """Point the execute path's action executor at the in-process mock APIs."""
    get_store().clear()
    app = FastAPI()
    app.include_router(mock_router)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mock")
    cfg = RuntimeSettings(manifests_dir=REPO / "manifests", mock_base_url="http://mock/mock")
    exec_mod._executor = ActionExecutor(cfg, client=client)


async def test_execute_runs_a_real_action_and_returns_a_receipt():
    _wire_executor()
    out = await exec_mod.run_capability("flipkart", "track_order", {"order_id": "OD123456"})
    assert out["state"] == "resolved"
    assert out["done"] is True
    assert out["receipt"] and out["receipt"]["label"]
    assert out["capability"] == "track_order"
    assert "OD123456" in out["say"]


async def test_execute_asks_for_a_missing_required_input():
    _wire_executor()
    out = await exec_mod.run_capability("flipkart", "track_order", {})
    assert out["state"] == "needs_input"
    assert out["needs_input"] == "order_id"
    assert out["done"] is False


async def test_execute_gates_a_destructive_action_on_confirmation():
    _wire_executor()
    # OD100 is a cancellable (not-yet-delivered) order in the deterministic mock.
    first = await exec_mod.run_capability("flipkart", "cancel_order", {"order_id": "OD100"})
    assert first["state"] == "confirm"
    assert first["done"] is False
    done = await exec_mod.run_capability(
        "flipkart", "cancel_order", {"order_id": "OD100"}, confirmed=True
    )
    assert done["state"] == "resolved"
    assert done["done"] is True


async def test_execute_memory_carries_order_id_across_turns():
    _wire_executor()
    await exec_mod.run_capability("flipkart", "track_order", {"order_id": "OD200"}, conversation_id="c1")
    # Second capability omits the id — it should come from remembered facts.
    out = await exec_mod.run_capability("flipkart", "cancel_order", {}, conversation_id="c1", confirmed=True)
    assert out["state"] == "resolved"
    assert out["done"] is True


async def test_execute_rejects_unknown_business_and_capability():
    _wire_executor()
    assert (await exec_mod.run_capability("nope", "track_order", {}))["state"] == "unknown_business"
    assert (await exec_mod.run_capability("flipkart", "fly_me_to_the_moon", {}))["state"] == "unknown_capability"


def test_execute_spec_enumerates_capabilities_with_inputs():
    client, _ = make_client(COMPLETED)
    spec = client.get("/agent/execute-spec").json()
    assert spec["name"] == "execute_capability"
    assert spec["url"].endswith("/agent/execute")
    assert "flipkart" in spec["parameters"]["properties"]["business"]["enum"]
    assert "track_order" in spec["parameters"]["properties"]["capability"]["enum"]
    assert "order_id" in spec["description"]
