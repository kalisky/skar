"""Run the agent against the real Anthropic API, capturing a Skar trace.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python run.py "refund order A-1234"

This runs the real agent (real Anthropic API + real tools) and writes a
Skar trace JSON to `traces/<slug>.json`. Feed that trace into
`skar generate` to produce a pytest regression test.

The trace is captured via SkarRecorder, which wraps the tool executor and
records each call/result transparently — no separate "capture mode" in
the agent code itself.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from agent import MODEL, SYSTEM_PROMPT, TOOLS_SCHEMA, run_agent
from skar_capture import SkarRecorder
from tools import real_tool_executor


def _slug(text: str, max_len: int = 50) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:max_len] or "run"


def main(prompt: str) -> dict[str, Any]:
    try:
        from anthropic import Anthropic
    except ImportError:
        print("This example requires the anthropic SDK. Install: pip install anthropic", file=sys.stderr)
        sys.exit(2)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY before running.", file=sys.stderr)
        sys.exit(2)

    client = Anthropic()

    def claude_call(messages: list[dict[str, Any]]) -> Any:
        return client.messages.create(
            model=MODEL,
            system=SYSTEM_PROMPT,
            tools=TOOLS_SCHEMA,
            messages=messages,
            max_tokens=1024,
        )

    recorder = SkarRecorder()
    result = run_agent(
        prompt=prompt,
        claude_call=claude_call,
        tool_executor=recorder.wrap(real_tool_executor),
    )

    trace_path = Path(__file__).parent / "traces" / f"{_slug(prompt)}.json"
    recorder.write(
        trace_path,
        prompt=prompt,
        # Real runs don't carry an explicit success/failure signal — leave as
        # "unknown" and let the engineer set it before generating a test.
        status="unknown",
        output_text=result.get("output_text"),
    )
    print(f"Wrote Skar trace: {trace_path}", file=sys.stderr)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python run.py '<user prompt>'", file=sys.stderr)
        sys.exit(2)
    result = main(sys.argv[1])
    print(json.dumps(result, indent=2, default=str))
