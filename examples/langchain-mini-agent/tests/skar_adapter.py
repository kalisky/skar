"""Skar adapter for the LangChain example.

Builds the real LangChain agent (same `create_agent` graph used in
production) around a scripted fake LLM. The LangChain agent's loop,
state machine, and tool dispatch run end-to-end; only the LLM and the
tool results are stubbed from the captured trace. Regressions in agent
configuration (system prompt, tool selection, graph wiring) will surface
as test failures here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, List

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult

_EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_EXAMPLE_ROOT))

from agent import build_agent  # noqa: E402
from skar import Recorder  # noqa: E402
from skar_lc_capture import SkarCaptureCallback  # noqa: E402


class ScriptedChatModel(BaseChatModel):
    """Tiny fake LLM that returns a pre-built list of AIMessages in order."""

    responses: List[AIMessage]
    index: int = 0

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        msg = self.responses[self.index]
        object.__setattr__(self, "index", self.index + 1)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def bind_tools(self, tools, **kwargs):
        return self  # the script already knows what to call


def _build_scripted_responses(mocked_tool_calls: list[dict[str, Any]], final_text: str) -> list[AIMessage]:
    """For each captured tool call, emit one AIMessage requesting it; then
    emit a final text AIMessage to close the conversation."""
    responses: list[AIMessage] = []
    for i, call in enumerate(mocked_tool_calls):
        responses.append(
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": f"scripted_call_{i}",
                        "name": call["toolName"],
                        "args": call["arguments"],
                    }
                ],
            )
        )
    responses.append(AIMessage(content=final_text or "Done."))
    return responses


def _read_final_output_text() -> str:
    trace_path = _EXAMPLE_ROOT / "traces" / "refund_eligible.json"
    if not trace_path.exists():
        return ""
    with trace_path.open() as f:
        return json.load(f).get("final", {}).get("output_text", "")


def run_agent_under_test(*, prompt: str, mocked_tool_calls: list[dict[str, Any]]):
    final_text = _read_final_output_text()
    fake_llm = ScriptedChatModel(responses=_build_scripted_responses(mocked_tool_calls, final_text))
    agent = build_agent(fake_llm)

    recorder = Recorder()
    result = agent.invoke(
        {"messages": [HumanMessage(content=prompt)]},
        config={"callbacks": [SkarCaptureCallback(recorder)]},
    )

    # Reconstruct the adapter contract from what actually happened.
    observed_tool_calls = [
        {"tool_name": ev["tool_name"], "arguments": ev["arguments"]}
        for ev in recorder.events
    ]
    observed_final_text = ""
    for m in reversed(result.get("messages", [])):
        if isinstance(m, AIMessage) and isinstance(m.content, str) and m.content:
            observed_final_text = m.content
            break

    return {
        "tool_calls": observed_tool_calls,
        "status": "success",
        "output_text": observed_final_text,
    }
