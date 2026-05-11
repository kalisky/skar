"""Tests for SkarRecorder.

Confirms that wrapping a tool executor with the recorder produces a
schema-conformant Skar trace dict, capturing both arguments and results
verbatim and preserving order.
"""

from __future__ import annotations

import sys
from pathlib import Path

_EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_EXAMPLE_ROOT))

from skar_capture import SkarRecorder  # noqa: E402


def fake_tool_executor(name: str, args: dict) -> dict:
    if name == "lookup_order":
        return {"order_id": args["order_id"], "refund_eligible": True}
    if name == "process_refund":
        return {"refund_id": "ref_x", "order_id": args["order_id"]}
    raise ValueError(name)


def test_recorder_captures_tool_calls_in_order():
    recorder = SkarRecorder()
    wrapped = recorder.wrap(fake_tool_executor)

    wrapped("lookup_order", {"order_id": "A-1"})
    wrapped("process_refund", {"order_id": "A-1", "reason": "test"})

    trace = recorder.to_dict(prompt="refund A-1", status="success", output_text="done")

    assert trace["schema_version"] == "0.1"
    assert trace["input"]["prompt"] == "refund A-1"
    assert [e["tool_name"] for e in trace["events"]] == ["lookup_order", "process_refund"]
    assert trace["events"][0]["arguments"] == {"order_id": "A-1"}
    assert trace["events"][0]["result"] == {"order_id": "A-1", "refund_eligible": True}
    assert trace["events"][1]["arguments"] == {"order_id": "A-1", "reason": "test"}
    assert trace["events"][1]["result"]["refund_id"] == "ref_x"
    assert trace["final"]["status"] == "success"
    assert trace["final"]["output_text"] == "done"


def test_recorder_omits_output_text_when_absent():
    recorder = SkarRecorder()
    trace = recorder.to_dict(prompt="p", status="unknown")
    assert "output_text" not in trace["final"]


def test_recorder_writes_valid_json_file(tmp_path):
    recorder = SkarRecorder()
    wrapped = recorder.wrap(fake_tool_executor)
    wrapped("lookup_order", {"order_id": "A-2"})

    out = tmp_path / "captured.json"
    written = recorder.write(out, prompt="refund A-2", status="success")

    assert written.exists()
    import json
    with written.open() as f:
        loaded = json.load(f)
    assert loaded["events"][0]["tool_name"] == "lookup_order"
    assert loaded["events"][0]["arguments"] == {"order_id": "A-2"}
