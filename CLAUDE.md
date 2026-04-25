# Skar — project-local brief

You're working on Skar, an authorship harness for AI coding agents.
This file briefs you on what Skar is, where things live, and the
conventions for working in this repo. The pitch and "what's in the
repo" overview is in `README.md`; this file is for *contributors*, not
*users*.

## Status

Early design. The protocol spec, normaliser contract, V0 plan, and
adoption templates are all drafted and committed. **Implementation has
not started.** Phase 0 of the V0 plan (`docs/v0-plan.md`) is the first
real work.

## Substrate

**Bun + TypeScript.** Decision rationale in `docs/v0-plan.md` § Substrate.
Short version: cold-start matters because the PostToolUse hook fires on
every Bash call, Bun nails it (~10–20ms vs Node's ~50–100ms);
`bun build --compile` produces a static binary; Anthropic's MCP TS SDK
is mature; npm ecosystem density is unmatched.

When you start Phase 0, run `bun init` in the repo root to scaffold
`package.json` and `tsconfig.json`. No package.json exists yet on
purpose — the design commit is intentionally pure-design.

## Repo layout

```
README.md                # project pitch + status (for users + casual readers)
CLAUDE.md                # this file (for Claude working *on* Skar)
LICENSE                  # MIT
.gitignore
spec/
  receipt-v1.md          # the Receipt protocol — versioned, normative
docs/
  normalizers/
    README.md            # normaliser contract (interface, fixtures, PR checklist)
  v0-plan.md             # V0 build sequence + benchmark V0 design
templates/               # drop-in artifacts for projects adopting Skar
  CLAUDE.md              # for users — instructs THEIR agent to use Skar's CLI
  mcp.json               # MCP server config for users
  settings.hooks.jsonc   # Claude Code PostToolUse hook entry (observe mode)
src/                     # (will be populated starting Phase 0)
bench/                   # (will be populated starting Phase 5)
```

**Two CLAUDE.md files. Don't confuse them:**
- **`/CLAUDE.md`** (this file) — briefs Claude working *on* Skar's source.
- **`/templates/CLAUDE.md`** — Skar's *users* copy this into their projects to instruct their agents on using Skar.

## Conventions

- **Commit messages:** subject ≤ 70 chars, body wraps at ~78. Lead
  with a verb: "Add", "Fix", "Refactor". Body explains *why* more than
  *what*.
- **Branch model:** trunk-based. `main` is always shippable. Short-lived
  feature branches if needed; merge via PR.
- **Receipt schema is normative.** Any code that emits or consumes
  Receipts must conform to `spec/receipt-v1.md`. Schema changes go
  through the versioning process described in §11 of the spec.
- **Normaliser changes** must include fixture updates per the testing
  contract in `docs/normalizers/README.md`.
- **No comments in code** unless the *why* is non-obvious. Don't
  describe what well-named identifiers already say.

## Where to start

`docs/v0-plan.md` lays out the V0 phases. Phase 0 is the foundation —
Receipt schema as TS types, Journal append/read, raw blob store, sqlite
index, raw normaliser. Until Phase 0 lands, the repo is paper.

## Things NOT to relitigate without an explicit prompt

- The name (long history; **Skar** is settled — see `project_skar.md`
  in auto-memory if curious)
- Substrate (**Bun + TypeScript**, decided)
- Two-mode architecture (observe + invoke share normaliser core, decided)
- Receipt v1 envelope shape (see spec; bump major version for breaking
  changes per §11)

If you want to revisit any of these, surface that the prior decision is
being reopened and ask why. Don't silently change them.

## Auto-memory

Project memory lives at
`~/.claude/projects/-Users-kalisky-Private-skar/memory/`. The most
important file is `project_skar.md` — it contains the decision log,
naming history, and pitch frame in a form that survives across
sessions. Read it early in any session that needs context beyond what's
in the repo.
