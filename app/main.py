"""FastAPI app factory.

Wires together: structured logging, the tool registry, the Twilio
inbound webhook + media-stream WebSocket, the outbound calling
endpoint, rate limiting, and health probes.

External clients owned here (one connection pool each, shared across
endpoints, closed on lifespan exit):

  * SupabaseClient        — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.
  * TwilioOutboundClient  — when Twilio creds + PUBLIC_BASE_URL set; required for outbound.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import Settings, get_settings
from .logging_setup import configure_logging
from .outbound import router as outbound_router
from .ratelimit import limiter
from .simulator_ui import mount_simulator
from .supabase_client import SupabaseClient
from .tools import build_registry
from .transport.twilio_inbound import router as twilio_router
from .transport.twilio_outbound import TwilioOutboundClient

log = logging.getLogger(__name__)


def _maybe_supabase(settings: Settings) -> Optional[SupabaseClient]:
    if settings.supabase_url and settings.supabase_service_role_key:
        return SupabaseClient(
            url=settings.supabase_url,
            service_role_key=settings.supabase_service_role_key,
            timeout_s=settings.external_call_timeout_s,
        )
    return None


def _maybe_twilio(settings: Settings) -> Optional[TwilioOutboundClient]:
    if (
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_from_number
        and settings.public_base_url
    ):
        return TwilioOutboundClient(
            account_sid=settings.twilio_account_sid,
            auth_token=settings.twilio_auth_token,
            from_number=settings.twilio_from_number,
            public_base_url=settings.public_base_url,
            timeout_s=settings.twilio_api_timeout_s,
        )
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info(
        "voice agent starting",
        extra={
            "tools": app.state.registry.names(),
            "backend": "supabase"
            if app.state.supabase_client is not None
            else "in-memory",
            "outbound_enabled": app.state.twilio_client is not None
            and bool(settings.outbound_api_key),
            "inbound_enabled": bool(
                settings.twilio_auth_token and settings.public_base_url
            ),
            "simulator_ui": "/lab"
            if getattr(app.state, "simulator_mounted", False)
            else "not built",
        },
    )
    try:
        yield
    finally:
        log.info("voice agent shutting down")
        for name in ("supabase_client", "twilio_client"):
            client = getattr(app.state, name, None)
            if client is not None:
                try:
                    await client.aclose()
                except Exception:  # pragma: no cover — best-effort
                    log.exception(
                        "client close failed", extra={"client": name}
                    )


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Voice Agent",
        version="0.2.0",
        lifespan=lifespan,
    )

    # Build eagerly so tests that don't trigger lifespan can still
    # hit the endpoints.
    supabase = _maybe_supabase(settings)
    twilio = _maybe_twilio(settings)

    app.state.supabase_client = supabase
    app.state.twilio_client = twilio
    app.state.registry = build_registry(settings, supabase_client=supabase)

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _ratelimit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limit exceeded"},
        )

    app.include_router(twilio_router)
    app.include_router(outbound_router)

    # Architecture Simulator UI at /lab. No-op unless `simulator/dist` exists,
    # so the voice agent runs unchanged whether or not the UI has been built.
    app.state.simulator_mounted = mount_simulator(app)

    @app.get("/healthz")
    async def healthz():
        # Liveness: process is up. No external I/O.
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request):
        # Readiness: registry initialized.
        ready = getattr(request.app.state, "registry", None) is not None
        return JSONResponse(
            status_code=200 if ready else 503,
            content={"status": "ready" if ready else "starting"},
        )

    return app


app = create_app()
