# Skar

> Skar turns a captured AI agent trace into a committed pytest regression test.

**New:** [launch post](docs/launch-post.md) — what Skar does, what it
catches, what it doesn't, and the dogfood evidence trail behind the
design choices.

## Who Skar is for

Skar is for teams **writing the code that wraps an LLM into a tool-using
agent** — the orchestration loop that picks tools, constructs messages,
parses tool_use blocks, handles errors, and decides when to stop. If you
ship a custom agent (LangChain, LlamaIndex, Anthropic SDK direct, a Java
service that calls Claude, an AutoGen flow, etc.) and you've ever wanted
to lock a specific run as a regression test, this is for you.

Skar is **not** for engineers using Claude Code or Cursor to write
non-agent code. Those tools *are* the agent — you don't own their
internals, so there's nothing for Skar to regression-test. Skar will
happily capture and visualize those sessions (the HTML report works for
any captured trace), but the headline "test catches behavior drift"
value prop only lights up when you control the agent's code.

For a worked end-to-end example, see
[`examples/anthropic-sdk-mini-agent/`](examples/anthropic-sdk-mini-agent/) —
a ~100-line custom agent with a real Skar test wired around it, runnable
locally with one `pytest` command.

---

## Two halves, two packages

Skar ships in two complementary halves:

| Package | Install | Purpose |
| --- | --- | --- |
| **`@kalisky/skar`** (npm) | `npm install -g @kalisky/skar` | The CLI + MCP server. Validates traces, inspects them, generates pytest regression tests with an HTML summary report. Agent-facing. |
| **`skar`** (PyPI) | `pip install skar` | The Python runtime — a `Recorder` class you wire into your agent code to capture runs and emit Skar trace JSON. Engineer-facing. |

The typical workflow uses both: instrument your agent with `skar.Recorder`,
let it run, feed the resulting trace JSON into `skar generate` (via CLI
or MCP), commit the test. They speak the same Skar trace schema
(v0.1) — the trace JSON is the contract between them.

The npm package's MCP server exposes four tools agents can call directly:
`capture_claude_code_session`, `generate_pytest_regression`,
`validate_trace`, `inspect_trace`.

---

## When to use Skar

You should reach for Skar (or have your agent reach for it) when:

- A custom agent you maintain produced a wrong, broken, or surprising
  tool-using run.
- You have the trace (or you can produce one).
- You want that specific failure to never recur — locked as a test in
  your repo, runnable in CI.

You should **not** use Skar for: live trace capture, observability
dashboards, generic eval scoring, non-tool-using LLM completions, or
testing the behavior of an agent you don't own (Claude Code, Cursor,
etc.). Skar's scope is narrow on purpose: trace → committed regression
test, for agents whose code you control.

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

### Install (Claude Code / Claude Desktop / Cursor)

**Recommended — global install, then register:**

```bash
npm install -g @kalisky/skar
claude mcp add skar -- skar-mcp
```

That's it. Restart your MCP host (Claude Code, Claude Desktop, Cursor)
and the four tools above will be available.

If you prefer a config file over the `claude mcp add` CLI (e.g. for
Claude Desktop, or per-project `.mcp.json` in another host):

```json
{
  "mcpServers": {
    "skar": {
      "command": "skar-mcp"
    }
  }
}
```

**Zero-install alternative** — fetch from npm on first use, no
global install:

```bash
claude mcp add skar -- npx -y -p @kalisky/skar skar-mcp
```

This is slightly slower on first launch and pulls fresh on each
machine, but skips the global install step. Use it for trying Skar
once before committing to a global install.

**Why the bin name matters.** This package ships two bins: `skar`
(the CLI) and `skar-mcp` (the stdio MCP server). The MCP host needs
the `skar-mcp` one — `npx @kalisky/skar` alone would launch the CLI,
which expects shell arguments, not JSON-RPC.

**For Skar contributors** working on this repo, point at the local
source instead:

```bash
claude mcp add skar -- bun run /absolute/path/to/skar/src/mcp/server.ts
```

The server speaks stdio JSON-RPC and exposes the four tools above.

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

If your agent legitimately reorders independent tool calls between
runs and a strict test would be flaky, regenerate with
`--match-mode multiset` (or pass `match_mode: "multiset"` to the MCP
tool). The test still asserts that the same (tool_name, arguments)
pairs occur with the same frequency — only ordering is loosened.

For per-field drift that the regex patterns don't catch (request ids,
session tokens, cwd prefixes), add `--ignore-field <path>` (repeatable;
also `ignore_fields` on the MCP tool). Paths look like `Bash.cwd` to
target one tool's field, `*.request_id` to target any tool, or
`Tool.env.PATH` for nested. The named field is dropped from the
argument dict before comparison; the rest of the argument stays
strict-checked.

Generated tests expect a small adapter module — `skar_adapter.py` —
that imports your real agent code and runs it with the LLM and tools
*stubbed out* from the captured trace. The full pattern, with an
actual Anthropic-SDK agent, is in
[`examples/anthropic-sdk-mini-agent/`](examples/anthropic-sdk-mini-agent/).
Sketch:

```python
# skar_adapter.py
from agent import run_agent  # your real agent loop

def run_agent_under_test(*, prompt, mocked_tool_calls):
    scripted_claude = build_scripted_claude(mocked_tool_calls)
    scripted_tools = build_scripted_tool_executor(mocked_tool_calls)
    return run_agent(
        prompt=prompt,
        claude_call=scripted_claude,
        tool_executor=scripted_tools,
    )
```

The adapter must invoke your **real agent code** with **scripted**
collaborators — not just replay the captured tool_calls verbatim. A
verbatim-replay adapter passes trivially and tests nothing. The whole
point is for your agent's parsing, loop control, and message
construction to run against the captured scenario so a regression in
that code surfaces as a test failure. The example shows exactly how to
script Claude responses + tool results from a Skar trace.

---

## What a generated test catches (and what it doesn't)

**Catches:** loop-control bugs in your agent, message-construction
regressions, tool-dispatch errors, final-text extraction bugs, plus
silent argument drift in places the volatility patterns don't cover.

**Doesn't catch (by design):**

- **LLM behavior changes** — Claude is scripted in the test; we don't
  call the real API. Model upgrades or prompt edits could redirect
  production behavior without ringing this bell.
- **Tool implementation regressions** — tool results are replayed from
  the trace. The real `lookup_order` or `process_refund` could quietly
  start returning the wrong shape and Skar's test wouldn't notice.
  Those tools should have their own unit tests.
- **System prompt regressions** — if your prompt changes the agent's
  tool sequence in production, the scripted-Claude test won't see it.

To catch live LLM / prompt / tool behavior, run a separate test that
invokes the real Anthropic API against a fixed scenario. That test has
different cost, flakiness, and CI implications. Skar's
snapshot-of-decisions tests and your live-LLM tests are complementary,
not substitutes.

You can edit the generated file freely — it's just Python, no DSL,
no magic. Adjust `_VOLATILE_PATTERNS` at the top to add or remove
project-specific normalization rules.

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
