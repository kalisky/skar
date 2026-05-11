"""Tools the agent can call.

In production, these would hit real systems (a billing DB, a refund processor).
In tests, the executor is replaced with one that returns captured results.
"""

from __future__ import annotations

from typing import Any


# Anthropic tool definitions (passed to the Messages API).
TOOLS_SCHEMA: list[dict[str, Any]] = [
    {
        "name": "lookup_order",
        "description": "Look up an order by id. Returns the order details including eligibility for refund.",
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "The order id, e.g. 'A-1234'"},
            },
            "required": ["order_id"],
        },
    },
    {
        "name": "process_refund",
        "description": "Process a refund for an order. Only call this AFTER you have confirmed the order is refund-eligible via lookup_order.",
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "reason": {
                    "type": "string",
                    "description": "Short human-readable reason for the refund.",
                },
            },
            "required": ["order_id", "reason"],
        },
    },
]


# Real implementations — used only when you run the agent against live Anthropic.
def lookup_order(order_id: str) -> dict[str, Any]:
    # In a real app: query the orders DB.
    if order_id == "A-1234":
        return {
            "order_id": "A-1234",
            "total_cents": 4999,
            "status": "delivered",
            "refund_eligible": True,
        }
    return {"order_id": order_id, "status": "not_found", "refund_eligible": False}


def process_refund(order_id: str, reason: str) -> dict[str, Any]:
    # In a real app: hit the refund processor.
    return {
        "order_id": order_id,
        "refund_id": "ref_8f4a2c",
        "amount_cents": 4999,
        "status": "issued",
        "reason": reason,
    }


REAL_EXECUTOR_MAP = {
    "lookup_order": lookup_order,
    "process_refund": process_refund,
}


def real_tool_executor(name: str, args: dict[str, Any]) -> Any:
    fn = REAL_EXECUTOR_MAP.get(name)
    if fn is None:
        raise ValueError(f"Unknown tool: {name}")
    return fn(**args)
