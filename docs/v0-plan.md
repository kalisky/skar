# Skar V0 — build plan

This document plans the first runnable version of Skar. It is
prescriptive about *order* (which problems to solve first) and rough
about *quantities* (no day-by-day estimates). The benchmark design that
co-equals the harness is also recorded here.

## Goal of V0

A Claude Code user can:

1. `bunx skar` to install/run the binary.
2. Drop the PostToolUse hook into `~/.claude/settings.json`.
3. Watch `<their-project>/.skar/journal.jsonl` fill with structured
   Receipts for every Bash call their agent makes.
4. Read Receipts back via `skar journal latest <op>` and similar
   commands.
5. Run `skar bench` against the V0 task suite and see Skar-on-vs-off
   numbers reproducibly.

V0 does *not* yet need: invoke-mode caching beyond the simplest case,
auto-fix application, the full MCP server, or more than two tool
normalisers.

## Substrate

**Bun + TypeScript.** Reasoning:

- Cold-start matters because the PostToolUse hook fires on every Bash
  call. Bun is ~10–20 ms cold; Node is ~50–100 ms; Python is ~30–50 ms.
- Native TS, no transpile step in dev.
- `bun build --compile` produces a single static binary.
- Anthropic's MCP TypeScript SDK is the most mature.
- npm ecosystem density is unmatched for CLI dependencies
  (better-sqlite3, ulid, execa, semver, etc.).
- Distribution via `npx skar` / `bunx skar` is the lowest-friction
  path to "try it now" for the AI-tooling audience.

If Bun proves troublesome on some axis (library compat, platform
support), Node TypeScript is the unforced fallback — same code, slightly
worse cold start.

## Phases

### Phase 0 — Foundation (no agent involvement yet)

Get the bones in place. No CLI, no hook, no real normalisers — just
types and storage.

- `bun init`; commit `package.json`, `tsconfig.json`.
- Receipt v1 types in `src/receipt/types.ts`. Match `spec/receipt-v1.md`
  exactly.
- Zod schemas for runtime Receipt validation.
- `src/journal/append.ts` — flock-serialised JSONL append per spec §9.
- `src/journal/read.ts` — tail reader, parser.
- `src/raw/store.ts` — content-addressed raw blob storage at
  `.skar/raw/sha256/<first-byte>/<full>` per spec §6.
- `src/sqlite/index.ts` — sqlite index over `journal.jsonl`,
  rebuildable from JSONL at any time.
- `src/normalizer/types.ts` — Normaliser interface per
  `docs/normalizers/README.md`.
- `src/normalizer/builtin/raw.ts` — the always-matches RawNormaliser.

**Success:** a unit test can write a Receipt and read it back, with
the sqlite index updated and the raw blob stored on disk.

### Phase 1 — Floor (observe mode end-to-end)

Wire the foundation to a real Claude Code session and watch Receipts
flow.

- `src/cli/observe.ts` — entry point for
  `skar observe --from-claude-code-hook`. Reads the Claude Code hook
  payload from stdin, routes through normaliser registry, appends Receipt.
- `src/cli/index.ts` — main CLI entry; wire up `observe` subcommand.
- `bun build --compile` produces `dist/skar`. Path it on the dev
  machine.
- Drop `templates/settings.hooks.jsonc` into a real Claude Code session.
- Observe a session producing Receipts. Inspect with
  `cat .skar/journal.jsonl | jq`.

**Success:** a real Claude Code session at any project produces a
populated `.skar/journal.jsonl` after a few minutes of normal use, with
at least the raw normaliser firing.

### Phase 2 — First real adapter + invoke mode

The smallest invoke-mode op + the first non-trivial normaliser.

- `src/normalizer/builtin/tsc.ts` — parses tsc stderr/stdout into a
  CheckReceipt with code/span/message/fix.
- Fixtures:
  `src/normalizer/builtin/tsc/fixtures/{happy-path,typical-error,empty,malformed}/`
  per the testing contract.
- `src/cli/check.ts` — invoke mode. Runs the configured check command
  through the tsc normaliser, returns Receipt JSON, applies cache.
- `skar.yaml` config schema + loader.
- `src/cache/lookup.ts` — on `input_hash` match, return cached Receipt.
- `src/fix/apply.ts` — apply a Fix from a CheckReceipt to disk
  atomically (stage-and-rename) per spec §8.
- `src/cli/apply.ts` — `skar apply <receipt_id>` command.

**Success:** in a TS project, `skar check` runs tsc, returns a
structured Receipt, cache hits on the second run, and `skar apply`
fixes a known TS2322 in one round-trip.

### Phase 3 — Second adapter + Journal queries

- `src/normalizer/builtin/pytest.ts` — pytest's `--json-report` output
  → TestReceipt. Fixtures.
- `src/cli/test.ts` — invoke mode for `skar test`.
- Journal API CLI:
  - `src/cli/journal/latest.ts`
  - `src/cli/journal/since.ts`
  - `src/cli/journal/chain.ts`
  - `src/cli/journal/raw.ts`

