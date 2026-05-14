"""FastAPI app factory.

Wires together: structured logging, the tool registry, the webhook
router, rate limiting on the webhook endpoint, and health probes.
Graceful shutdown is handled by uvicorn — anything that needs explicit
cleanup goes in the lifespan context.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import get_settings
from .logging_setup import configure_logging
from .ratelimit import limiter
from .tools import build_registry_from_settings
from .webhook import router as webhook_router

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info(
        "voice agent starting",
        extra={
            "tools": app.state.registry.names(),
            "hmac_enabled": settings.vapi_hmac_enabled,
            "backend": "supabase"
            if settings.supabase_url and settings.supabase_service_role_key
            else "in-memory",
        },
    )
    try:
        yield
    finally:
        log.info("voice agent shutting down")
        aclose = getattr(app.state, "aclose_backends", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # pragma: no cover — best-effort shutdown
                log.exception("backend close failed")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Vapi Voice Agent",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Build eagerly so tests that don't trigger lifespan can still hit the
    # webhook. When Supabase is configured, the returned `aclose` is awaited
    # by the lifespan exit so the httpx connection pool drains cleanly.
    registry, aclose = build_registry_from_settings(settings)
    app.state.registry = registry
    app.state.aclose_backends = aclose

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _ratelimit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limit exceeded"},
        )

    app.include_router(webhook_router)

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
