"""Run the LangChain agent against the real Anthropic API and capture a Skar trace.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python run.py "refund order A-1234"

Writes a Skar trace JSON to traces/<prompt-slug>.json. Feed that into
`skar generate` to produce a pytest regression test.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent import build_agent
from skar import Recorder
from skar_lc_capture import SkarCaptureCallback


MODEL = "claude-3-5-sonnet-20241022"


def _slug(text: str, max_len: int = 50) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:max_len] or "run"


def _final_text(messages: list[Any]) -> str:
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            content = m.content
            if isinstance(content, str) and content:
                return content
    return ""


def main(prompt: str) -> dict[str, Any]:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY before running.", file=sys.stderr)
        sys.exit(2)

    model = ChatAnthropic(model=MODEL, max_tokens=1024)
    agent = build_agent(model)

    recorder = Recorder()
    result = agent.invoke(
        {"messages": [HumanMessage(content=prompt)]},
        config={"callbacks": [SkarCaptureCallback(recorder)]},
    )

    final_text = _final_text(result.get("messages", []))
    trace_path = Path(__file__).parent / "traces" / f"{_slug(prompt)}.json"
    recorder.write(
        trace_path,
        prompt=prompt,
        status="unknown",  # set explicitly before generating a test if known
        output_text=final_text or None,
    )
    print(f"Wrote Skar trace: {trace_path}", file=sys.stderr)

    return {
        "tool_calls": [
            {"tool_name": ev["tool_name"], "arguments": ev["arguments"]}
            for ev in recorder.events
        ],
        "status": "success" if recorder.events else "no_tools_called",
        "output_text": final_text,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python run.py '<user prompt>'", file=sys.stderr)
        sys.exit(2)
    out = main(sys.argv[1])
    print(json.dumps(out, indent=2, default=str))
