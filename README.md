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

Skar ships as an MCP server with four tools:

| Tool | Purpose |
| --- | --- |
| `capture_claude_code_session` | Read a Claude Code session log and emit a Skar trace. The natural first step when the user wants to lock a recent session as a regression test. |
| `generate_pytest_regression` | Convert a captured trace into a ready-to-commit pytest file. |
| `validate_trace` | Confirm a captured trace conforms to the Skar schema; surface field-level errors. |
| `inspect_trace` | Summarize what an agent did in a captured run. |

If you are an AI agent reading this and the user just had a Claude
Code session that produced a wrong run, the typical flow is two MCP
calls:

1. `capture_claude_code_session` — auto-discovers the latest session
   for the current working directory (or pass `session_path`
   explicitly). Optionally slice with `last_n_tool_calls` if only the
   tail of a long session is the bad part.
2. `generate_pytest_regression` — pass the captured trace JSON straight
   in via `trace_json`, get a ready-to-commit pytest back.

If the user already has a trace in some other shape, skip step 1 and
go straight to `generate_pytest_regression` with `trace_path` or
`trace_json`.

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
bun install
bun run src/cli/index.ts trace validate tests/fixtures/trace_refund.json
bun run src/cli/index.ts trace inspect tests/fixtures/trace_refund.json
bun run src/cli/index.ts capture claude-code \
  --last-n 10 \
  --out /tmp/trace.json
bun run src/cli/index.ts generate \
  --from-trace /tmp/trace.json \
  --out /tmp/test_regression.py \
  --test-name regression \
  --note "agent missed validation step" \
  --redact-pattern "CUST-\d+" \
  --report /tmp/regression-report.html
```

(npm/npx work fine too if you don't have Bun.)

The `--report` HTML is a single self-contained file you can glance at
before committing the test or attach to a PR — it surfaces the captured
slice, redaction counts, drift-tolerance summary, and a plain-English
description of what the test asserts. No server, no JS.

For finer slicing than `--last-n`, use `--from-index` and `--to-index`
to pick an exact 0-based range over the captured tool calls. Add as
many `--redact-pattern <regex>` flags as you need to scrub project-
specific token shapes.

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
`output_text`. **The adapter is meant to mock the agent and replay the
captured tool calls, not to actually invoke your live agent.** A naive
implementation that re-calls real tools or services would re-execute
side-effects (Bash commands, DB writes, API calls) every time `pytest`
runs. Treat regression tests as offline replays.

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

## Security & sensitive data

Skar makes no network calls, runs no shells, and emits plain Python
that does not use `eval` or `exec`. That said, four things are worth
knowing:

**1. Generated tests contain the trace verbatim.** Every captured tool
call's arguments and result, plus the prompt, ends up in the `TRACE
= {...}` block. If a captured session involved API keys, internal
URLs, customer records, or other secrets, those values land in the
file you commit. **Review every generated test before committing.**

**2. Skar trace files are an injection vector.** Inspecting or
generating from a trace puts its contents into your agent's context.
Don't run Skar on traces from untrusted sources (forums, public
artifacts, etc.) — an attacker who controls the trace controls part
of the prompt.

**3. The adapter must mock, not invoke.** `run_agent_under_test()` is
intended to replay captured tool calls against in-memory mocks. A
naive implementation that calls real Bash, hits real APIs, or writes
to real databases turns every `pytest` run into a real-world side
effect.

**4. MCP path inputs run with your permissions.** `session_path`,
`output_path`, and `trace_path` accept arbitrary paths. The MCP host
(Claude Desktop, Code, Cursor) is responsible for gating file
operations behind user approval; Skar inherits whatever filesystem
access you grant. Treat unfamiliar Skar tool calls the same way you
treat any agent file-write request.

If you find a security issue, please open a private issue or email
the repository owner before disclosing publicly.

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
