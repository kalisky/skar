# Adapter Contract

Generated tests from Skar do not execute an agent runtime directly.
Instead, they call a user-provided Python module:

- module: `skar_adapter.py`
- function: `run_agent_under_test`

## Function Shape

```python
def run_agent_under_test(*, prompt, mocked_tool_calls):
    ...
```

Arguments:

- `prompt`: the recorded user prompt from the trace
- `mocked_tool_calls`: the normalized tool-call sequence Skar extracted
  from the trace

Return value:

```python
{
    "tool_calls": [
        {"tool_name": "refund_lookup", "arguments": {"order_id": "123"}},
        {"tool_name": "refund_create", "arguments": {"order_id": "123"}},
    ],
    "status": "success",
    "output_text": "Refund created",
}
```

Required keys:

- `tool_calls`
- `status`

Optional key:

- `output_text`

## Why This Exists

Skar's v0 value is conversion, not runtime ownership.

That means the generated test needs a very small contract that users can
adapt to their own stack without Skar shipping framework-specific
adapters immediately.

## Rules

- `tool_calls` should be the tool calls your agent actually made during
  the replayed run
- each tool call should include:
  - `tool_name`
  - `arguments`
- `status` should be a stable outcome label such as `success` or
  `error`
- `output_text` should only be included if your agent naturally produces
  one

## Non-Goals

This contract does not currently standardize:

- latency
- token counts
- intermediate model messages
- raw tool results
- retries / nested spans / subagents

Those can be added later if the core capture-and-convert workflow proves
useful.
