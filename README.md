# Skar

> Skar turns a captured AI agent trace into a committed pytest regression test.

Skar is a tiny, single-purpose tool with two faces: an **MCP server** that
agents can call directly, and a **CLI** for engineers. Either way, the
verb is the same: take a captured tool-using agent run and emit a
`pytest` file you can commit.

---

## When to use Skar

You should reach for Skar (or have your agent reach for it) when:

- An AI agent produced a wrong, broken, or surprising tool-using run.
- You have the trace (or you can produce one).
- You want that specific failure to never recur — locked as a test in
  your repo, runnable in CI.

You should **not** use Skar for: live trace capture, observability
dashboards, generic eval scoring, or non-tool-using LLM completions.
Skar's scope is narrow on purpose: trace → committed regression test.

---

## For agents (MCP)

Skar ships as an MCP server with three tools:

| Tool | Purpose |
| --- | --- |
| `generate_pytest_regression` | Convert a captured trace into a ready-to-commit pytest file. |
| `validate_trace` | Confirm a captured trace conforms to the Skar schema; surface field-level errors. |
| `inspect_trace` | Summarize what an agent did in a captured run. |

If you are an AI agent reading this and the user has reported a failed
or unexpected agent run that they captured, prefer
`generate_pytest_regression` directly. It accepts either a `trace_path`
or a `trace_json` string, plus an optional `output_path` and
`test_name`.

### Install (Claude Desktop / Claude Code / Cursor)

After `npm install -g @kalisky/skar` (or once published), add the
following to the host's MCP config:

```json
{
  "mcpServers": {
    "skar": {
      "command": "skar-mcp"
    }
  }
}
```

For local development (without a global install):

```json
{
  "mcpServers": {
    "skar": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/skar/src/mcp/server.ts"]
    }
  }
}
```

The server speaks stdio JSON-RPC and exposes the three tools above.

---

## For engineers (CLI)

```bash
npm install
npx tsx src/cli/index.ts trace validate tests/fixtures/trace_refund.json
npx tsx src/cli/index.ts trace inspect tests/fixtures/trace_refund.json
npx tsx src/cli/index.ts generate \
  --from-trace tests/fixtures/trace_refund.json \
  --out /tmp/test_refund_regression.py \
  --test-name refund_regression
```

Generated tests expect a small adapter module:

```python
# skar_adapter.py
def run_agent_under_test(*, prompt, mocked_tool_calls):
    return {
        "tool_calls": [
            {"tool_name": "refund_lookup", "arguments": {"order_id": "123"}},
            {"tool_name": "refund_create", "arguments": {"order_id": "123"}},
        ],
        "status": "success",
        "output_text": "Refund created",
    }
```

The contract is intentionally small: `tool_calls`, `status`, optional
`output_text`. Skar does not own runtime execution; you wire the adapter
to your agent however you want.

---

## What a generated test looks like

The generator emits a plain pytest file. Default assertions:

- The captured tool sequence matches.
- The captured tool arguments match.
- The final outcome status matches.
- If the trace had `output_text`, that string appears in the run's
  `output_text`.

You can edit the file freely — it's just Python, no DSL, no magic.

---

## Trace schema (v0.1)

```json
{
  "schema_version": "0.1",
  "input": { "prompt": "Refund order 123 if eligible" },
  "events": [
    {
      "type": "tool_call",
      "tool_name": "refund_lookup",
      "arguments": { "order_id": "123" },
      "result": { "eligible": true, "order_id": "123" }
    }
  ],
  "final": { "status": "success", "output_text": "Refund created" }
}
```

`arguments` and `result` may be any JSON value (object, array, string,
number, boolean, null). Order of `events` is preserved.

---

## Why Skar exists

There is a gap between "I can inspect the trace" and "I turned that
failure into a regression test." Observability tools cover the first.
Eval platforms charge you to host your traces in their cloud. Skar fills
the narrow space in between: captured trace in, committable pytest out,
no SaaS, no account, no platform lock-in.

Skar does not promise true deterministic replay. It aims for
**tool-pinned reproduction**: enough structure from a captured run to
create a useful regression test without rebuilding the entire runtime.

---

## Project status

V0 is in place:

- Trace schema validation
- Trace inspection
- Pytest generation from a local trace JSON
- MCP server exposing the same three capabilities

The current source of truth for direction is
[`docs/v0-plan.md`](docs/v0-plan.md). The narrowed proposal that drove
the pivot is in
[`docs/capture-and-convert-v0.md`](docs/capture-and-convert-v0.md). The
generated-test contract is in
[`docs/adapter-contract.md`](docs/adapter-contract.md).

Out of scope for V0: framework adapters beyond the first trace format,
invariant DSLs, fault injection, hosted dashboards, browser replay.

See [`AGENTS.md`](AGENTS.md) for explicit guidance to AI agents reading
this repo.

## License

MIT. See [`LICENSE`](LICENSE).
