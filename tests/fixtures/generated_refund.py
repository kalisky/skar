from __future__ import annotations

from skar_adapter import run_agent_under_test


TRACE = {
    "schemaVersion": "0.1",
    "prompt": "Refund order 123 if eligible",
    "toolCalls": [
        {
            "toolName": "refund_lookup",
            "arguments": {
                "order_id": "123"
            },
            "result": {
                "eligible": True,
                "order_id": "123"
            }
        },
        {
            "toolName": "refund_create",
            "arguments": {
                "order_id": "123"
            },
            "result": {
                "refund_id": "r_123",
                "status": "success"
            }
        }
    ],
    "final": {
        "status": "success",
        "output_text": "Refund created"
    }
}


def test_refund_order_123_if_eligible():
    result = run_agent_under_test(
        prompt=TRACE["prompt"],
        mocked_tool_calls=TRACE["toolCalls"],
    )

    assert [call["tool_name"] for call in result["tool_calls"]] == [
        "refund_lookup",
        "refund_create"
    ]
    assert [call["arguments"] for call in result["tool_calls"]] == [
        {
            "order_id": "123"
        },
        {
            "order_id": "123"
        }
    ]
    assert result["status"] == "success"
    assert "Refund created" in result.get("output_text", "")
