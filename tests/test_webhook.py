"""End-to-end tests for the webhook surface.

Uses FastAPI's TestClient — no real network, no real Vapi. Payloads are
the ones documented at https://docs.vapi.ai/tools/custom-tools as of
May 2026.
"""

import hashlib
import hmac
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def client():
    # Lazy import so conftest env vars are set first.
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    return TestClient(create_app())


def _auth_headers() -> dict:
    return {"Authorization": "Bearer test-secret"}


# ---------- auth ----------


def test_webhook_rejects_missing_auth(client):
    body = _load("tool_calls_payload.json")
    r = client.post("/vapi/webhook", json=body)
    assert r.status_code == 401


def test_webhook_rejects_wrong_secret(client):
    body = _load("tool_calls_payload.json")
    r = client.post(
        "/vapi/webhook", json=body, headers={"Authorization": "Bearer wrong"}
    )
    assert r.status_code == 401


def test_webhook_accepts_x_vapi_secret_header(client):
    body = _load("tool_calls_payload.json")
    r = client.post(
        "/vapi/webhook", json=body, headers={"X-Vapi-Secret": "test-secret"}
    )
    assert r.status_code == 200


# ---------- HMAC mode ----------


def test_webhook_accepts_valid_hmac():
    os.environ["VAPI_HMAC_ENABLED"] = "true"
    os.environ["VAPI_HMAC_SECRET"] = "hmac-secret"
    os.environ["VAPI_HMAC_HEADER"] = "x-vapi-signature"
    try:
        from app.config import get_settings
        from app.main import create_app

        get_settings.cache_clear()
        c = TestClient(create_app())

        body = _load("tool_calls_payload.json")
        raw = json.dumps(body).encode("utf-8")
        sig = hmac.new(b"hmac-secret", raw, hashlib.sha256).hexdigest()
        r = c.post(
            "/vapi/webhook",
            content=raw,
            headers={
                "content-type": "application/json",
                "x-vapi-signature": sig,
            },
        )
        assert r.status_code == 200
    finally:
        os.environ["VAPI_HMAC_ENABLED"] = "false"
        os.environ.pop("VAPI_HMAC_SECRET", None)
        from app.config import get_settings

        get_settings.cache_clear()


def test_webhook_rejects_bad_hmac():
    os.environ["VAPI_HMAC_ENABLED"] = "true"
    os.environ["VAPI_HMAC_SECRET"] = "hmac-secret"
    try:
        from app.config import get_settings
        from app.main import create_app

        get_settings.cache_clear()
        c = TestClient(create_app())

        body = _load("tool_calls_payload.json")
        r = c.post(
            "/vapi/webhook",
            json=body,
            headers={"x-vapi-signature": "deadbeef"},
        )
        assert r.status_code == 401
    finally:
        os.environ["VAPI_HMAC_ENABLED"] = "false"
        os.environ.pop("VAPI_HMAC_SECRET", None)
        from app.config import get_settings

        get_settings.cache_clear()


# ---------- payload parsing ----------


def test_webhook_lookup_order_returns_speakable(client):
    body = _load("tool_calls_payload.json")
    r = client.post("/vapi/webhook", json=body, headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert data["results"][0]["toolCallId"] == "call_01HXYZ"
    assert "ORD-1001" in data["results"][0]["result"]


def test_webhook_legacy_function_shape(client):
    body = _load("legacy_function_payload.json")
    r = client.post("/vapi/webhook", json=body, headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert data["results"][0]["toolCallId"] == "call_LEGACY"
    assert "ORD-1002" in data["results"][0]["result"]


def test_webhook_unknown_tool_returns_error_field(client):
    body = {
        "message": {
            "type": "tool-calls",
            "toolCallList": [
                {"id": "x", "name": "make_coffee", "arguments": {}}
            ],
        }
    }
    r = client.post("/vapi/webhook", json=body, headers=_auth_headers())
    assert r.status_code == 200
    out = r.json()["results"][0]
    assert out["toolCallId"] == "x"
    assert out["error"] is not None
    assert out["result"] is None


def test_webhook_non_tool_event_returns_empty_results(client):
    body = {
        "message": {
            "type": "status-update",
            "call": {"id": "c1"},
        }
    }
    r = client.post("/vapi/webhook", json=body, headers=_auth_headers())
    assert r.status_code == 200
    assert r.json() == {"results": []}


def test_webhook_invalid_json_400(client):
    r = client.post(
        "/vapi/webhook",
        content=b"not json",
        headers={"content-type": "application/json", **_auth_headers()},
    )
    assert r.status_code == 400


def test_webhook_schema_mismatch_400(client):
    r = client.post(
        "/vapi/webhook",
        json={"not": "a vapi payload"},
        headers=_auth_headers(),
    )
    assert r.status_code == 400


# ---------- health ----------


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_readyz(client):
    r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
