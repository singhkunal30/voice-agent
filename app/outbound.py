"""Outbound calling endpoint.

`POST /outbound/call` triggers an outbound dial via the Vapi REST API.

Auth: bearer credential `OUTBOUND_API_KEY` (NOT the inbound webhook
secret; separate so a compromise of one doesn't grant the other).

Idempotency: when Supabase is configured AND the caller supplies an
`idempotency_key`, the audit table's UNIQUE index dedupes retries
across replicas. The flow is **SELECT-then-call-then-INSERT** so we
avoid dialing twice for honest retries; we accept a small window where
two truly concurrent requests with the same key could each dial once
(both rows can't be inserted, and we log the loss-of-race).
"""

# NOTE: deliberately no `from __future__ import annotations` here. The
# slowapi decorator wraps the route function, and FastAPI then walks
# the wrapper's annotations to build the request schema. With the
# future import enabled, string-form annotations are evaluated in
# slowapi's module globals, which don't see this module's Pydantic
# models — FastAPI then fails with PydanticUndefinedAnnotation.

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from .config import Settings, get_settings
from .logging_setup import set_call_id
from .ratelimit import OUTBOUND_LIMIT, limiter
from .schemas.outbound import OutboundCallRequest, OutboundCallResponse
from .supabase_client import PostgresError, SupabaseClient
from .vapi_client import VapiAPIError, VapiClient

log = logging.getLogger(__name__)

router = APIRouter(prefix="/outbound", tags=["outbound"])


# ---------- auth ----------


import hmac as _hmac


def _verify_bearer(
    settings: Settings, authorization: Optional[str]
) -> None:
    expected = settings.outbound_api_key
    if not expected:
        # Refuse to operate if no key is set; otherwise an empty env var
        # would silently authorize anyone.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="outbound endpoint is not configured (OUTBOUND_API_KEY)",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization[7:].strip()
    if not _hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        )


def require_outbound_auth(
    authorization: Optional[str] = Header(default=None),
) -> None:
    _verify_bearer(get_settings(), authorization)


# ---------- dependencies ----------


def get_vapi_client(request: Request) -> VapiClient:
    client: Optional[VapiClient] = getattr(request.app.state, "vapi_client", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VAPI_API_KEY is not configured",
        )
    return client


def get_supabase_client(request: Request) -> Optional[SupabaseClient]:
    """Returns the Supabase client if configured; None otherwise.

    The outbound endpoint works without Supabase — you just lose the
    audit trail and cross-replica idempotency.
    """
    return getattr(request.app.state, "supabase_client", None)


# ---------- audit-log helpers ----------


async def _find_existing(
    supabase: SupabaseClient, idempotency_key: str
) -> Optional[dict[str, Any]]:
    return await supabase.select_one(
        "outbound_calls",
        filters={"idempotency_key": f"eq.{idempotency_key}"},
        columns="id,vapi_call_id,status",
    )


async def _insert_audit_row(
    supabase: SupabaseClient,
    *,
    vapi_call_id: str,
    req: OutboundCallRequest,
) -> Optional[str]:
    """Insert the audit row. Returns the row id on success, None on
    losing an idempotency race (someone else inserted with the same
    key — call already happened, accept it)."""
    try:
        row = await supabase.insert(
            "outbound_calls",
            {
                "vapi_call_id": vapi_call_id,
                "to_number": req.to,
                "reason": req.reason,
                "variables": req.variables,
                "first_message": req.first_message,
                "idempotency_key": req.idempotency_key,
                "status": "queued",
            },
        )
        return row["id"]
    except PostgresError as exc:
        if exc.is_unique_violation and "idempotency_key" in (exc.details or "").lower():
            log.warning(
                "outbound idempotency race lost; second dial may have occurred",
                extra={
                    "idempotency_key": req.idempotency_key,
                    "to": req.to,
                    "vapi_call_id": vapi_call_id,
                },
            )
            return None
        # Anything else: the call WAS placed; don't fail the request.
        log.exception("outbound audit insert failed but call was placed")
        return None


# ---------- endpoint ----------


@router.post(
    "/call",
    response_model=OutboundCallResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_outbound_auth)],
)
@limiter.limit(OUTBOUND_LIMIT)
async def trigger_outbound_call(
    request: Request,
    payload: OutboundCallRequest,
) -> OutboundCallResponse:
    settings = get_settings()
    vapi = get_vapi_client(request)
    supabase = get_supabase_client(request)

    assistant_id = payload.assistant_id or settings.vapi_assistant_id
    phone_number_id = payload.phone_number_id or settings.vapi_phone_number_id
    if not assistant_id or not phone_number_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "assistant_id and phone_number_id must be set either on the "
                "request or via VAPI_ASSISTANT_ID / VAPI_PHONE_NUMBER_ID."
            ),
        )

    # Idempotency replay: caller asked us to dial X with the same key
    # we've already used. Return the prior result instead of dialing.
    if payload.idempotency_key and supabase is not None:
        existing = await _find_existing(supabase, payload.idempotency_key)
        if existing and existing.get("vapi_call_id"):
            log.info(
                "outbound idempotency replay",
                extra={
                    "idempotency_key": payload.idempotency_key,
                    "vapi_call_id": existing["vapi_call_id"],
                },
            )
            return OutboundCallResponse(
                outbound_call_id=existing["id"],
                vapi_call_id=existing["vapi_call_id"],
                status="duplicate",
            )

    try:
        vapi_call = await vapi.create_phone_call(
            assistant_id=assistant_id,
            phone_number_id=phone_number_id,
            to_number=payload.to,
            first_message=payload.first_message,
            variables=payload.variables or None,
            customer_name=payload.customer_name,
        )
    except VapiAPIError as exc:
        log.error(
            "vapi rejected outbound call",
            extra={"status": exc.status, "to": payload.to},
        )
        # 4xx from Vapi -> caller error; 5xx -> upstream. Bubble 502 for
        # anything in the 5xx range so the caller can distinguish.
        upstream = exc.status >= 500
        raise HTTPException(
            status_code=502 if upstream else 400,
            detail=f"Vapi error: {exc}",
        ) from exc

    vapi_call_id = str(vapi_call.get("id") or "")
    if not vapi_call_id:
        log.error("vapi response missing call id", extra={"response": vapi_call})
        raise HTTPException(
            status_code=502, detail="Vapi accepted the call but returned no id"
        )

    set_call_id(vapi_call_id)
    log.info(
        "outbound call placed",
        extra={"vapi_call_id": vapi_call_id, "to": payload.to},
    )

    outbound_id: Optional[str] = None
    if supabase is not None:
        outbound_id = await _insert_audit_row(
            supabase, vapi_call_id=vapi_call_id, req=payload
        )

    return OutboundCallResponse(
        outbound_call_id=outbound_id,
        vapi_call_id=vapi_call_id,
        status="queued",
    )
