# Skar

> Skar turns a bad agent run into a committed regression test.

Skar is a capture-and-convert tool for AI agents. It takes a captured
tool-using run, normalizes it, and generates a plain test file you can
check into your repo.

The goal is narrow on purpose:

- an agent failed yesterday
- you have the trace
- Skar gives you a readable regression test today

Skar is not:

- another agent framework
- another observability dashboard
- another generic eval platform
- a deterministic replay runtime

## Status

Early design. The repo now reflects a narrowed V0 thesis:

- input: one local trace format, MCP-first
- output: one readable `pytest` file
- value: preserve a real bad run as an executable test

Implementation has not yet begun.

## What V0 Does

V0 is one verb: **capture-and-convert**.

The happy path is:

1. You export a trace from a tool-using agent run.
2. You run:

   `skar generate --from-trace trace.json --out tests/test_regression.py`

3. Skar emits a plain `pytest` file with mocked tool responses and a
   small set of default assertions.
4. You wire one small adapter hook to invoke your agent under test.
5. You run `pytest` and commit the resulting test.

The first V0 assertions are intentionally simple:

- tool sequence matches
- tool arguments match
- final outcome class matches

## Why This Exists

Agent tooling has a gap between:

- "I can inspect the trace"

and:

- "I turned that failure into a regression test"

Observability tools help you see what happened. Skar is aimed at the
next step: generating something concrete and committable from that run.

The project does not promise true deterministic replay. It aims for
**tool-pinned reproduction**: enough structure from a captured run to
create a useful regression test without rebuilding the entire runtime.

## What's In This Repo

- [`docs/v0-plan.md`](docs/v0-plan.md) — the current V0 build plan
- [`docs/capture-and-convert-v0.md`](docs/capture-and-convert-v0.md) —
  the narrowed proposal that drove the pivot
- [`templates/`](templates/) — existing template artifacts from the
  earlier repo direction; some may be repurposed or removed

Legacy design artifacts are still present while the pivot settles:

- [`spec/receipt-v1.md`](spec/receipt-v1.md)
- [`docs/normalizers/README.md`](docs/normalizers/README.md)

They describe the repo's previous "receipt harness" direction and are
not the current product thesis.

## Current Product Boundaries

Out of scope for V0:

- framework adapters beyond the first trace format
- invariant DSLs
- fault injection
- hosted dashboards
- browser replay
- benchmark marketing before the core verb works

## License

MIT. See [`LICENSE`](LICENSE).
