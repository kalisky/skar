"""Skar adapter — invokes the real agent loop under hermetic mocks.

This is the integration point the generated test imports. Skar passes us the
captured prompt and the captured tool calls; we build:

  - a scripted Claude that returns one tool_use block per turn (matching the
    captured sequence) and finally returns the captured output_text,
  - a scripted tool executor that returns the captured result for each call,

then we hand both to the real `agent.run_agent` and return what it produces.

The test that imports this adapter therefore exercises the real agent's
parsing, loop control, message construction, and final-text extraction.
Only the LLM call and the tool implementations are stubbed — which is exactly
what we want: regressions in *agent code* are caught, regressions in tool
implementations or the LLM itself are out of scope.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Make the example modules importable when pytest runs from the example root.
_EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_EXAMPLE_ROOT))

from agent import run_agent  # noqa: E402


class _ScriptedBlock:
    """Mimics a single content block from Anthropic's response."""

    __slots__ = ("type", "text", "id", "name", "input")

    def __init__(self, **kwargs: Any) -> None:
        self.type = kwargs.get("type", "")
        self.text = kwargs.get("text", "")
        self.id = kwargs.get("id", "")
        self.name = kwargs.get("name", "")
        self.input = kwargs.get("input", {})


class _ScriptedResponse:
    """Mimics an Anthropic Messages API response object."""

    __slots__ = ("content", "stop_reason")

    def __init__(self, content: list[_ScriptedBlock], stop_reason: str) -> None:
        self.content = content
        self.stop_reason = stop_reason


def _build_scripted_claude(mocked_tool_calls: list[dict[str, Any]], final_text: str):
    """Return a Claude stub that yields one tool_use per turn, then final text."""

    turn_index = {"i": 0}

    def claude_call(messages: list[dict[str, Any]]) -> _ScriptedResponse:  # noqa: ARG001
        i = turn_index["i"]
        if i < len(mocked_tool_calls):
            call = mocked_tool_calls[i]
            block = _ScriptedBlock(
                type="tool_use",
                id=f"toolu_scripted_{i}",
                name=call["toolName"],
                input=call["arguments"],
            )
            turn_index["i"] += 1
            return _ScriptedResponse([block], stop_reason="tool_use")
        # All tool calls consumed → final assistant text.
        return _ScriptedResponse(
            [_ScriptedBlock(type="text", text=final_text or "Done.")],
            stop_reason="end_turn",
        )

    return claude_call


def _build_scripted_tool_executor(mocked_tool_calls: list[dict[str, Any]]):
    """Return a tool executor that hands back captured results in order."""

    call_iter = {"i": 0}

    def tool_executor(name: str, args: dict[str, Any]) -> Any:  # noqa: ARG001
        i = call_iter["i"]
        if i >= len(mocked_tool_calls):
            raise AssertionError(
                f"Agent called more tools than the trace captured (next was {name!r})."
            )
        result = mocked_tool_calls[i].get("result")
        call_iter["i"] += 1
        return result

    return tool_executor


def run_agent_under_test(*, prompt: str, mocked_tool_calls: list[dict[str, Any]]):
    # The captured trace doesn't include the final assistant text in
    # mocked_tool_calls, but Skar passes the whole TRACE dict elsewhere.
    # For this example we accept it from the test harness via a module-level
    # hook — but the simplest stable design is: read the trace ourselves.
    import json

    final_text = ""
    trace_path = _EXAMPLE_ROOT / "traces" / "refund_eligible.json"
    if trace_path.exists():
        with trace_path.open() as f:
            trace = json.load(f)
        final_text = trace.get("final", {}).get("output_text", "")

    claude_call = _build_scripted_claude(mocked_tool_calls, final_text)
    tool_executor = _build_scripted_tool_executor(mocked_tool_calls)

    return run_agent(
        prompt=prompt,
        claude_call=claude_call,
        tool_executor=tool_executor,
    )
