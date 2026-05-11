"""Skar capture for LangChain agents — a small callback handler.

LangChain dispatches tools internally inside the LangGraph agent loop;
there's no single tool_executor for `skar.Recorder.wrap()` to wrap.
Instead, we attach a callback handler that fires `on_tool_start` and
`on_tool_end`, and use `recorder.note_call()` to record the pair.

Pass the resulting handler in your `config={"callbacks": [...]}` when
invoking the agent. Every tool the LangChain agent executes flows
through your `recorder`, regardless of whether the model is real or
scripted.

This pattern is what `skar.Recorder.note_call()` was designed for.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

from skar import Recorder


class SkarCaptureCallback(BaseCallbackHandler):
    def __init__(self, recorder: Recorder) -> None:
        super().__init__()
        self.recorder = recorder
        # tool run_id -> (name, args) captured at on_tool_start
        self._pending: dict[UUID, tuple[str, Any]] = {}

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        name = serialized.get("name") or "unknown_tool"
        args = inputs if isinstance(inputs, dict) else _parse_input(input_str)
        self._pending[run_id] = (name, args)

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        entry = self._pending.pop(run_id, None)
        if entry is None:
            return
        name, args = entry
        # LangChain wraps the result in a ToolMessage by the time on_tool_end
        # fires; unwrap and try to parse the content back to JSON so the
        # captured trace carries structured data rather than a stringified blob.
        content = getattr(output, "content", output)
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (TypeError, ValueError):
                pass  # leave as string if it isn't JSON
        self.recorder.note_call(name, args, content)


def _parse_input(input_str: str) -> Any:
    try:
        return json.loads(input_str)
    except (TypeError, ValueError):
        return {"input": input_str}
