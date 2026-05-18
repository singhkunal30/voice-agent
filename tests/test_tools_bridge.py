"""Tests for the Pipecat <-> ToolRegistry adapter.

We don't bring up a real LLM service; we construct a minimal mock that
satisfies the `register_function` contract and exercise the handler
directly by simulating what Pipecat would do.
"""

from dataclasses import dataclass, field
from typing import Any, Callable

import pytest

from app.agent.tools_bridge import (
    _make_handler,
    build_tools_schema,
    register_tools,
)
from app.tools import build_default_registry


@dataclass
class _FakeFCParams:
    function_name: str
    arguments: dict
    result_callback: Callable[..., Any]
    tool_call_id: str = "call-1"


@dataclass
class _FakeLLM:
    registered: dict = field(default_factory=dict)

    def register_function(self, name, handler, **kwargs):
        self.registered[name] = handler


def test_tools_schema_lists_both_tools():
    schema = build_tools_schema()
    names = {t.name for t in schema.standard_tools}
    assert names == {"lookup_order", "book_appointment"}


def test_register_tools_wires_all_registry_names():
    registry = build_default_registry(external_timeout_s=1.0)
    llm = _FakeLLM()
    register_tools(llm, registry, call_id="call-x")
    assert set(llm.registered) == {"lookup_order", "book_appointment"}


async def test_bridge_returns_speakable_result_on_success():
    registry = build_default_registry(external_timeout_s=1.0)
    captured: dict = {}

    async def callback(payload):
        captured["payload"] = payload

    handler = _make_handler(registry, call_id="call-x")
    await handler(
        _FakeFCParams(
            function_name="lookup_order",
            arguments={"order_id": "ORD-1001"},
            result_callback=callback,
        )
    )
    assert "result" in captured["payload"]
    assert "ORD-1001" in captured["payload"]["result"]
    assert "shipped" in captured["payload"]["result"]


async def test_bridge_translates_tool_error_to_speakable_error():
    registry = build_default_registry(external_timeout_s=1.0)
    captured: dict = {}

    async def callback(payload):
        captured["payload"] = payload

    handler = _make_handler(registry, call_id="call-x")
    await handler(
        _FakeFCParams(
            function_name="lookup_order",
            arguments={"order_id": "ORD-9999"},
            result_callback=callback,
        )
    )
    assert "error" in captured["payload"]
    assert "ORD-9999" in captured["payload"]["error"]


async def test_bridge_handles_invalid_args_gracefully():
    registry = build_default_registry(external_timeout_s=1.0)
    captured: dict = {}

    async def callback(payload):
        captured["payload"] = payload

    handler = _make_handler(registry, call_id="call-x")
    await handler(
        _FakeFCParams(
            function_name="lookup_order",
            arguments={"order_id": "!!"},
            result_callback=callback,
        )
    )
    assert "error" in captured["payload"]
