"""Shared rate limiter instance.

slowapi's `limiter.limit(...)` decorator must be applied at route
definition time, which means the limiter has to exist when the webhook
module is imported. Keeping the singleton here avoids a circular import
between `main.py` and `webhook.py`.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import get_settings

_settings = get_settings()

limiter = Limiter(key_func=get_remote_address)

WEBHOOK_LIMIT = _settings.webhook_rate_limit
OUTBOUND_LIMIT = _settings.outbound_rate_limit
