from __future__ import annotations

import re

from skar_adapter import run_agent_under_test


# Skar normalizes a few volatile substrings before comparing tool arguments
# and output text, so a re-run of the agent does not fail this test for
# unrelated reasons (a different temp directory, a fresh UUID, a new
# timestamp). Edit this list to add or remove patterns for your project.
_VOLATILE_PATTERNS = [
    # 36-character UUIDs (session ids, request ids, run ids).
    (re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"), "<UUID>"),
    # macOS per-user temp directory.
    (re.compile(r"/(?:private/)?var/folders/[^/]+/[^/]+/T(?=/|$)"), "<TEMP>"),
    # Linux temp directories.
    (re.compile(r"/var/tmp(?=/|$)"), "<TEMP>"),
    (re.compile(r"/tmp(?=/|$)"), "<TEMP>"),
    # Windows temp directories (backslash and forward-slash forms).
    (re.compile(r"[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:\\Windows\\Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:/Users/[^/]+/AppData/Local/Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:/Windows/Temp", re.IGNORECASE), "<TEMP>"),
    # User home directories — Windows variants first so forward-slash
    # "C:/Users/..." is not partially eaten by the macOS "/Users/..." rule.
    (re.compile(r"[A-Za-z]:/Users/[^/\s\"']+"), "<HOME>"),
    (re.compile(r"[A-Za-z]:\\Users\\[^\\]+"), "<HOME>"),
    (re.compile(r"/Users/[^/\s\"']+"), "<HOME>"),
    (re.compile(r"/home/[^/\s\"']+"), "<HOME>"),
    # ISO-8601 timestamps and bare dates.
    (re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?"), "<TIMESTAMP>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}(?!T\d)"), "<DATE>"),
]


def _normalize(value):
    if isinstance(value, str):
        out = value
        for pattern, replacement in _VOLATILE_PATTERNS:
            out = pattern.sub(replacement, out)
        return out
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize(child) for key, child in value.items()}
    return value


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

    observed_args = [_normalize(call["arguments"]) for call in result["tool_calls"]]
    expected_args = [_normalize(call["arguments"]) for call in TRACE["toolCalls"]]
    assert observed_args == expected_args

    assert result["status"] == "success"
    assert _normalize("Refund created") in _normalize(result.get("output_text", ""))
