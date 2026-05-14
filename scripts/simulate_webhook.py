#!/usr/bin/env python3
"""Simulate a Vapi tool-call webhook against a running server.

Usage:
    python scripts/simulate_webhook.py [--url URL] [--tool lookup_order|book_appointment]
                                       [--hmac]

The payload shape matches the one documented at
https://docs.vapi.ai/tools/custom-tools as of May 2026.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import uuid
from datetime import date, time, timedelta

import httpx


def _payload(tool: str) -> dict:
    call_id = f"sim-call-{uuid.uuid4().hex[:8]}"
    tool_call_id = f"call_{uuid.uuid4().hex[:10]}"
    if tool == "lookup_order":
        args = {"order_id": "ORD-1001"}
    elif tool == "book_appointment":
        d = date.today() + timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        args = {
            "date": d.isoformat(),
            "time": time(10, 0).isoformat(),
            "customer_name": "Pat Example",
            "contact": "+1 415 555 0123",
        }
    else:
        raise SystemExit(f"unknown tool: {tool}")

    return {
        "message": {
            "timestamp": 0,
            "type": "tool-calls",
            "toolCallList": [{"id": tool_call_id, "name": tool, "arguments": args}],
            "call": {"id": call_id, "type": "inboundPhoneCall"},
        }
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000/vapi/webhook")
    p.add_argument(
        "--tool",
        default="lookup_order",
        choices=["lookup_order", "book_appointment"],
    )
    p.add_argument(
        "--hmac",
        action="store_true",
        help="Sign the body with VAPI_HMAC_SECRET instead of using the bearer secret.",
    )
    args = p.parse_args()

    body = _payload(args.tool)
    raw = json.dumps(body).encode("utf-8")

    headers = {"content-type": "application/json"}
    if args.hmac:
        secret = os.environ.get("VAPI_HMAC_SECRET", "")
        if not secret:
            print("VAPI_HMAC_SECRET not set", file=sys.stderr)
            return 2
        header_name = os.environ.get("VAPI_HMAC_HEADER", "x-vapi-signature")
        headers[header_name] = hmac.new(
            secret.encode("utf-8"), raw, hashlib.sha256
        ).hexdigest()
    else:
        secret = os.environ.get("VAPI_SERVER_SECRET", "")
        if not secret:
            print("VAPI_SERVER_SECRET not set", file=sys.stderr)
            return 2
        headers["Authorization"] = f"Bearer {secret}"

    r = httpx.post(args.url, content=raw, headers=headers, timeout=10.0)
    print(f"HTTP {r.status_code}")
    try:
        print(json.dumps(r.json(), indent=2))
    except Exception:
        print(r.text)
    return 0 if r.status_code == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
