"""Structured (JSON) logging with a per-call correlation ID.

A `contextvars.ContextVar` carries the current Vapi call ID across
async boundaries so every log line emitted while handling a request
includes it without callers needing to pass it around.
"""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar
from typing import Optional

from pythonjsonlogger import jsonlogger

_call_id_ctx: ContextVar[Optional[str]] = ContextVar("call_id", default=None)


def set_call_id(call_id: Optional[str]) -> None:
    _call_id_ctx.set(call_id)


def get_call_id() -> Optional[str]:
    return _call_id_ctx.get()


class _CallIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.call_id = _call_id_ctx.get()
        return True


def configure_logging(level: str = "INFO") -> None:
    """Idempotently install JSON logging on the root logger."""
    root = logging.getLogger()
    root.setLevel(level.upper())

    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(_CallIdFilter())
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(call_id)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)

    # Quiet down access logs from uvicorn — we log our own request lines.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
