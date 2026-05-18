"""Inbound Twilio call handling.

Two endpoints:

* `POST /twilio/voice` — Twilio webhook. We reply with TwiML that
  tells Twilio to open a bidirectional Media Stream WebSocket back at
  us. Signature-verified.

* `WS /twilio/media` — the WebSocket Twilio opens. We hand it to the
  Pipecat pipeline, which then owns the call.

The WebSocket itself is NOT signature-protected at the HTTP layer —
Twilio doesn't sign WS upgrades — but it's only useful with a valid
`streamSid` issued by Twilio for an in-flight call, and the
TwilioFrameSerializer rejects mis-routed frames. For belt-and-braces
we could also issue a one-time token in the TwiML URL.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from ..agent.pipeline import run_call
from ..config import get_settings
from ..logging_setup import set_call_id
from ..tools import ToolRegistry
from .twilio_signature import verify_twilio_signature

log = logging.getLogger(__name__)

router = APIRouter(prefix="/twilio", tags=["twilio"])


def _media_stream_wss_url(public_base_url: str) -> str:
    base = (public_base_url or "").rstrip("/")
    # Twilio needs wss://; substitute the scheme if the operator gave
    # us an https:// base URL (the common case from ngrok).
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    return f"{base}/twilio/media"


def _twiml_for_stream(public_base_url: str) -> str:
    """TwiML telling Twilio to stream audio bidirectionally to us."""
    wss_url = _media_stream_wss_url(public_base_url)
    # <Connect> blocks until the WebSocket disconnects, which is what
    # we want — the agent IS the call. Use <Start><Stream> for
    # parallel-monitoring use cases instead.
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Connect><Stream url="{wss_url}"/></Connect>'
        "</Response>"
    )


@router.post("/voice", dependencies=[Depends(verify_twilio_signature)])
async def twilio_voice_webhook(request: Request) -> Response:
    settings = get_settings()
    if not settings.public_base_url:
        return Response(
            status_code=503,
            content="PUBLIC_BASE_URL is not configured",
        )
    xml = _twiml_for_stream(settings.public_base_url)
    return Response(content=xml, media_type="application/xml")


def _get_registry(websocket: WebSocket) -> ToolRegistry:
    registry: ToolRegistry | None = getattr(
        websocket.app.state, "registry", None
    )
    if registry is None:
        raise RuntimeError("tool registry not initialized")
    return registry


@router.websocket("/media")
async def twilio_media_stream(websocket: WebSocket) -> None:
    await websocket.accept()

    # Twilio sends a `connected` frame first, then `start` which
    # carries the streamSid and callSid we need. Anything we receive
    # before `start` we drop.
    stream_sid: str | None = None
    call_sid: str | None = None
    try:
        for _ in range(8):  # bounded — should be 1 or 2 messages.
            raw = await websocket.receive_text()
            data = json.loads(raw)
            event = data.get("event")
            if event == "start":
                start = data.get("start", {})
                stream_sid = start.get("streamSid")
                call_sid = start.get("callSid")
                break
    except (WebSocketDisconnect, json.JSONDecodeError, KeyError):
        log.exception("twilio stream setup failed")
        await websocket.close(code=1011)
        return

    if not stream_sid or not call_sid:
        log.warning("twilio stream missing streamSid/callSid")
        await websocket.close(code=1008)
        return

    set_call_id(call_sid)
    log.info(
        "twilio stream started",
        extra={"stream_sid": stream_sid, "call_sid": call_sid},
    )

    try:
        await run_call(
            websocket=websocket,
            stream_sid=stream_sid,
            call_sid=call_sid,
            settings=get_settings(),
            registry=_get_registry(websocket),
        )
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("call pipeline raised", extra={"call_sid": call_sid})
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
