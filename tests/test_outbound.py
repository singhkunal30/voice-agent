"""End-to-end tests for the outbound calling endpoint.

We stand up the real FastAPI app and swap the Twilio and Supabase
httpx clients on `app.state` with `httpx.MockTransport`-backed ones,
so the request flow (auth -> validation -> Twilio POST -> audit
insert) runs exactly as it would in production but without the
network.
"""

import json
from typing import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.supabase_client import SupabaseClient
from app.transport.twilio_outbound import TwilioOutboundClient


ACCOUNT_SID = "ACtest0000000000000000000000000000"
AUTH_TOKEN = "twilio-test-token"
FROM_NUMBER = "+15551230000"
PUBLIC_BASE = "https://test.example.com"
OUTBOUND_TOKEN = "outbound-test-token"


def _make_app(
    twilio_handler: Callable[[httpx.Request], httpx.Response],
    supabase_handler: Callable[[httpx.Request], httpx.Response] | None = None,
):
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    app = create_app()
    # Swap the real httpx clients on app.state for mock-transport ones.
    app.state.twilio_client = TwilioOutboundClient(
        account_sid=ACCOUNT_SID,
        auth_token=AUTH_TOKEN,
        from_number=FROM_NUMBER,
        public_base_url=PUBLIC_BASE,
        timeout_s=2.0,
        transport=httpx.MockTransport(twilio_handler),
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


def test_outbound_requires_bearer():
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post("/outbound/call", json={"to": "+14155550100"})
    assert r.status_code == 401


def test_outbound_rejects_wrong_bearer():
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401


def test_outbound_503_when_unconfigured(monkeypatch):
    monkeypatch.setenv("OUTBOUND_API_KEY", "")
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


def test_outbound_rejects_non_e164():
    app = _make_app(lambda r: httpx.Response(200, json={}))
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "415-555-0100"},
        headers=_auth(),
    )
    assert r.status_code == 422


def test_outbound_normalizes_spaces_and_dashes():
    captured = {}

    def twilio_handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = req.content.decode()
        return httpx.Response(
            201, json={"sid": "CA1234567890abcdef", "status": "queued"}
        )

    app = _make_app(twilio_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+1 415-555-0100"},
        headers=_auth(),
    )
    assert r.status_code == 202
    # Twilio REST uses form-encoded bodies.
    assert "To=%2B14155550100" in captured["body"]


def test_outbound_rejects_nested_variables():
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


def test_outbound_places_call_and_forwards_overrides():
    captured = {}

    def twilio_handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        assert req.url.path == f"/2010-04-01/Accounts/{ACCOUNT_SID}/Calls.json"
        # HTTP Basic auth using account sid + auth token.
        assert req.headers["authorization"].startswith("Basic ")
        captured["body"] = req.content.decode()
        return httpx.Response(
            201,
            json={"sid": "CAabc123", "status": "queued", "to": "+14155550100"},
        )

    app = _make_app(twilio_handler)
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
    assert body["provider_call_id"] == "CAabc123"
    assert body["status"] == "queued"
    assert body["outbound_call_id"] is None  # no Supabase configured

    sent = captured["body"]
    assert "To=%2B14155550100" in sent
    assert f"From={FROM_NUMBER.replace('+', '%2B')}" in sent
    # The TwiML URL Twilio fetches must point at us with overrides in
    # query params.
    assert "Url=https%3A%2F%2Ftest.example.com%2Ftwilio%2Fvoice" in sent
    assert "first_message" in sent  # encoded into Url param
    assert "var_order_id" in sent


# ---------- upstream errors ----------


def test_outbound_propagates_twilio_4xx():
    def twilio_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"message": "phone number not allowed"}
        )

    app = _make_app(twilio_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers=_auth(),
    )
    assert r.status_code == 400


def test_outbound_maps_twilio_5xx_to_502():
    def twilio_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "twilio down"})

    app = _make_app(twilio_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100"},
        headers=_auth(),
    )
    assert r.status_code == 502


# ---------- idempotency via Supabase ----------


def test_outbound_idempotency_replay_returns_existing():
    twilio_calls = {"n": 0}

    def twilio_handler(req: httpx.Request) -> httpx.Response:
        twilio_calls["n"] += 1
        return httpx.Response(201, json={"sid": "CA-fresh", "status": "queued"})

    def supabase_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "id": "row-existing",
                    "provider_call_id": "CA-original",
                    "status": "queued",
                }
            ],
        )

    app = _make_app(twilio_handler, supabase_handler)
    c = TestClient(app)
    r = c.post(
        "/outbound/call",
        json={"to": "+14155550100", "idempotency_key": "dup-key-12345"},
        headers=_auth(),
    )
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "duplicate"
    assert body["provider_call_id"] == "CA-original"
    assert body["outbound_call_id"] == "row-existing"
    assert twilio_calls["n"] == 0


def test_outbound_inserts_audit_row_on_fresh_call():
    inserted = {}

    def twilio_handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            201, json={"sid": "CA-xyz", "status": "queued"}
        )

    def supabase_handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json=[])
        if req.method == "POST":
            body = json.loads(req.content)
            inserted["body"] = body
            return httpx.Response(
                201,
                json=[
                    {
                        "id": "row-new",
                        "provider_call_id": body["provider_call_id"],
                        "status": "queued",
                    }
                ],
            )
        raise AssertionError(f"unexpected supabase {req.method}")

    app = _make_app(twilio_handler, supabase_handler)
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
    assert body["provider_call_id"] == "CA-xyz"
    assert body["outbound_call_id"] == "row-new"
    assert inserted["body"]["provider_call_id"] == "CA-xyz"
    assert inserted["body"]["idempotency_key"] == "fresh-key-12345"
    assert inserted["body"]["reason"] == "appointment_reminder"
