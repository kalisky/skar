"""SkarRecorder — minimal in-agent trace capture.

Wrap your real tool executor in a SkarRecorder. Every tool call the agent
makes flows through the recorder, which captures the name, arguments,
and result alongside the original execution. At the end of the run, ask
the recorder for a Skar trace JSON.

This is a prototype of what a future `skar` Python SDK will expose. Today
it lives in the example so you can see the shape and copy it into your
own project if you want.

Usage:

    from skar_capture import SkarRecorder

    recorder = SkarRecorder()
    result = run_agent(
        prompt=prompt,
        claude_call=real_claude_call,
        tool_executor=recorder.wrap(real_tool_executor),
    )
    recorder.write(
        path="traces/my_run.json",
        prompt=prompt,
        status=result["status"],
        output_text=result.get("output_text"),
    )

The recorder makes no I/O during the run; it just collects in memory.
`write()` (or `to_dict()`) materializes the Skar trace JSON.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable


class SkarRecorder:
    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []

    def wrap(self, tool_executor: Callable[[str, dict[str, Any]], Any]) -> Callable[[str, dict[str, Any]], Any]:
        """Return a wrapped tool_executor that records every call + result."""

        def recording_executor(name: str, args: dict[str, Any]) -> Any:
            result = tool_executor(name, args)
            self._events.append(
                {
                    "type": "tool_call",
                    "tool_name": name,
                    "arguments": _jsonable(args),
                    "result": _jsonable(result),
                }
            )
            return result

        return recording_executor

    def to_dict(
        self,
        *,
        prompt: str,
        status: str = "unknown",
        output_text: str | None = None,
    ) -> dict[str, Any]:
        """Materialize the Skar trace as a dict."""
        trace: dict[str, Any] = {
            "schema_version": "0.1",
            "input": {"prompt": prompt},
            "events": list(self._events),
            "final": {"status": status},
        }
        if output_text:
            trace["final"]["output_text"] = output_text
        return trace

    def write(
        self,
        path: str | Path,
        *,
        prompt: str,
        status: str = "unknown",
        output_text: str | None = None,
    ) -> Path:
        """Materialize the Skar trace and write it to disk. Returns the path written."""
        out_path = Path(path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(
                self.to_dict(prompt=prompt, status=status, output_text=output_text),
                f,
                indent=2,
                default=str,
            )
            f.write("\n")
        return out_path


def _jsonable(value: Any) -> Any:
    """Cheap deepcopy via JSON to strip non-JSON-friendly types out of args/results."""
    return json.loads(json.dumps(value, default=str))
