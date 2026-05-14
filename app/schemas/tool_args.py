"""Per-tool argument models. Validation happens here, not in handlers."""

from __future__ import annotations

import re
from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

_ORDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
_NAME_RE = re.compile(r"^[\w\s'.,-]{1,80}$", re.UNICODE)
# Contact may be a phone number ("+1 415 555 0100", "(415) 555-0100") or an
# email. We're permissive but bounded.
_PHONE_RE = re.compile(r"^[+\d][\d\s().-]{5,30}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LookupOrderArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(..., min_length=3, max_length=32)

    @field_validator("order_id")
    @classmethod
    def _validate_order_id(cls, v: str) -> str:
        v = v.strip()
        if not _ORDER_ID_RE.match(v):
            raise ValueError(
                "order_id must be 3-32 chars of letters, digits, dash, underscore"
            )
        return v


class BookAppointmentArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    time: time
    customer_name: str = Field(..., min_length=1, max_length=80)
    contact: str = Field(..., min_length=5, max_length=80)

    @field_validator("customer_name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if not _NAME_RE.match(v):
            raise ValueError("customer_name contains invalid characters")
        return v

    @field_validator("contact")
    @classmethod
    def _validate_contact(cls, v: str) -> str:
        v = v.strip()
        if _EMAIL_RE.match(v) or _PHONE_RE.match(v):
            return v
        raise ValueError("contact must be a phone number or email address")
