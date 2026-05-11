"""The agent — a thin loop around the Anthropic Messages API.

The two collaborators (claude_call and tool_executor) are injected, so:

- In production, claude_call hits the real Anthropic API and tool_executor
  hits real backends.
- In tests, both are scripted from a captured Skar trace. The agent's loop,
  parsing, and message construction are exercised exactly as in production —
  only the LLM call and the tool implementations are stubbed.

That is the regression the test catches: agent-code regressions (parsing,
looping, message construction, tool dispatch), not LLM or tool regressions.
"""

from __future__ import annotations

from typing import Any, Callable, Protocol

from tools import TOOLS_SCHEMA


SYSTEM_PROMPT = (
    "You are a refund-handling support agent. "
    "Always look up the order first to confirm refund eligibility. "
    "Only process a refund if the order is refund_eligible. "
    "Reply with a one-sentence confirmation when done."
)

MODEL = "claude-3-5-sonnet-20241022"


class ClaudeCaller(Protocol):
    """Anything that, given a list of messages, returns a response shaped like
    Anthropic's Messages API response (content blocks, stop_reason)."""

    def __call__(self, messages: list[dict[str, Any]]) -> Any: ...


def run_agent(
    *,
    prompt: str,
    claude_call: ClaudeCaller,
    tool_executor: Callable[[str, dict[str, Any]], Any],
    max_turns: int = 8,
) -> dict[str, Any]:
    """Run the agent loop. Returns a dict shaped like Skar's adapter contract."""

    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    tool_calls: list[dict[str, Any]] = []
    final_text: str = ""

    for _ in range(max_turns):
        response = claude_call(messages)
        assistant_blocks: list[dict[str, Any]] = []
        tool_use_blocks: list[Any] = []

        for block in response.content:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                final_text = block.text
                assistant_blocks.append({"type": "text", "text": block.text})
            elif block_type == "tool_use":
                assistant_blocks.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )
                tool_use_blocks.append(block)

        messages.append({"role": "assistant", "content": assistant_blocks})

        if response.stop_reason != "tool_use":
            break

        tool_result_blocks: list[dict[str, Any]] = []
        for tu in tool_use_blocks:
            args = dict(tu.input) if isinstance(tu.input, dict) else {}
            result = tool_executor(tu.name, args)
            tool_calls.append({"tool_name": tu.name, "arguments": args, "result": result})
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": str(result) if not isinstance(result, str) else result,
                }
            )

        messages.append({"role": "user", "content": tool_result_blocks})

    return {
        "tool_calls": [
            {"tool_name": tc["tool_name"], "arguments": tc["arguments"]} for tc in tool_calls
        ],
        "status": "success" if tool_calls else "no_tools_called",
        "output_text": final_text,
    }


__all__ = ["run_agent", "SYSTEM_PROMPT", "MODEL", "TOOLS_SCHEMA"]
