from __future__ import annotations

import re

from skar_adapter import run_agent_under_test


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


# Field paths to drop from a tool's arguments BEFORE _normalize runs.
# Syntax: "tool_name.field" or "*.field" for any tool; nested OK ("tool.env.PATH").
# Edit this list to add or remove per-tool ignore rules.
_IGNORE_FIELDS = []


def _strip_ignored(tool_name, args):
    if not isinstance(args, dict):
        return args
    result = {key: _deep_copy_jsonable(value) for key, value in args.items()}
    for path in _IGNORE_FIELDS:
        head, *rest = path.split(".")
        if head not in (tool_name, "*"):
            continue
        _pop_path(result, rest)
    return result


def _pop_path(obj, parts):
    if not parts:
        return
    head, *rest = parts
    if not rest:
        if isinstance(obj, dict):
            obj.pop(head, None)
        return
    nested = obj.get(head) if isinstance(obj, dict) else None
    if isinstance(nested, dict):
        _pop_path(nested, rest)


def _deep_copy_jsonable(value):
    if isinstance(value, dict):
        return {k: _deep_copy_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_deep_copy_jsonable(v) for v in value]
    return value


def _prepare_args(tool_name, args):
    return _normalize(_strip_ignored(tool_name, args))


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

    observed_args = [_prepare_args(call["tool_name"], call["arguments"]) for call in result["tool_calls"]]
    expected_args = [_prepare_args(call["toolName"], call["arguments"]) for call in TRACE["toolCalls"]]
    assert observed_args == expected_args
    assert result["status"] == "success"
    assert _normalize("Refund created") in _normalize(result.get("output_text", ""))
