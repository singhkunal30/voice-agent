"""End-to-end tests for the outbound calling endpoint.

We stand up the real FastAPI app and swap the Vapi and Supabase httpx
clients on `app.state` with `httpx.MockTransport`-backed ones, so the
request flow (auth -> validation -> Vapi POST -> audit insert) runs
exactly as it would in production but without the network.
"""

import json
import os
from typing import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.supabase_client import SupabaseClient
from app.vapi_client import VapiClient


VAPI_ASSISTANT_ID = "asst-test"
VAPI_PHONE_NUMBER_ID = "phn-test"
OUTBOUND_TOKEN = "outbound-test-token"


@pytest.fixture
def _outbound_env(monkeypatch):
    monkeypatch.setenv("OUTBOUND_API_KEY", OUTBOUND_TOKEN)
    monkeypatch.setenv("VAPI_API_KEY", "vapi-test-key")
    monkeypatch.setenv("VAPI_ASSISTANT_ID", VAPI_ASSISTANT_ID)
    monkeypatch.setenv("VAPI_PHONE_NUMBER_ID", VAPI_PHONE_NUMBER_ID)
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _make_app(
    vapi_handler: Callable[[httpx.Request], httpx.Response],
    supabase_handler: Callable[[httpx.Request], httpx.Response] | None = None,
):
    from app.main import create_app

    app = create_app()
    # Replace the real httpx clients with mock-transport-backed ones.
    app.state.vapi_client = VapiClient(
        api_key="vapi-test-key",
        timeout_s=2.0,
        transport=httpx.MockTransport(vapi_handler),
    )
    if supabase_handler is not None:
        app.state.supabase_client = SupabaseClient(
            url="https://stub.supabase.co",
            service_role_key="stub-key",
            timeout_s=2.0,
            transport=httpx.MockTransport(supabase_handler),
        )
    else:
        app.state.supabase_client = None
    return app


def _auth() -> dict:
    return {"Authorization": f"Bearer {OUTBOUND_TOKEN}"}


# ---------- auth ----------


def test_outbound_requires_bearer(_outbound_env):
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post("/outbound/call", json={"to": "+14155550100"})
    assert r.status_code == 401


def test_outbound_rejects_wrong_bearer(_outbound_env):
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401


def test_outbound_503_when_unconfigured(monkeypatch):
    # No OUTBOUND_API_KEY -> the endpoint refuses to operate.
    monkeypatch.setenv("OUTBOUND_API_KEY", "")
    monkeypatch.setenv("VAPI_API_KEY", "vapi-test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        app = _make_app(lambda r: httpx.Response(200, json={}))
        c = TestClient(app)
        r = c.post(
            "/outbound/call",
            json={"to": "+14155550100"},
            headers={"Authorization": "Bearer anything"},
        )
        assert r.status_code == 503
    finally:
        get_settings.cache_clear()


# ---------- validation ----------


def test_outbound_rejects_non_e164(_outbound_env):
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "415-555-0100"},  # no +country code
        headers=_auth(),
    )
    assert r.status_code == 422


def test_outbound_normalizes_spaces_and_dashes(_outbound_env):
    captured = {}

    def vapi_handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content)
        return httpx.Response(201, json={"id": "vapi-call-1", "status": "queued"})

    app = _make_app(vapi_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+1 415-555-0100"},
        headers=_auth(),
    )
    assert r.status_code == 202
    assert captured["body"]["customer"]["number"] == "+14155550100"


def test_outbound_rejects_nested_variables(_outbound_env):
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={
            "to": "+14155550100",
            "variables": {"order": {"id": "ORD-1"}},
        },
        headers=_auth(),
    )
    assert r.status_code == 422


# ---------- happy path ----------


