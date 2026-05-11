"""Recorder — capture tool calls during an agent run and emit a Skar trace.

The recorder works two ways:

1. **Wrap a tool executor.** If your agent dispatches tools through a single
   callable (a function `(name, args) -> result`), wrap that callable with
   `recorder.wrap()` and the recorder will see every call transparently.

2. **Call `note_call` directly.** For agents that don't have a single
   executor — callback-based frameworks like LangChain, or anything that
   dispatches inline — call `recorder.note_call(name, args, result)` from
   wherever the tool finishes. Order matters; calls are appended in the
   order they're recorded.

Both produce the same Skar trace shape (schema_version 0.1).

The recorder is also a **context manager**. Using `with` lets it observe
whether the wrapped block raised an exception, which the recorder uses to
infer a `final.status` when one isn't passed explicitly:

    with Recorder() as recorder:
        result = my_agent.run(prompt=p, tool_executor=recorder.wrap(my_tools))
    recorder.write("trace.json", prompt=p, output_text=result.get("output_text"))
    # status defaults to recorder.inferred_status()

"success" here means "the wrapped block ran to completion without raising,
and at least one tool call was captured." It does NOT mean "the agent's
decision was correct" — Skar has no way to know that. Override with an
explicit `status=` argument when you have a stronger signal.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Optional


SCHEMA_VERSION = "0.1"


class SchemaError(ValueError):
    """Raised when the recorder is asked to produce an invalid trace."""


class Recorder:
    """Captures tool calls during an agent run and writes a Skar trace JSON.

    All state is held in memory until `to_dict()` or `write()` is called.
    Thread-safe? No — instantiate one Recorder per agent run.
    """

    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []
        self._used_as_context: bool = False
        self._caught_exception: Optional[BaseException] = None

    # ------------------------------------------------------------------ capture

    def wrap(
        self,
        tool_executor: Callable[[str, dict[str, Any]], Any],
    ) -> Callable[[str, dict[str, Any]], Any]:
        """Return a recording wrapper around `tool_executor`.

        Use this when your agent dispatches all tool calls through one
        callable. Every call flows through the wrapper, which captures the
        name, arguments, and result before returning the original value
        to the agent.
        """

        def recording_executor(name: str, args: dict[str, Any]) -> Any:
            result = tool_executor(name, args)
            self.note_call(name, args, result)
            return result

        return recording_executor

    def note_call(
        self,
        tool_name: str,
        arguments: Any,
        result: Any,
    ) -> None:
        """Record one tool call directly. Useful when there's no single
        executor to wrap (callback-based frameworks, inline dispatch)."""
        self._events.append(
            {
                "type": "tool_call",
                "tool_name": tool_name,
                "arguments": _jsonable(arguments),
                "result": _jsonable(result),
            }
        )

    # ------------------------------------------------------ context manager API

    def __enter__(self) -> "Recorder":
        self._used_as_context = True
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if exc_val is not None:
            self._caught_exception = exc_val
        return False  # never suppress — let the exception propagate

    def inferred_status(self) -> str:
        """Best-guess final.status when the caller doesn't supply one.

        - "failure" if an exception propagated out of a `with` block.
        - "success" if at least one tool call was captured and no exception.
        - "no_tools_called" otherwise.

        "success" means "the wrapped block ran to completion without raising,"
        NOT "the agent's decision was semantically correct." Override with
        an explicit `status=` when you have a stronger signal.
        """
        if self._caught_exception is not None:
            return "failure"
        if self._events:
            return "success"
        return "no_tools_called"

    # ------------------------------------------------------------------ inspect

    @property
    def events(self) -> list[dict[str, Any]]:
        """Read-only view of captured events. Useful for assertions in tests."""
        return list(self._events)

    def __len__(self) -> int:
        return len(self._events)

    # -------------------------------------------------------------- materialize

    def to_dict(
        self,
        *,
        prompt: str,
        status: Optional[str] = None,
        output_text: Optional[str] = None,
    ) -> dict[str, Any]:
        """Materialize the captured run as a Skar trace dict.

        If `status` is None (the default), uses `inferred_status()`. Pass
        an explicit string to override.
        """
        if not prompt:
            raise SchemaError("prompt is required (non-empty string)")
        resolved_status = status if status is not None else self.inferred_status()
        trace: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "input": {"prompt": prompt},
            "events": list(self._events),
            "final": {"status": resolved_status},
        }
        if output_text:
            trace["final"]["output_text"] = output_text
        return trace

    def write(
        self,
        path: str | Path,
        *,
        prompt: str,
        status: Optional[str] = None,
        output_text: Optional[str] = None,
    ) -> Path:
        """Materialize the trace and write it to disk. Returns the path written."""
        out_path = Path(path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        trace = self.to_dict(prompt=prompt, status=status, output_text=output_text)
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(trace, f, indent=2, default=str)
            f.write("\n")
        return out_path


def _jsonable(value: Any) -> Any:
    """Round-trip through JSON to strip non-JSON-friendly types out of args/results."""
    return json.loads(json.dumps(value, default=str))


__all__ = ["Recorder", "SchemaError", "SCHEMA_VERSION"]
