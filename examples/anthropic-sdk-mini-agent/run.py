"""Run the agent against the real Anthropic API.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python run.py "refund order A-1234"

The output is the same dict shape as the Skar adapter contract:
    { "tool_calls": [...], "status": ..., "output_text": ... }

You can also pipe this output to a Skar trace by hand, or use the
companion `capture_to_skar_trace.py` helper.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from agent import MODEL, SYSTEM_PROMPT, TOOLS_SCHEMA, run_agent
from tools import real_tool_executor


def main(prompt: str) -> dict[str, Any]:
    try:
        from anthropic import Anthropic
    except ImportError:
        print("This example requires the anthropic SDK. Install with: pip install anthropic", file=sys.stderr)
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

    return run_agent(prompt=prompt, claude_call=claude_call, tool_executor=real_tool_executor)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python run.py '<user prompt>'", file=sys.stderr)
        sys.exit(2)
    result = main(sys.argv[1])
    print(json.dumps(result, indent=2, default=str))
