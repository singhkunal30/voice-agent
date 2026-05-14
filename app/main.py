"""FastAPI app factory.

Wires together: structured logging, the tool registry, the inbound
webhook router, the outbound calling router, rate limiting, and
health probes.

External clients owned here (one connection pool each, shared across
the registry + outbound endpoint, closed on lifespan exit):

  * SupabaseClient — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.
  * VapiClient     — when VAPI_API_KEY set; required for outbound.
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
from .supabase_client import SupabaseClient
from .tools import build_registry
from .vapi_client import VapiClient
from .webhook import router as webhook_router

log = logging.getLogger(__name__)


def _maybe_supabase(settings: Settings) -> Optional[SupabaseClient]:
    if settings.supabase_url and settings.supabase_service_role_key:
        return SupabaseClient(
            url=settings.supabase_url,
            service_role_key=settings.supabase_service_role_key,
            timeout_s=settings.external_call_timeout_s,
        )
    return None


def _maybe_vapi(settings: Settings) -> Optional[VapiClient]:
    if settings.vapi_api_key:
        return VapiClient(
            api_key=settings.vapi_api_key,
            base_url=settings.vapi_api_base,
            timeout_s=settings.vapi_api_timeout_s,
        )
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info(
        "voice agent starting",
        extra={
            "tools": app.state.registry.names(),
            "hmac_enabled": settings.vapi_hmac_enabled,
            "backend": "supabase"
            if app.state.supabase_client is not None
            else "in-memory",
            "outbound_enabled": app.state.vapi_client is not None
            and bool(settings.outbound_api_key),
        },
    )
    try:
        yield
    finally:
        log.info("voice agent shutting down")
        for name in ("supabase_client", "vapi_client"):
            client = getattr(app.state, name, None)
            if client is not None:
                try:
                    await client.aclose()
                except Exception:  # pragma: no cover — best-effort
                    log.exception("client close failed", extra={"client": name})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Vapi Voice Agent",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Build eagerly so tests that don't trigger lifespan can still hit
    # the endpoints.
    supabase = _maybe_supabase(settings)
    vapi = _maybe_vapi(settings)

    app.state.supabase_client = supabase
    app.state.vapi_client = vapi
    app.state.registry = build_registry(settings, supabase_client=supabase)

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _ratelimit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limit exceeded"},
        )

    app.include_router(webhook_router)
    app.include_router(outbound_router)

    @app.get("/healthz")
    async def healthz():
        # Liveness: process is up. No external I/O.
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request):
        # Readiness: registry initialized and ready to dispatch.
        ready = getattr(request.app.state, "registry", None) is not None
        return JSONResponse(
            status_code=200 if ready else 503,
            content={"status": "ready" if ready else "starting"},
        )

    return app


app = create_app()
