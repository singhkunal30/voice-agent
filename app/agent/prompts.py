"""Versioned system-prompt loader.

Keeps the prompt out of code so it can be reviewed, A/B-tested, and
hot-swapped without redeploying. See prompts/system_prompt_v1.md.
"""

from __future__ import annotations

from pathlib import Path

_PROMPT_FILE = (
    Path(__file__).resolve().parent.parent.parent
    / "prompts"
    / "system_prompt_v1.md"
)


def load_system_prompt() -> str:
    return _PROMPT_FILE.read_text(encoding="utf-8").strip()
