"""Vapi server webhook handler.

Returns one entry in `results[]` per tool call. Per Vapi docs, the server
must reply HTTP 200 even for tool-level failures — the `error` field on a
result is what the assistant speaks. A non-200 response is ignored and
the assistant has no way to communicate the failure to the caller.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError

from .logging_setup import set_call_id
from .ratelimit import WEBHOOK_LIMIT, limiter
from .schemas.webhook import (
    ToolResult,
    ToolWebhookResponse,
    VapiWebhookEnvelope,
)
from .security import verify_vapi_request
from .tools import ToolRegistry
from .tools.errors import ToolError

log = logging.getLogger(__name__)

router = APIRouter()


def _parse_envelope(raw: bytes) -> VapiWebhookEnvelope:
    try:
        data = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid JSON body",
        ) from exc

    try:
        return VapiWebhookEnvelope.model_validate(data)
    except ValidationError as exc:
        log.warning("webhook schema mismatch", extra={"errors": exc.errors()})
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload does not match expected Vapi webhook schema",
        ) from exc


def get_registry(request: Request) -> ToolRegistry:
    registry: ToolRegistry | None = getattr(request.app.state, "registry", None)
    if registry is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="tool registry not initialized",
        )
    return registry


@router.post("/vapi/webhook", response_model=ToolWebhookResponse)
@limiter.limit(WEBHOOK_LIMIT)
async def vapi_webhook(
    request: Request,
    raw_body: bytes = Depends(verify_vapi_request),
) -> ToolWebhookResponse:
    envelope = _parse_envelope(raw_body)
    msg = envelope.message
    registry = get_registry(request)

    # Only `tool-calls` produces results. Other server events (status
    # updates, end-of-call, transcripts) are acknowledged with an empty
    # results array so retries don't loop.
    if msg.type != "tool-calls":
        log.info("ignored server event", extra={"event_type": msg.type})
        return ToolWebhookResponse(results=[])

    call_id = msg.call.id if msg.call else None
    set_call_id(call_id)

    calls = msg.calls()
    if not calls:
        log.warning("tool-calls message with no tool calls")
        return ToolWebhookResponse(results=[])

    results: list[ToolResult] = []
    for call in calls:
        started = time.perf_counter()
        try:
            output = await registry.dispatch(
                call.name, call.arguments, call_id=call_id
            )
            results.append(ToolResult(tool_call_id=call.id, result=output))
            log.info(
                "tool ok",
                extra={
                    "tool": call.name,
                    "tool_call_id": call.id,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
        except ToolError as exc:
            results.append(ToolResult(tool_call_id=call.id, error=exc.speakable))
            log.info(
                "tool error",
                extra={
                    "tool": call.name,
                    "tool_call_id": call.id,
                    "code": exc.code,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
        except Exception:  # pragma: no cover — defensive only
            log.exception(
                "unhandled tool exception",
                extra={"tool": call.name, "tool_call_id": call.id},
            )
            results.append(
                ToolResult(
                    tool_call_id=call.id,
                    error=(
                        "Something went wrong on my end. "
                        "Could you try that again?"
                    ),
                )
            )

    return ToolWebhookResponse(results=results)
