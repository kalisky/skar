"""Tests for skar.Recorder."""

from __future__ import annotations

import json

import pytest

from skar import Recorder, SchemaError


# --- helpers ----------------------------------------------------------------


def fake_executor(name: str, args: dict) -> dict:
    if name == "lookup_order":
        return {"order_id": args["order_id"], "refund_eligible": True}
    if name == "process_refund":
        return {"refund_id": "ref_x", "order_id": args["order_id"]}
    raise ValueError(name)


# --- wrap() flow ------------------------------------------------------------


def test_wrap_captures_calls_in_order_with_arguments_and_results():
    r = Recorder()
    wrapped = r.wrap(fake_executor)

    wrapped("lookup_order", {"order_id": "A-1"})
    wrapped("process_refund", {"order_id": "A-1", "reason": "test"})

    trace = r.to_dict(prompt="p", status="success")

    assert trace["schema_version"] == "0.1"
    assert [e["tool_name"] for e in trace["events"]] == ["lookup_order", "process_refund"]
    assert trace["events"][0]["arguments"] == {"order_id": "A-1"}
    assert trace["events"][0]["result"]["refund_eligible"] is True
    assert trace["events"][1]["result"]["refund_id"] == "ref_x"


def test_wrap_returns_executor_result_unchanged():
    r = Recorder()
    wrapped = r.wrap(fake_executor)
    result = wrapped("lookup_order", {"order_id": "A-9"})
    assert result == {"order_id": "A-9", "refund_eligible": True}


def test_wrap_propagates_executor_exceptions_without_recording():
    r = Recorder()
    wrapped = r.wrap(fake_executor)
    with pytest.raises(ValueError):
        wrapped("does_not_exist", {})
    assert len(r) == 0


# --- note_call() flow (for callback-based frameworks) ----------------------


def test_note_call_records_directly():
    r = Recorder()
    r.note_call("lookup_order", {"order_id": "B-1"}, {"refund_eligible": False})
    r.note_call("notify_team", {"reason": "ineligible"}, {"sent": True})

    trace = r.to_dict(prompt="p")
    assert [e["tool_name"] for e in trace["events"]] == ["lookup_order", "notify_team"]
    assert trace["events"][0]["result"] == {"refund_eligible": False}


# --- output shape -----------------------------------------------------------


def test_to_dict_omits_output_text_when_absent():
    trace = Recorder().to_dict(prompt="p", status="unknown")
    assert "output_text" not in trace["final"]


def test_to_dict_includes_output_text_when_provided():
    trace = Recorder().to_dict(prompt="p", status="success", output_text="done")
    assert trace["final"]["output_text"] == "done"


def test_to_dict_default_status_with_no_events_is_no_tools_called():
    trace = Recorder().to_dict(prompt="p")
    assert trace["final"]["status"] == "no_tools_called"


def test_to_dict_default_status_with_events_is_success():
    r = Recorder()
    r.note_call("lookup_order", {"order_id": "A-1"}, {"ok": True})
    trace = r.to_dict(prompt="p")
    assert trace["final"]["status"] == "success"


def test_to_dict_explicit_status_overrides_inference():
    r = Recorder()
    r.note_call("x", {}, {})
    trace = r.to_dict(prompt="p", status="custom-status")
    assert trace["final"]["status"] == "custom-status"


def test_to_dict_requires_prompt():
    with pytest.raises(SchemaError):
        Recorder().to_dict(prompt="")


# --- write() roundtrip ------------------------------------------------------


def test_write_creates_parent_directories(tmp_path):
    r = Recorder()
    r.note_call("lookup_order", {"order_id": "A-2"}, {"ok": True})
    out = tmp_path / "nested" / "dirs" / "trace.json"
    written = r.write(out, prompt="p", status="success")
    assert written.exists()
    with written.open() as f:
        loaded = json.load(f)
    assert loaded["events"][0]["tool_name"] == "lookup_order"


def test_write_returns_pathlib_path(tmp_path):
    out = tmp_path / "trace.json"
    written = Recorder().write(out, prompt="p")
    from pathlib import Path
    assert isinstance(written, Path)


# --- introspection ----------------------------------------------------------


def test_events_property_returns_copy(tmp_path):
    r = Recorder()
    r.note_call("lookup_order", {"x": 1}, {"y": 2})
    snapshot = r.events
    r.note_call("another", {}, {})
    # Snapshot must not have grown
    assert len(snapshot) == 1
    assert len(r.events) == 2


def test_len_counts_events():
    r = Recorder()
    assert len(r) == 0
    r.note_call("x", {}, {})
    r.note_call("y", {}, {})
    assert len(r) == 2


# --- context manager + status inference -------------------------------------


def test_inferred_status_no_events():
    assert Recorder().inferred_status() == "no_tools_called"


def test_inferred_status_with_events_is_success():
    r = Recorder()
    r.note_call("x", {}, {})
    assert r.inferred_status() == "success"


def test_inferred_status_after_exception_is_failure():
    r = Recorder()
    try:
        with r:
            r.note_call("x", {}, {})
            raise RuntimeError("agent crashed")
    except RuntimeError:
        pass
    assert r.inferred_status() == "failure"


def test_context_manager_does_not_suppress_exceptions():
    r = Recorder()
    with pytest.raises(RuntimeError, match="agent crashed"):
        with r:
            raise RuntimeError("agent crashed")


def test_context_manager_clean_exit_yields_success_when_events_present():
    r = Recorder()
    with r:
        r.note_call("x", {}, {})
    assert r.inferred_status() == "success"


def test_context_manager_clean_exit_yields_no_tools_called_when_no_events():
    r = Recorder()
    with r:
        pass
    assert r.inferred_status() == "no_tools_called"


def test_write_default_status_uses_inference(tmp_path):
    r = Recorder()
    r.note_call("x", {}, {})
    out = tmp_path / "t.json"
    r.write(out, prompt="p")
    with out.open() as f:
        loaded = json.load(f)
    assert loaded["final"]["status"] == "success"
