# Skar

> Skar turns AI coding from "trust me" into "here's the receipt."

Skar is an authorship harness for AI coding agents. It wraps the tools your
agent already uses — typecheckers, test runners, deploy CLIs — and emits
every action as a structured JSON receipt. The agent uses receipts to
catch its own mistakes; humans use them to verify without reading every
line.

## Status

Early design. The protocol spec, normalizer contract, and adoption
templates are drafted. **Implementation has not yet begun.** This repo
currently contains design artifacts only.

## How it works

Skar runs in two modes that share one normalizer core:

- **Observe** is the floor: a Claude Code `PostToolUse` hook intercepts
  every Bash call, matches a normalizer (tsc, pytest, etc.), and appends
  a structured receipt to `<worktree>/.skar/journal.jsonl`. Zero-install
  default.
- **Invoke** is the ceiling: the agent calls `skar check` / `skar test` /
  `skar deploy` / `skar refactor` directly and gets back richer receipts
  with caching, fix application, and enforced invariants (e.g. `deploy`
  refuses if the most recent `check` failed).

Both modes write the same Receipt v1 records to the same Journal. Agents
read receipts back through a Journal API instead of parsing tool prose;
humans `grep` and `jq` the same log.

## What's in this repo

- [`spec/receipt-v1.md`](spec/receipt-v1.md) — the Receipt protocol, v1
  draft. The contract every Skar implementation honors. Versioned and
  intended to be stable enough that other tools (third-party agents,
  language servers, CI runners) can adopt it independently.
- [`docs/normalizers/README.md`](docs/normalizers/README.md) — the
  extension surface. Anyone who wants Skar to understand a new tool
  writes a normalizer.
- [`templates/CLAUDE.md`](templates/CLAUDE.md) — drop-in `CLAUDE.md` for
  projects that want their agents to use Skar.
- [`templates/mcp.json`](templates/mcp.json) — MCP server config wiring
  Skar's tools into MCP-aware agents (Claude Code, Cursor).
- [`templates/settings.hooks.jsonc`](templates/settings.hooks.jsonc) —
  Claude Code `PostToolUse` hook entry for observe mode.

## Why this exists

Today, when an AI agent works on your codebase, you have two options:
trust it, or read through everything it did. Skar adds a third — a
structured receipt for every step that you can skim in seconds and the
agent can use to fix its own mistakes. The premise is that the single
biggest cause of wasted agent loops is *prose-as-feedback*: agents have to
infer success from compiler text and exit codes, which is slow and
error-prone. Receipts replace inference with reading.

## License

MIT. See [`LICENSE`](LICENSE).
