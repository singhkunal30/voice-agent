"""Tool-layer exceptions.

`ToolError` carries a `speakable` field — a short, voice-friendly phrase
the assistant can read back to the caller. The webhook layer translates
this into the per-tool error string Vapi expects.
"""

from __future__ import annotations


class ToolError(Exception):
    """Raised by tool handlers for any expected, recoverable failure."""

    def __init__(self, speakable: str, *, code: str = "tool_error"):
        super().__init__(speakable)
        self.speakable = speakable
        self.code = code
