"""Tests for the Twilio inbound webhook.

The WebSocket media stream is not unit-tested end-to-end (would
require running the Pipecat pipeline against real STT/TTS/LLM). The
TwiML rendering and signature verification — the only logic we own
here — are tested directly.
"""

from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator


AUTH_TOKEN = "twilio-test-token"
PUBLIC_BASE = "https://test.example.com"


def _make_client() -> TestClient:
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    return TestClient(create_app())


def _sign(path: str, params: dict) -> str:
    return RequestValidator(AUTH_TOKEN).compute_signature(
        f"{PUBLIC_BASE}{path}", params
    )


# ---------- signature verification ----------


def test_inbound_voice_requires_signature():
    c = _make_client()
    r = c.post(
        "/twilio/voice",
        data={"CallSid": "CA1", "From": "+14155550100"},
    )
    assert r.status_code == 401


def test_inbound_voice_rejects_bad_signature():
    c = _make_client()
    r = c.post(
        "/twilio/voice",
        data={"CallSid": "CA1", "From": "+14155550100"},
        headers={"X-Twilio-Signature": "AAAA"},
    )
    assert r.status_code == 401


def test_inbound_voice_accepts_signed_request():
    c = _make_client()
    params = {"CallSid": "CA1", "From": "+14155550100", "To": "+15551230000"}
    sig = _sign("/twilio/voice", params)
    r = c.post(
        "/twilio/voice",
        data=params,
        headers={"X-Twilio-Signature": sig},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")


# ---------- TwiML content ----------


def test_inbound_voice_returns_connect_stream_twiml():
    c = _make_client()
    params = {"CallSid": "CA1", "From": "+14155550100"}
    sig = _sign("/twilio/voice", params)
    r = c.post(
        "/twilio/voice",
        data=params,
        headers={"X-Twilio-Signature": sig},
    )
    xml = r.text
    assert xml.startswith('<?xml version="1.0"')
    assert "<Connect>" in xml
    assert "<Stream" in xml
    # The Stream URL must use wss:// and point back at our /twilio/media.
    assert 'url="wss://test.example.com/twilio/media"' in xml


# ---------- health ----------


def test_healthz():
    c = _make_client()
    r = c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_readyz():
    c = _make_client()
    r = c.get("/readyz")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