**Success:** in a Python project, `skar test` runs pytest, returns a
structured Receipt with pass/fail counts and stack-trace hashes.
`skar journal chain <id>` returns the causal path from the latest test
Receipt back to its triggering edit.

### Phase 4 — MCP server

- `src/mcp/server.ts` — wraps the CLI 1:1, exposing tools per
  `templates/mcp.json` (check, test, journal_*, apply_fix, deploy,
  refactor).
- Smoke test: a Claude Code session reads/writes Skar Receipts through
  MCP tools.

**Success:** an MCP-aware agent calling `skar.check` gets the same
Receipt JSON the CLI would return.

### Phase 5 — Benchmark V0

The first numbers. Co-equal with shipping the harness.

- `bench/tasks/` — 5 curated tasks across the families described below.
- `bench/conditions/` — `rig-on/CLAUDE.md` (Skar-on, length-matched)
  and `control/CLAUDE.md` (Skar-off, equally specific).
- `bench/runner.ts` — A/B runner that executes
  (task × condition × seed) in isolated worktrees.
- `bench/scorer.ts` — computes `success`, `regression_free`,
  `turns_used`, `wall_time_s`, `cost_usd`, `premature_success_claim`.
- `src/cli/bench.ts` — `skar bench run / report / regress` CLI.
- `bench/results/2026-XX-XX-vY.Z/` — first published run committed to
  the repo.

**Success:** `skar bench run --suite v0 --conditions rig,control
--model sonnet-4-6 --seeds 3` produces a directory with reproducible
numbers and a summary table. The numbers go in the README.

### Phase 6 — Polish + first release

- `src/cli/init.ts` — `skar init` scaffolds a project to use Skar
  (drops the `templates/CLAUDE.md`, `mcp.json`, `settings.hooks.jsonc`
  into the right places).
- Release v0.1.0 to npm: `@kalisky/skar` (the bare `skar` slot is
  taken; scope it).
- README updated with installation, quickstart, benchmark numbers.
- `CONTRIBUTING.md`, basic CI (typecheck + tests + benchmark
  smoke-run).

**Success:** a fresh user runs `bunx @kalisky/skar init` in a TS
project, gets a working observe + invoke setup with pre-seeded
CLAUDE.md, and can run `bunx @kalisky/skar bench` to see the V0
numbers locally.

## Benchmark V0 details

Living spec; revise during Phase 5.

### Task families

- **Refactor-and-verify** (high Skar lift): "Rename the `User` class
  to `Account` across this codebase. All tests must still pass."
- **Close-the-loop** (high Skar lift, silent-failure trap): "Fix this
  bug. Your fix must pass the existing tests AND a hidden regression
  test."
- **Build-and-deploy** (high Skar lift): "Build a service with these
  three endpoints. Deploy. Hit `/health` and confirm 200."
- **Long-loop debug** (medium): "This service is failing. Logs show X.
  Fix it."
- **Pure algorithmic** (low Skar lift, honest denominator): "Implement
  function X with these tests."

### Metrics

Per-run scalars:

- `success` — boolean, success_criteria pass
- `regression_free` — boolean, regression_criteria pass
- `turns_used`, `wall_time_s`, `cost_usd`, `tool_calls_total`
- `premature_success_claim` — agent stopped before turn budget while
  criteria failing (deterministic proxy for silent failure)
- `recovery_events` / `avg_recovery_turns` — added once Phase 3 lands

### Honest control

- Both conditions get matched-length `CLAUDE.md`s.
- Control's `CLAUDE.md` is written by someone *not* on the Skar
  project, if possible (adversarial author).
- Both `CLAUDE.md`s are committed alongside the benchmark results so
  readers can audit them.

### Stats

- Per-task delta with paired bootstrap CI over seeds.
- Aggregate delta across tasks with paired bootstrap.
- Heatmap of (model × task family) lift; do not collapse to a single
  headline number until the grid supports it.

### Reproducibility

- All runs in fresh worktrees or rootless containers.
- Network whitelist-only.
- Budgets enforced by the runner.
- Every run produces a committable directory with full transcripts,
  metrics, final-state diffs, and the `receipts.jsonl` from the run.

## Open decisions

None blocking V0. Decisions locked in:

- Substrate: Bun + TypeScript ✓
- Repo: github.com/kalisky/skar (public, owner-only push) ✓
- License: MIT ✓
- Receipt v1 envelope and op kinds ✓ (see spec)
- Normaliser contract ✓ (see `docs/normalizers/`)
- Two-mode (observe + invoke) architecture ✓

Decisions deferred to V1+:

- DAG receipts (multiple parents). v1 keeps single-parent.
- Cross-repo / monorepo Journals. v1 is one-Journal-per-worktree.
- Signed / tamper-evident receipts.
- Encryption at rest for Journals.
- Receipts for human-authored edits when the agent isn't the actor.
- Benchmark scoring via LLM judge (deterministic proxy first).
