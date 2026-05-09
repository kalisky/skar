# Skar V0 — build plan

This document defines the first runnable version of Skar after the repo
was narrowed to a capture-and-convert product.

V0 is not a framework. It is one concrete workflow:

- ingest a captured trace
- emit a plain regression test

## Goal of V0

A developer can:

1. export or handcraft one MCP-style trace JSON
2. run:

   `skar generate --from-trace trace.json --out tests/test_case.py`

3. get a readable `pytest` file
4. wire one small adapter hook to invoke their agent under test
5. run `pytest` and commit the test

That is enough for V0.

## Non-Goals

Do not build these in V0:

- framework-specific adapters
- trace viewers
- fault injection
- invariant DSLs
- hosted observability features
- benchmark suites
- CI-specific product layers
- deterministic replay claims

## Substrate

**Bun + TypeScript**

Reasons:

- fast CLI startup
- static binary distribution via `bun build --compile`
- strong TypeScript ecosystem for CLI and MCP-adjacent work
- keeps implementation consistent with the rest of the repo's direction

If Bun becomes painful in practice, Node TypeScript is the fallback.

## Canonical Input

V0 supports one local JSON trace shape, MCP-first.

Required information:

- prompt or scenario input
- ordered tool calls
- tool names
- tool arguments
- tool results
- final outcome

Suggested shape:

```json
{
  "schema_version": "0.1",
  "input": {
    "prompt": "Refund order 123 if eligible"
  },
  "events": [
    {
      "type": "tool_call",
      "tool_name": "refund_lookup",
      "arguments": { "order_id": "123" },
      "result": { "eligible": true, "order_id": "123" }
    },
    {
      "type": "tool_call",
      "tool_name": "refund_create",
      "arguments": { "order_id": "123" },
      "result": { "status": "success", "refund_id": "r_123" }
    }
  ],
  "final": {
    "status": "success",
    "output_text": "Refund created"
  }
}
```

## Canonical Output

V0 emits one readable Python `pytest` file.

The generated file should include:

- recorded input prompt
- mocked tool responses
- a placeholder adapter hook the user can implement
- a small set of default assertions

Default assertions:

- tool sequence matches
- tool arguments match
- final outcome class matches

Optional:

- final output contains a stable substring

Avoid exact output-text assertions by default.

## CLI Surface

Keep it small:

- `skar trace validate <trace.json>`
- `skar trace inspect <trace.json>`
- `skar generate --from-trace <trace.json> --out <test.py>`

If a command is not essential to that path, it does not belong in v0.

## Architecture

### Phase 0 — Foundation

- `bun init`
- CLI skeleton
- TypeScript + runtime validation setup
- test harness setup

Success:

- repo boots as a Bun CLI project
- tests run locally

### Phase 1 — Trace schema + parser

- define canonical trace schema in `src/trace/schema.ts`
- implement parser in `src/trace/parser.ts`
- implement validator errors that are readable
- add sample trace fixtures

Success:

- valid traces parse
- invalid traces fail with useful messages

### Phase 2 — Trace normalizer

- normalize argument ordering
- normalize tool results
- extract tool-call-only event stream
- define minimal internal model for generation

Success:

- semantically equivalent input traces normalize consistently

### Phase 3 — Pytest generator

- template-driven code generation
- generate one readable pytest file
- emit a placeholder adapter function contract
- snapshot-test generated files

Success:

- a sample trace produces a stable, readable test file

### Phase 4 — Tiny CLI end-to-end

- wire `trace validate`
- wire `trace inspect`
- wire `generate`
- write a short README example

Success:

- a user can go from `trace.json` to `tests/test_*.py` in one command

## Minimal Runtime Contract

The generated test should rely on a tiny user-implemented adapter
contract, not on Skar owning agent execution.

Expected result shape:

- `tool_calls`
- `status`
- `output_text`

That contract should be explicit and minimal.

## Suggested Repo Layout

```text
src/
  cli/
    index.ts
    trace_validate.ts
    trace_inspect.ts
    generate.ts
  trace/
    schema.ts
    parser.ts
    normalizer.ts
  generator/
    pytest.ts
    templates/
      pytest_case.py.j2
tests/
  fixtures/
    trace_minimal.json
    trace_refund.json
  trace/
    parser.test.ts
    normalizer.test.ts
  generator/
    pytest.test.ts
```

## Success Criteria

V0 succeeds if:

- a readable test can be generated from one trace in under 2 minutes
- generated tests are easy to edit by hand
- tool sequence and arguments are preserved reliably
- the value is clear before any framework adapter exists

## Failure Criteria

V0 fails if:

- it requires deep framework integration before first value
- it invents a DSL users must learn
- generated tests are opaque or brittle
- the project drifts back into platform design before the core verb works

## Open Decisions

- inline mocks vs sidecar fixture file
- Python-only first vs Python + Vitest
- exact naming of the user adapter module
- when, if ever, to add trace importers for specific frameworks

## First Milestone

The first milestone is intentionally small:

- accept one handcrafted trace JSON
- generate one pytest file
- snapshot-test the generated output

Nothing broader should start before that works.
