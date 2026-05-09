# Capture-and-Convert V0

## Why this document exists

This is a narrowed product proposal to evaluate inside the `skar` repo.

It does **not** replace the existing Skar receipts/observability thesis
yet. It records a sharper wedge that emerged from review:

- stop designing a broad "agent testbench"
- stop promising deterministic replay
- start with one concrete verb:
  capture a bad agent run and convert it into a committed regression test

If this direction survives implementation and user feedback, it may
become the new primary thesis for the repo or a tightly scoped subproject.

## Goal

Ship a minimal CLI that converts a captured agent run into a committed
regression test.

V0 is not a framework. It is one verb:

- ingest a captured trace
- emit a plain test file

## Product Thesis

When an agent fails in a flaky or expensive way, developers need a fast
path from:

- "this bad run happened"

to:

- "this exact scenario is now a checked-in test"

V0 solves only that.

## Non-Goals

Do not build these in v0:

- framework-agnostic runtime adapters
- invariant DSL
- fault injection
- hosted dashboard
- trace viewer
- browser replay
- CI product features
- generalized eval platform
- deterministic replay claims

## Exact V0 Scope

### Input

One local JSON trace format:

- MCP-first
- captured tool call sequence
- tool names
- tool arguments
- tool results
- final outcome

V0 may define its own canonical JSON schema and provide a single importer:

- `skar generate --from-trace <trace.json> --out <test.py>`

### Output

One generated Python `pytest` file:

- readable
- editable
- no custom DSL required

The generated test should include:

- recorded user prompt or scenario input
- mocked tool responses
- a runner stub or hook for calling the user's agent
- default assertions

### Default Assertions

Only ship 2-3 assertions:

- tool sequence matches recorded sequence
- tool arguments match recorded arguments exactly or via normalized JSON
- final outcome class matches

Optional third:

- final text contains a recorded substring

Do not overfit output-text equality.

## User Workflow

### Happy Path

1. User captures or exports a trace from an MCP-based run.
2. User runs:

`skar generate --from-trace trace.json --out tests/test_regression_refund.py`

3. Tool emits a plain `pytest` file plus optional fixture JSON.
4. User wires one small adapter function to invoke their agent under
   test.
5. User runs `pytest`.
6. User edits assertions if needed.

## Proposed CLI

Keep it tiny:

- `skar trace validate trace.json`
- `skar trace inspect trace.json`
- `skar generate --from-trace trace.json --out tests/test_name.py`

No more than this in v0.

## Canonical Trace Shape

Use an internal schema like:

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

This is enough for v0.

## Generated Test Shape

Prefer plain Python:

```python
from my_agent_testkit import run_agent_with_mocked_tools


def test_refund_order_123_regression():
    trace = ...

    result = run_agent_with_mocked_tools(
        prompt=trace["input"]["prompt"],
        mocked_events=trace["events"],
    )

    assert [e["tool_name"] for e in result.tool_calls] == [
        "refund_lookup",
        "refund_create",
    ]
    assert [e["arguments"] for e in result.tool_calls] == [
        {"order_id": "123"},
        {"order_id": "123"},
    ]
    assert result.status == "success"
```

V0 can generate a placeholder import or hook function the user must
implement.

## Architecture

Keep the implementation boring:

### 1. Trace parser

- load JSON
- validate schema
- normalize events

### 2. Trace normalizer

- normalize argument ordering
- normalize tool results
- extract tool-call-only event stream

### 3. Test generator

- template-driven code generation
- generate one `pytest` file

### 4. Minimal runtime contract

Define a tiny expected result shape for the generated test harness:

- `tool_calls`
- `status`
- `output_text`

Do not own agent execution in v0.

## Suggested Repo Layout

```text
src/
  cli/
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

## Build Sequence

### Phase 1

- define canonical JSON schema
- implement validator
- implement trace normalizer
- add sample traces

### Phase 2

- implement test-file generator
- generate readable pytest output
- snapshot test generated files

### Phase 3

- document the required user hook
- wire the tiny CLI
- publish a first local workflow

## Success Criteria

V0 is successful if:

- a user can generate a readable test from one trace in under 2 minutes
- generated tests are simple enough to edit manually
- generated tests preserve tool order and arguments reliably
- the generated file is useful even if the user has to wire one small
  adapter

## Failure Criteria

V0 fails if:

- it requires deep framework integration before first value
- generated tests are opaque or over-engineered
- the tool invents a DSL users have to learn
- normalization is too brittle across small trace changes
- the value depends on future adapters rather than the initial
  conversion step

## Open Decisions

- whether to store mocks inline in the generated test or in a sidecar
  fixture file
- whether to support `vitest` in parallel or stay Python-only at first
- whether to require a user-written adapter function or generate a stub
  module
- whether this should become Skar's primary thesis or remain a focused
  subproject

## Recommended First Milestone

First milestone:

- accept one handcrafted MCP trace JSON
- generate one pytest file
- pass snapshot tests on the generated code

That is enough to validate the product shape.
