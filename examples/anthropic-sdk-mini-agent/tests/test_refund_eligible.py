from __future__ import annotations

import re

from skar_adapter import run_agent_under_test


# --- Note from author ---
# Captures the happy-path refund flow: lookup_order confirms eligibility, then process_refund issues the refund. This test catches regressions in the agent's parsing, loop control, and message construction — not LLM or tool implementation regressions.
# --- End note ---


# Skar normalizes a few volatile substrings before comparing tool arguments
# and output text, so a re-run of the agent does not fail this test for
# unrelated reasons (different temp dir, fresh UUID, new timestamp), and
# any secret that slips into a real run is collapsed to <REDACTED> before
# comparison instead of leaking into the test failure message.
# Edit this list to add or remove patterns for your project.
_VOLATILE_PATTERNS = [
    # --- Common secret shapes (kept first so they win on overlap). ---
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "<REDACTED>"),
    (re.compile(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "<REDACTED>"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{20,}"), "<REDACTED>"),
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "<REDACTED>"),
    (re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{32,}"), "<REDACTED>"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "<REDACTED>"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "<REDACTED>"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "<REDACTED>"),
    # --- Drift normalization. ---
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
    "prompt": "Please refund order A-1234. The customer reported it never arrived.",
    "toolCalls": [
        {
            "toolName": "lookup_order",
            "arguments": {
                "order_id": "A-1234"
            },
            "result": {
                "internal_note": "agent token <REDACTED> was used for this lookup",
                "order_id": "A-1234",
                "refund_eligible": True,
                "status": "delivered",
                "total_cents": 4999
            }
        },
        {
            "toolName": "process_refund",
            "arguments": {
                "order_id": "A-1234",
                "reason": "Customer reported order never arrived"
            },
            "result": {
                "amount_cents": 4999,
                "order_id": "A-1234",
                "reason": "Customer reported order never arrived",
                "refund_id": "ref_8f4a2c",
                "status": "issued"
            }
        }
    ],
    "final": {
        "status": "success",
        "output_text": "I've issued a refund of $49.99 for order A-1234. The customer should see the refund within 3-5 business days."
    }
}


def test_refund_eligible_order():
    result = run_agent_under_test(
        prompt=TRACE["prompt"],
        mocked_tool_calls=TRACE["toolCalls"],
    )

    assert [call["tool_name"] for call in result["tool_calls"]] == [
        "lookup_order",
        "process_refund"
    ]

    observed_args = [_normalize(call["arguments"]) for call in result["tool_calls"]]
    expected_args = [_normalize(call["arguments"]) for call in TRACE["toolCalls"]]
    assert observed_args == expected_args

    assert result["status"] == "success"
    assert _normalize("I've issued a refund of $49.99 for order A-1234. The customer should see the refund within 3-5 business days.") in _normalize(result.get("output_text", ""))
