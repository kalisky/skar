# skar (Python)

The Python-side runtime for [Skar](https://github.com/kalisky/skar).
This package provides `Recorder`, a small helper for instrumenting your
tool-using agent code to produce Skar trace JSON files. Feed those
traces into the `skar` CLI / MCP tool to generate pytest regression
tests that lock in your agent's decision-making behavior.

See the full [project README](https://github.com/kalisky/skar) for
context on what Skar does, who it's for, and how the test artifacts
get wired up. This package is just one piece — the runtime capture
half. The CLI / MCP server half lives in the `@kalisky/skar` npm
package.

## Install

```bash
pip install skar
```

Python 3.10+. No runtime dependencies — just the stdlib.

## Usage — wrap a tool executor

If your agent dispatches all tool calls through a single callable
(`tool_executor(name, args) -> result`), wrap it with the recorder and
use the recorder as a `with` context manager so it can observe whether
the run raised:

```python
from skar import Recorder

recorder = Recorder()

with recorder:
    result = my_agent.run(
        prompt=prompt,
        tool_executor=recorder.wrap(my_real_tool_executor),
    )

recorder.write(
    "traces/my_run.json",
    prompt=prompt,
    output_text=result.get("output_text"),
)
```

The wrapper transparently calls your real executor, captures
`(name, args, result)`, and returns the executor's value unchanged. No
changes to agent code required.

`status` is automatically inferred from what the recorder observed:

- `"failure"` if an exception propagated out of the `with` block.
- `"success"` if at least one tool call was captured and no exception.
- `"no_tools_called"` otherwise.

"success" means *"the agent code ran to completion without raising,"*
**not** *"the agent's decision was semantically correct."* Skar has no
way to know the latter. Override with an explicit `status="..."` when
you have a stronger signal (a downstream check, user feedback, etc.).

## Usage — `note_call` for callback-style frameworks

For frameworks where there's no single tool executor to wrap (LangChain
callbacks, inline dispatch, multi-process), record each call directly
when it finishes:

```python
from skar import Recorder

recorder = Recorder()

def on_tool_end(name: str, input_args: dict, result):
    recorder.note_call(name, input_args, result)

# Hook on_tool_end into your framework's callback / event system.
# When the run completes:
recorder.write("traces/my_run.json", prompt=prompt, status="success")
```

Both flows produce the same Skar trace JSON shape (schema_version 0.1).

## What gets written

A schema-conformant Skar trace file looks like:

```json
{
  "schema_version": "0.1",
  "input": { "prompt": "Refund order A-1234" },
  "events": [
    {
      "type": "tool_call",
      "tool_name": "lookup_order",
      "arguments": { "order_id": "A-1234" },
      "result": { "order_id": "A-1234", "refund_eligible": true }
    },
    {
      "type": "tool_call",
      "tool_name": "process_refund",
      "arguments": { "order_id": "A-1234", "reason": "..." },
      "result": { "refund_id": "ref_x", "status": "issued" }
    }
  ],
  "final": {
    "status": "success",
    "output_text": "Refund of $49.99 issued."
  }
}
```

Feed that to:

```bash
npx -y -p @kalisky/skar skar generate \
  --from-trace traces/my_run.json \
  --out tests/test_refund_regression.py \
  --report tests/test_refund.report.html
```

…to get a committable pytest file plus an HTML summary for code review.

## Status field

`status` defaults to `"unknown"` because real agent runs don't carry an
explicit success/failure signal. Set it explicitly when you know — your
agent's own success criteria, a user thumbs-up, a passing downstream
test, whatever. Generated regression tests will assert on whatever you
record.

## API surface

- `Recorder()` — construct one per agent run.
- `with recorder:` — context manager; lets the recorder observe exceptions.
- `recorder.wrap(executor)` — return a recording wrapper.
- `recorder.note_call(name, arguments, result)` — record one call directly.
- `recorder.events` — read-only list of captured event dicts (for assertions).
- `recorder.inferred_status()` — `"failure"` / `"success"` / `"no_tools_called"`.
- `recorder.to_dict(prompt=, status=None, output_text=None)` — materialize as trace dict. `status=None` uses `inferred_status()`.
- `recorder.write(path, prompt=, status=None, output_text=None)` — write to disk, return Path. Same status default.
- `len(recorder)` — number of events captured so far.

## License

MIT.
