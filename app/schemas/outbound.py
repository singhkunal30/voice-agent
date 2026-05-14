"""Request and response models for the outbound-call endpoint."""

from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# E.164: leading '+', country code 1-9, total 7-15 digits.
_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


class OutboundCallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to: str = Field(..., description="Destination phone number in E.164.")
    first_message: Optional[str] = Field(
        default=None,
        max_length=500,
        description=(
            "Override the assistant's opening line. May contain "
            "{{variableName}} placeholders that Vapi substitutes from "
            "`variables`."
        ),
    )
    variables: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Per-call variable values passed to the assistant for "
            "prompt + firstMessage templating."
        ),
    )
    customer_name: Optional[str] = Field(default=None, max_length=80)
    reason: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Free-form label persisted in the audit log.",
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        description=(
            "Caller-supplied dedup key. If provided and Supabase is "
            "configured, a retry with the same key returns the "
            "original call instead of dialing again."
        ),
    )
    # Optional per-request overrides; defaults come from env.
    assistant_id: Optional[str] = None
    phone_number_id: Optional[str] = None

    @field_validator("to")
    @classmethod
    def _validate_e164(cls, v: str) -> str:
        v = v.strip().replace(" ", "").replace("-", "")
        if not _E164_RE.match(v):
            raise ValueError(
                "phone number must be in E.164 format, e.g. +14155550100"
            )
        return v

    @field_validator("variables")
    @classmethod
    def _validate_variables(cls, v: dict[str, Any]) -> dict[str, Any]:
        # Vapi's variableValues is a flat string→string-ish map. Reject
        # nested objects so the caller gets a clear error instead of
        # surprising templating behavior.
        for key, val in v.items():
            if not isinstance(key, str) or not key:
                raise ValueError("variable keys must be non-empty strings")
            if isinstance(val, (dict, list)):
                raise ValueError(
                    f"variable '{key}' must be a scalar (str/number/bool)"
                )
        return v


class OutboundCallResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    outbound_call_id: Optional[str] = Field(
        default=None,
        description="Our audit-log row ID (only when Supabase is configured).",
    )
    vapi_call_id: str
    status: str = Field(
        ...,
        description="`queued` for a fresh dial, `duplicate` for an idempotent replay.",
    )
