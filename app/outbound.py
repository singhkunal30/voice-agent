"""Outbound calling endpoint.

`POST /outbound/call` triggers an outbound dial via the Twilio REST
API. Auth: bearer credential `OUTBOUND_API_KEY`.

Idempotency: when Supabase is configured AND the caller supplies an
`idempotency_key`, the `outbound_calls.idempotency_key` UNIQUE index
dedupes retries across replicas. Flow is **SELECT-then-call-then-
INSERT** so honest retries don't dial twice; we accept a tiny window
where two truly concurrent same-key requests could each dial once.
"""

# NOTE: deliberately no `from __future__ import annotations`. The
# slowapi decorator wraps the route function and FastAPI then walks
# the wrapper's annotations to build the request schema — with the
# future import, string annotations are resolved in slowapi's module
# globals, which don't see this module's Pydantic types.

import hmac as _hmac
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from .config import Settings, get_settings
from .logging_setup import set_call_id
from .ratelimit import OUTBOUND_LIMIT, limiter
from .schemas.outbound import OutboundCallRequest, OutboundCallResponse
from .supabase_client import PostgresError, SupabaseClient
from .transport.twilio_outbound import TwilioAPIError, TwilioOutboundClient

log = logging.getLogger(__name__)

router = APIRouter(prefix="/outbound", tags=["outbound"])


# ---------- auth ----------


def _verify_bearer(settings: Settings, authorization: Optional[str]) -> None:
    expected = settings.outbound_api_key
    if not expected:
        # Refuse to operate if no key is set; otherwise an empty env
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


def get_twilio_client(request: Request) -> TwilioOutboundClient:
    client: Optional[TwilioOutboundClient] = getattr(
        request.app.state, "twilio_client", None
    )
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Twilio is not configured (need TWILIO_ACCOUNT_SID, "
                "TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL)"
            ),
        )
    return client


def get_supabase_client(request: Request) -> Optional[SupabaseClient]:
    """Returns the Supabase client if configured; None otherwise.

    The endpoint works without Supabase — you just lose the audit
    trail and cross-replica idempotency.
    """
    return getattr(request.app.state, "supabase_client", None)


# ---------- audit-log helpers ----------


async def _find_existing(
    supabase: SupabaseClient, idempotency_key: str
) -> Optional[dict[str, Any]]:
    return await supabase.select_one(
        "outbound_calls",
        filters={"idempotency_key": f"eq.{idempotency_key}"},
        columns="id,provider_call_id,status",
    )


async def _insert_audit_row(
    supabase: SupabaseClient,
    *,
    provider_call_id: str,
    req: OutboundCallRequest,
) -> Optional[str]:
    """Insert the audit row. Returns row id on success, None if we
    lose an idempotency race (the call already happened; accept it)."""
    try:
        row = await supabase.insert(
            "outbound_calls",
            {
                "provider_call_id": provider_call_id,
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
        if exc.is_unique_violation and "idempotency_key" in (
            exc.details or ""
        ).lower():
            log.warning(
                "outbound idempotency race lost; second dial may have occurred",
                extra={
                    "idempotency_key": req.idempotency_key,
                    "to": req.to,
                    "provider_call_id": provider_call_id,
                },
            )
            return None
        # Anything else: call WAS placed; don't fail the response.
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
    twilio = get_twilio_client(request)
    supabase = get_supabase_client(request)

    # Idempotency replay: caller asked us to dial X with the same
    # key we've already used. Return the prior result instead of
    # dialing.
    if payload.idempotency_key and supabase is not None:
        existing = await _find_existing(supabase, payload.idempotency_key)
        if existing and existing.get("provider_call_id"):
            log.info(
                "outbound idempotency replay",
                extra={
                    "idempotency_key": payload.idempotency_key,
                    "provider_call_id": existing["provider_call_id"],
                },
            )
            return OutboundCallResponse(
                outbound_call_id=existing["id"],
                provider_call_id=existing["provider_call_id"],
                status="duplicate",
            )

    try:
        twilio_call = await twilio.create_call(
            to_number=payload.to,
            first_message=payload.first_message,
            variables=payload.variables or None,
        )
    except TwilioAPIError as exc:
        log.error(
            "twilio rejected outbound call",
            extra={"status": exc.status, "to": payload.to},
        )
        upstream = exc.status >= 500
        raise HTTPException(
            status_code=502 if upstream else 400,
            detail=f"Twilio error: {exc}",
        ) from exc

    provider_call_id = str(twilio_call.get("sid") or "")
    if not provider_call_id:
        log.error(
            "twilio response missing call sid", extra={"response": twilio_call}
        )
        raise HTTPException(
            status_code=502,
            detail="Twilio accepted the call but returned no sid",
        )

    set_call_id(provider_call_id)
    log.info(
        "outbound call placed",
        extra={"provider_call_id": provider_call_id, "to": payload.to},
    )

    outbound_id: Optional[str] = None
    if supabase is not None:
        outbound_id = await _insert_audit_row(
            supabase, provider_call_id=provider_call_id, req=payload
        )

    return OutboundCallResponse(
        outbound_call_id=outbound_id,
        provider_call_id=provider_call_id,
        status="queued",
    )
