# Dogfood findings

This document is the evidence trail behind every matcher / loosening
design choice in the generated test. Each section captures: what we
observed when running Skar on a real trace, what we decided in response,
what we explicitly deferred or rejected, and how the fix was verified.

The goal is to make it hard to re-litigate these choices without first
re-examining the evidence — and easy for a future contributor to see
*why* the matcher looks the way it does.

The findings are listed chronologically. Each round of dogfood produced
a specific change in the codebase; the linked commits are noted.

---

## Finding 1: Captured arguments contain one-shot identifiers

**Trace.** A Claude Code session in `~/IdeaProjects/abadai-repo`
(session `f0e33686-83b8-4d7d-ace0-390916d2c11e.jsonl`, 9 tool calls,
all Bash + Read). The agent was analyzing locally-cached backtesting
results.

**Observation.** Seven of the nine Bash commands contained a one-shot
temp UUID embedded in the working directory:
`/var/folders/45/.../T/abadai-bt-analysis/bf61d499-9c17-43af-bbb7-aaff1685fd53/...`.
A naive regression test asserting exact argument equality would have
passed on the captured replay and **failed on every subsequent run**
when the agent picked a different temp UUID. That's the dominant
flakiness mode for any trace-derived test.

**Decision.** Add a drift-tolerant matcher layer between the captured
args and the observed args. Concrete patterns introduced (regex,
applied to all string values before comparison):

- 36-character UUIDs → `<UUID>`
- macOS per-user temp directories (`/var/folders/.../T`) → `<TEMP>`
- Linux temp (`/tmp`, `/var/tmp`) → `<TEMP>`
- ISO-8601 timestamps → `<TIMESTAMP>`

The patterns are emitted as a hand-editable `_VOLATILE_PATTERNS` list
at the top of every generated test, so users can extend or trim per
project. The Python `_normalize` function is applied to both captured
and observed values before comparison.

**Deferred.** Per-tool customization, full normalization of arbitrary
string content, fuzzy matching. The strict-equality-after-normalization
was the smallest change that fixed the dominant failure mode.

**Verification.** Built a `redrift` adapter that returns the captured
tool calls with the UUID swapped to a different value. Without the
matcher: test fails. With the matcher: test passes. A real regression
(dropped tool call) still fails as expected.

---

## Finding 2: User home directories appear constantly across traces

**Traces.** Three more diverse Claude Code sessions captured for the
second dogfood pass:

- `abadai-platform/e9f0adbb` (113 tool calls)
- `abadai-web/1a6fd392` (146 tool calls)
- `abadai-repo/02ca8e23` (7 tool calls)

**Observation.** After applying the round-1 normalizers, scanned the
remaining captured-arg strings for unhandled volatility. `/Users/kalisky`
appeared **155 times** across the three sessions. The home directory
isn't temp-dir-shaped, isn't UUID-shaped, isn't timestamp-shaped — but
it's universally present and would differ between any two developers'
machines or any local-vs-CI run.

**Decision.** Add home-directory normalization patterns, one per major
OS and one per typical filesystem separator convention:

- macOS: `/Users/<name>/...` → `<HOME>/...`
- Linux: `/home/<name>/...` → `<HOME>/...`
- Windows (backslash): `C:\Users\<name>\...` → `<HOME>\...`
- Windows (forward-slash via WSL/Git Bash): `C:/Users/<name>/...` → `<HOME>/...`

Also added bare dates `YYYY-MM-DD` → `<DATE>` (with a negative
lookahead to avoid double-matching the date portion of an ISO
timestamp).

**Ordering matters.** The Windows forward-slash variant (`C:/Users/...`)
has to run *before* the macOS variant (`/Users/...`), because
`/Users/Bob` is a substring of `C:/Users/Bob` and the macOS rule would
otherwise eat the suffix and leave a stray `C:` prefix.

**Deferred (and rejected with reason).** Patterns the dogfood surfaced
but we deliberately did *not* auto-normalize:

- **Git SHAs** (7-char and 40-char hex). Often regression-relevant —
  if a SHA changes, that might be a real behavior change worth
  catching. Auto-normalizing them would mask real regressions.
- **12-digit numeric IDs** (e.g. AWS account IDs). Too ambiguous —
  could be many things; high false-positive rate.
- **`localhost:port`** entries. Typically stable per-dev-environment;
  normalizing would tolerate drift that doesn't actually happen.

These remain available for users to add to `_VOLATILE_PATTERNS`
themselves; the comment at the top of every generated test invites
this.

**Verification.** Re-ran the abadai dogfood with the expanded matcher
and a `redrift` that swapped *both* the UUID and the username. Both
strict replay and redrift passed; real regression still failed.

---

## Finding 3: The original target audience was wrong

**Observation.** Every dogfood up to this point used Claude Code
sessions where the user was using Claude Code as an IDE assistant for
non-agent code (Java trading services, web dashboards). The "agent" in
those captures was Claude Code itself — a tool the user *uses*, not
one they *build*.

For Skar's regression-test value prop to actually deliver, the user
has to be able to *re-run* the agent under test on a captured prompt
and assert that the same tool sequence emerges. That's only meaningful
when the user owns the agent's code (custom Python agent wrapping
Claude API, LangChain agent, etc.). It's *not* meaningful for someone
using Claude Code to write Java — they can't re-run Claude Code in CI.

**Decision.** Reframe the README explicitly: Skar is for teams writing
custom agent code, not for users of off-the-shelf agentic products.
Add a worked example with a *real* custom agent so the audience can
see how the pieces fit together end-to-end.

Two examples built:

- `examples/anthropic-sdk-mini-agent/` — ~100-line Python loop around
  the Anthropic Messages API. Uses `Recorder.wrap()` for capture.
