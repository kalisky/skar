"""LangChain agent builder.

A single `build_agent(model)` factory that wires the same tools and
system prompt regardless of what model is passed in. Production code
passes `ChatAnthropic(...)`. Test code passes a scripted fake model
(see tests/skar_adapter.py).
"""

from __future__ import annotations

from typing import Any

from langchain.agents import create_agent

from tools import TOOLS


SYSTEM_PROMPT = (
    "You are a refund-handling support agent. "
    "Always look up the order first to confirm refund eligibility. "
    "Only process a refund if the order is refund_eligible. "
    "Reply with a one-sentence confirmation when done."
)


def build_agent(model: Any):
    """Build the agent graph around `model`. Returns a compiled agent
    you can `.invoke({"messages": [HumanMessage(...)]})` on."""
    return create_agent(model=model, tools=TOOLS, system_prompt=SYSTEM_PROMPT)
