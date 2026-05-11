"""LangChain tools — same refund domain as the Anthropic-SDK example."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool


@tool
def lookup_order(order_id: str) -> dict[str, Any]:
    """Look up an order by id. Returns refund eligibility and details."""
    if order_id == "A-1234":
        return {
            "order_id": "A-1234",
            "total_cents": 4999,
            "status": "delivered",
            "refund_eligible": True,
        }
    return {"order_id": order_id, "status": "not_found", "refund_eligible": False}


@tool
def process_refund(order_id: str, reason: str) -> dict[str, Any]:
    """Process a refund for an order. Only call AFTER confirming via lookup_order."""
    return {
        "order_id": order_id,
        "refund_id": "ref_8f4a2c",
        "amount_cents": 4999,
        "status": "issued",
        "reason": reason,
    }


TOOLS = [lookup_order, process_refund]