def test_outbound_places_call_and_forwards_overrides(_outbound_env):
    captured = {}

    def vapi_handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        assert req.url.path == "/call"
        assert req.headers["authorization"] == "Bearer vapi-test-key"
        captured["body"] = json.loads(req.content)
        return httpx.Response(
            201, json={"id": "vapi-call-abc", "status": "queued"}
        )

    app = _make_app(vapi_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={
            "to": "+14155550100",
            "customer_name": "Jane Doe",
            "first_message": "Hi {{customer_name}}, about order {{order_id}}.",
            "variables": {"customer_name": "Jane Doe", "order_id": "ORD-1001"},
            "reason": "order_followup",
        },
        headers=_auth(),
    )
    assert r.status_code == 202
    body = r.json()
    assert body["vapi_call_id"] == "vapi-call-abc"
    assert body["status"] == "queued"
    assert body["outbound_call_id"] is None  # no Supabase configured

    sent = captured["body"]
    assert sent["assistantId"] == VAPI_ASSISTANT_ID
    assert sent["phoneNumberId"] == VAPI_PHONE_NUMBER_ID
    assert sent["customer"] == {"number": "+14155550100", "name": "Jane Doe"}
    overrides = sent["assistantOverrides"]
    assert overrides["firstMessage"].startswith("Hi {{customer_name}}")
    assert overrides["variableValues"]["order_id"] == "ORD-1001"


def test_outbound_missing_assistant_id_returns_400(monkeypatch, _outbound_env):
    monkeypatch.setenv("VAPI_ASSISTANT_ID", "")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        app = _make_app(lambda r: httpx.Response(200, json={}))
        c = TestClient(app)
        r = c.post(
            "/outbound/call",
            json={"to": "+14155550100"},
            headers=_auth(),
        )
        assert r.status_code == 400
    finally:
        get_settings.cache_clear()


# ---------- Vapi upstream errors ----------


def test_outbound_propagates_vapi_4xx(_outbound_env):
    def vapi_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"message": "phone number not allowed"}
        )

    app = _make_app(vapi_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers=_auth(),
    )
    assert r.status_code == 400


def test_outbound_maps_vapi_5xx_to_502(_outbound_env):
    def vapi_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "vapi down"})

    app = _make_app(vapi_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers=_auth(),
    )
    assert r.status_code == 502


# ---------- idempotency via Supabase ----------


def test_outbound_idempotency_replay_returns_existing(_outbound_env):
    vapi_calls = {"n": 0}

    def vapi_handler(req: httpx.Request) -> httpx.Response:
        vapi_calls["n"] += 1
        return httpx.Response(201, json={"id": "vapi-fresh", "status": "queued"})

    def supabase_handler(req: httpx.Request) -> httpx.Response:
        # GET /rest/v1/outbound_calls?idempotency_key=eq.dup-key&select=... returns existing.
        return httpx.Response(
            200,
            json=[
                {
                    "id": "row-existing",
                    "vapi_call_id": "vapi-original",
                    "status": "queued",
                }
            ],
        )

    app = _make_app(vapi_handler, supabase_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100", "idempotency_key": "dup-key-12345"},
        headers=_auth(),
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "duplicate"
    assert body["vapi_call_id"] == "vapi-original"
    assert body["outbound_call_id"] == "row-existing"
    assert vapi_calls["n"] == 0  # did NOT dial again


def test_outbound_inserts_audit_row_on_fresh_call(_outbound_env):
    inserted = {}

    def vapi_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            201, json={"id": "vapi-call-xyz", "status": "queued"}
        )

    def supabase_handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json=[])  # no prior row
        if req.method == "POST":
            body = json.loads(req.content)
            inserted["body"] = body
            return httpx.Response(
                201,
                json=[
                    {
                        "id": "row-new",
                        "vapi_call_id": body["vapi_call_id"],
                        "status": "queued",
                    }
                ],
            )
        raise AssertionError(f"unexpected supabase {req.method}")

    app = _make_app(vapi_handler, supabase_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={
            "to": "+14155550100",
            "idempotency_key": "fresh-key-12345",
            "reason": "appointment_reminder",
        },
        headers=_auth(),
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued"
    assert body["vapi_call_id"] == "vapi-call-xyz"
    assert body["outbound_call_id"] == "row-new"
    assert inserted["body"]["vapi_call_id"] == "vapi-call-xyz"
    assert inserted["body"]["idempotency_key"] == "fresh-key-12345"
    assert inserted["body"]["reason"] == "appointment_reminder"