- `examples/langchain-mini-agent/` — same refund domain, but using
  LangChain's `create_agent`. Uses `Recorder.note_call()` from a
  `BaseCallbackHandler` because LangChain dispatches tools internally
  and there's no single executor to wrap.

Both examples include: a captured trace, a generated test, the HTML
report, and a `skar_adapter.py` that runs the *real* agent loop under
a scripted fake LLM. The agent code runs end-to-end in the test;
only the LLM call is stubbed.

**Verification.** Injected a real bug in each example's agent code
(`for tu in tool_use_blocks[:1]:` in the Anthropic example;
removing a tool from the LangChain agent's tool list) and confirmed
the generated test fails with a clear diff. Restoring the code makes
it green.

---

## Finding 4: Real LLM agents reorder independent tool calls

**Observation (predicted, not yet observed in real-world adoption).**
A regression test that asserts strict sequence equality will be flaky
for non-deterministic agents. The dogfood examples are scripted, but
the moment a real user wires this up with a live LLM, two consecutive
runs of the same prompt can produce the same *set* of tool calls in
different orders — particularly for parallel-feeling subtasks like
"look up these three items."

**Decision.** Add a `match_mode` option:

- `match_mode=strict` (default) — current behavior. Exact sequence,
  position-wise argument equality after normalization.
- `match_mode=multiset` — assert that the same `(tool_name,
  normalized_args)` pairs appear with the same frequencies, regardless
  of order.

Multiset still catches dropped calls, extra calls, and argument drift
beyond the volatility patterns. The only thing it loosens is ordering.

**Deferred.** Richer match modes (windowed ordering, optional steps,
phase grouping). These are real concerns but speculative without
adopter feedback. Multiset is the smallest mode that covers the most
common predicted failure pattern.

**Verification.** Built a `reordered` adapter that returns the
captured tool calls in reverse order. Strict mode fails; multiset
mode passes. A `dropped-call` variant fails under both modes,
confirming multiset still catches real regressions.

---

## Finding 5: Some per-field drift can't be regex-pattern-matched

**Observation.** The default normalizers handle string-shape drift
(UUIDs, paths, timestamps). They don't handle cases where a tool
*field* drifts but the field's content has no recognizable shape:

- A `Bash.cwd` of `/var/folders/45/abc/T/pytest-of-alice-7` —
  *almost* macOS-temp-shaped but one path component short, so the
  default `(?:private/)?var/folders/[^/]+/[^/]+/T` pattern doesn't
  match.
- A `Tool.request_id` opaque token that doesn't look like a UUID.
- A `Tool.env.PATH` whose contents reorder between runs.

Hand-editing every generated test for one project-specific quirk is
exactly the kind of friction that kills adoption.

**Decision.** Add `ignore_fields` (CLI `--ignore-field`, MCP
`ignore_fields`). JSONPath-style:

- `Bash.cwd` — drop `cwd` from `Bash`'s arguments before comparison.
- `*.request_id` — drop `request_id` from any tool's arguments.
- `Bash.env.PATH` — nested paths supported.

The named fields are removed from a deep copy of the argument dict
before normalization runs. The rest of the argument is still
strict-checked.

**Verification.** Built a trace whose `Bash.cwd` has the
non-canonical temp shape above. Without ignore_fields: a strict test
fails when the cwd drifts. With `--ignore-field Bash.cwd`: passes.
Changing the actual `command` field in the same adapter still fails
the test — confirming the ignore loosens *one named field* without
weakening the rest of the comparison.

---

## Finding 6: The HTML report was leaking redacted-token shapes

**Observation.** Skar redacts secret-shaped strings (`sk-ant-...`,
`ghp_...`, `AKIA...`, JWT triples, PEM blocks) before rendering the
trace into the generated test file. The test file has never contained
these tokens verbatim.

**The HTML report did.** When the report-result-preview feature
landed, the captured-slice table started showing tool return values.
The report renderer received the *original* normalized trace (not the
redacted one used for code generation), so the first generated report
displayed a fake `sk-ant-api03-aaaa...` token verbatim in the result
column of the `lookup_order` row.

**Decision.** The redaction must happen in *exactly one place* and
flow to every output. `generatePytestCaseDetailed` now returns the
redacted trace alongside the generated source; both callers
(`cli/generate.ts` and `mcp/server.ts`) pass that redacted trace to
`renderHtmlReport`, not the original.

**Verification.** Re-ran with the same fixture containing the fake
token. `grep "sk-ant-api03-aaaa" /tmp/report.html` → zero matches.
`grep "REDACTED" /tmp/report.html` → two matches (the locations
where the token used to be). A regression test in
`tests/report/html.test.ts` exercises the contract: the renderer
trusts its input; callers must pass `result.redactedTrace`.

---

## What this document is *not*

- It is not a comprehensive list of every feature in Skar. Read the
  source for that — `src/generator/pytest.ts` and
  `src/report/html.ts` are the two interesting files.
- It is not an immutable record. If a future finding invalidates one
  of these decisions, edit the relevant section with the new
  observation and reasoning. Don't delete the original — strike
  through or annotate it. The evidence trail matters.
- It is not where to add aspirational features. New features go in
  the README and AGENTS.md once they ship.

## How to use this when you're about to change the matcher

Before touching `_VOLATILE_PATTERNS`, `_IGNORE_FIELDS`, the
`match_mode` semantics, or the redaction list: read the corresponding
finding section here first. The patterns weren't chosen by taste —
each one fixes a specific observed failure mode. Removing or
loosening a pattern without checking the evidence trail risks
re-introducing the original bug.

If your change is driven by a *new* observed failure, add a finding
section here documenting it before you ship the fix. The doc and the
code change should land in the same commit.
