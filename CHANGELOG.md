# Changelog

Skar ships in two packages from one repo. Entries below are tagged by
package: `[npm]` for `@kalisky/skar` (CLI + MCP server) and `[pypi]`
for `skar` (Python runtime / Recorder).

## [npm 0.3.0] — unreleased

CLI / MCP server.

- Add `match_mode` (`strict` | `multiset`) for non-determinism
  tolerance. Strict (default) asserts position-wise tool sequence
  equality after normalization. Multiset asserts the same
  `(tool_name, normalized_args)` pairs occur with the same
  frequencies, regardless of order — for agents that legitimately
  reorder independent tool calls between runs.
- Add `ignore_fields` for per-tool argument stripping. CLI
  `--ignore-field` (repeatable); MCP `ignore_fields`. JSONPath-style
  syntax: `Bash.cwd`, `*.request_id`, `Tool.env.PATH`. The named
  fields are dropped from a deep copy of the argument dict before
  comparison; the rest of the argument stays strict-checked.
- HTML report previews tool results in the captured-slice table.
  Routed through the redacted trace so any secret-shaped string
  is collapsed to `<REDACTED>` before rendering — the report never
  sees verbatim tokens.
- HTML report displays the active `ignore_fields` list when set,
  so a reviewer can see what was loosened at a glance.

Docs.

- New `docs/dogfood-findings.md`: evidence trail for every matcher
  / loosening choice. Each section captures what was observed,
  what was decided, what was explicitly deferred or rejected, and
  how the fix was verified. Read this before changing
  `_VOLATILE_PATTERNS`, `_IGNORE_FIELDS`, or the redaction list.

## [pypi skar 0.2.0] — unreleased, first PyPI release

Python runtime.

- `skar.Recorder` — capture tool-using agent runs and emit Skar
  trace JSON conforming to schema v0.1. Two capture surfaces:
  `Recorder.wrap(tool_fn)` for agents with a single tool-executor
  function, and `Recorder.note_call(...)` for agents (e.g.
  LangChain) that dispatch tools internally.
- Context manager API: `with Recorder(out_path) as r: ...`
  auto-finalizes and writes the trace on exit. Inferred
  `final.status` from exception state when not set explicitly.
- Worked examples under `examples/anthropic-sdk-mini-agent/` and
  `examples/langchain-mini-agent/` demonstrate end-to-end capture
  and regression-test wiring against a real custom agent.

## [npm 0.2.0]

CLI / MCP server.

- Curation inputs on MCP tools (`last_n_tool_calls`,
  `from_index`/`to_index`, `redact_patterns`).
- Static HTML summary report (`--report <path>`, single
  self-contained file with captured slice, redaction counts,
  drift-tolerance summary, plain-English description of test
  assertions).
- Capture-time secret redaction with default patterns for common
  token shapes (`sk-ant-*`, `ghp_*`, `AKIA*`, JWT triples, PEM
  blocks).

## [npm 0.1.1]

CLI / MCP server.

- Default secret redaction in generated tests.
- Path-constraint defenses on MCP file inputs.

## [npm 0.1.0]

Initial npm release.

- Trace schema (v0.1) + validation.
- `skar trace validate` / `skar trace inspect`.
- `skar generate` produces a readable pytest file from a trace.
- MCP server exposing `validate_trace`, `inspect_trace`,
  `generate_pytest_regression`, and (added late in 0.1.0)
  `capture_claude_code_session`.
