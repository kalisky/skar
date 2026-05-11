# Skar — project-local brief

You're working on Skar, a capture-and-convert tool for AI agents.
Skar's job is to turn a captured bad run into a committed regression
test.

This file is for contributors working on the repo. The user-facing pitch
is in `README.md`.

## Status

The repo has recently pivoted.

The old direction was a broader receipt / authorship harness for coding
agents. The current direction is narrower and simpler:

- input: a captured trace, MCP-first
- output: a readable generated test file
- value: convert a real failure into a check-in-ready regression test

The first runnable v0 slice now exists:

- trace schema validation
- trace inspection
- pytest generation from a local trace JSON

The current source of truth is still `docs/v0-plan.md`.

## Product Boundaries

The important constraint is what Skar is **not** trying to do in v0.

Do not drift back into:

- a framework-agnostic runtime harness
- a trace viewer
- a broad eval platform
- a fault-injection system
- a DSL-heavy invariant engine

The project is one verb:

- capture a run
- generate a test

If a proposed change does not directly strengthen that path, it is
probably v1+ or out of scope.

## Substrate

**Bun + TypeScript** is still the chosen substrate.

Short version:

- fast CLI startup matters
- single-binary distribution is useful
- MCP ecosystem support is strong in TS
- the implementation should stay boring

When implementation starts, scaffold from the repo root with `bun init`.
The Bun project has already been scaffolded and the CLI lives in
`src/cli/`.

## Repo Layout

```text
README.md                         # project pitch + status
CLAUDE.md                         # this contributor brief
LICENSE
docs/
  v0-plan.md                      # current build plan
  capture-and-convert-v0.md       # narrowed proposal that drove the pivot
  normalizers/README.md           # legacy artifact from prior direction
spec/
  receipt-v1.md                   # legacy artifact from prior direction
templates/                        # legacy templates, pending cleanup or reuse
src/                              # to be created with implementation
  cli/                            # CLI entrypoints
  generator/                      # pytest generation
  trace/                          # schema, parser, normalizer
tests/                            # fixtures + unit tests
```

Some legacy files remain because they may still contain reusable ideas,
but they are not the current product definition.

## Conventions

- Commit messages: subject <= 70 chars, imperative verb first.
- Prefer direct, explicit naming over clever abstractions.
- Keep the implementation inspectable. Generated output should be easy
  for users to read and edit.
- Avoid introducing a custom DSL unless there is no simpler path.
- No comments unless the "why" is non-obvious.

## Working style with the agent

- **Be decisive, don't ask yes/no questions for routine choices.** When
  there's a clear best option (style preference, file location, minor
  naming, which of two reasonable approaches to take), just pick it and
  proceed. Mention what you picked in passing. The user will redirect
  if they disagree.
- **Pause and ask only when:**
  - The action is hard to reverse (publish, force-push, deletion).
  - The choice has real strategic weight (audience pivot, scope change,
    architecture direction).
  - You're missing a fact only the user has (their API key shape, their
    deployment target, their team's conventions).
- **Default: execute, then summarize.** Tight end-of-turn summary
  (what changed, what's next). No long lists of options for the user
  to pick from. No "would you like me to..." when the next step is
  obvious.

## Where To Start

Read `docs/v0-plan.md` first, then inspect `src/` and `tests/` for the
current slice.

The first real milestone is deliberately small:

- define one canonical trace schema
- validate and normalize it
- generate one `pytest` file from one sample trace

That milestone is now in place. The next work should keep tightening the
capture-to-test path rather than broadening scope into adapters,
benchmarking, or importer sprawl.

## Things Not To Relitigate Without An Explicit Prompt

- The name `Skar`
- Bun + TypeScript as the implementation substrate
- The v0 scope being capture-and-convert rather than a general framework

If you want to reopen one of these, say so explicitly and explain why.
Do not silently drift the repo back toward the older broader thesis.

## Auto-memory

Project memory lives at
`~/.claude/projects/-Users-kalisky-Private-skar/memory/`.

Read it if you need naming or decision-history context, but prefer the
repo docs as the current source of truth.
