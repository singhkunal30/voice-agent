"""Pydantic models for the Vapi server webhook.

Sources (verified May 2026):
- https://docs.vapi.ai/tools/custom-tools — request/response shape for
  the `tool-calls` message and the `results[]` response envelope.
- https://docs.vapi.ai/server-url/events — list of server message types.
- https://docs.vapi.ai/server-url/server-authentication — auth options.

Vapi has shipped two slightly different shapes for the items in a tool-call
message over time:

  (A) Newer:
      { "id": "...", "name": "fn_name", "arguments": { ... } }

  (B) Older / OpenAI-style:
      { "id": "...", "type": "function",
        "function": { "name": "fn_name", "arguments": { ... } } }

We accept both via a model validator that normalizes onto shape (A). We
also accept `toolCallList` (current) and `toolCalls` (legacy) at the
message level.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ToolCall(BaseModel):
    """A single tool invocation requested by the assistant."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy_function_shape(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        # Shape (B): unwrap `function.{name,arguments}` onto the top level.
        if "function" in data and isinstance(data["function"], dict):
            fn = data["function"]
            data.setdefault("name", fn.get("name"))
            args = fn.get("arguments", {})
            # Vapi sometimes serializes arguments as a JSON string when it
            # streams from the model verbatim.
            if isinstance(args, str):
                import json

                try:
                    args = json.loads(args) if args else {}
                except json.JSONDecodeError:
                    args = {"_raw": args}
            data.setdefault("arguments", args)
        # Same JSON-string normalization for shape (A).
        if isinstance(data.get("arguments"), str):
            import json

            raw = data["arguments"]
            try:
                data["arguments"] = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                data["arguments"] = {"_raw": raw}
        return data


class CallInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    type: Optional[str] = None


class ToolCallsMessage(BaseModel):
    """The `message` object for a `tool-calls` server event."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    type: str
    timestamp: Optional[int] = None
    call: Optional[CallInfo] = None
    # Current field name; older payloads use `toolCalls`.
    tool_call_list: list[ToolCall] = Field(
        default_factory=list, alias="toolCallList"
    )
    tool_calls: list[ToolCall] = Field(default_factory=list, alias="toolCalls")

    def calls(self) -> list[ToolCall]:
        """Return the unified list of tool calls, preferring the newer field."""
        return self.tool_call_list or self.tool_calls


class VapiWebhookEnvelope(BaseModel):
    """Top-level body Vapi POSTs to the server URL."""

    model_config = ConfigDict(extra="ignore")

    message: ToolCallsMessage


class ToolResult(BaseModel):
    """One entry in the `results` array Vapi expects back."""

    model_config = ConfigDict(extra="ignore")

    tool_call_id: str = Field(serialization_alias="toolCallId")
    result: Optional[str] = None
    error: Optional[str] = None


class ToolWebhookResponse(BaseModel):
    """Top-level response body returned to Vapi."""

    model_config = ConfigDict(extra="ignore")

    results: list[ToolResult]
