# Receipt v1 — protocol spec

**Status:** Draft-1 · **Schema identifier:** `receipt/v1` · **Date:** 2026-04-23

## 1. Abstract

This document specifies Receipt v1, a line-delimited JSON protocol for
recording structured authorship events produced by AI coding agents and
the tools they drive. A Receipt captures one event — an edit, a type-check,
a test run, a refactor, a deploy — in a form both machines and humans can
read without ambiguity.

The protocol is transport-agnostic. Conforming implementations write
Receipts to an append-only file called the Journal and expose a read API
over that file. The Journal provides the agent with structured memory of
its own actions.

## 2. Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are to be
interpreted as described in RFC 2119.

- **Receipt** — a single event record, one JSON object per line.
- **Journal** — the append-only sequence of Receipts for a single worktree.
- **Op** — the event kind. Enumerated in §4.
- **Normalizer** — an implementation that parses a tool's raw output into
  a Receipt's op-specific payload.
- **Worktree** — a single checked-out filesystem directory that the
  harness is instrumenting.

## 3. Receipt envelope

Every Receipt is a single JSON object terminated by `\n`. The envelope
MUST contain the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `schema` | string | yes | Exact value `"receipt/v1"` |
| `id` | string | yes | ULID; MUST be unique within the Journal |
| `parent` | string \| null | yes | `id` of the causal parent Receipt, or `null` for the first Receipt in the Journal |
| `ts` | string | yes | ISO 8601 UTC timestamp of event completion, millisecond precision |
| `op` | string | yes | One of the op kinds defined in §4 |
| `tool` | string | yes | Machine name of the tool; `"harness"` for harness-native ops |
| `substrate` | string | yes | Language/runtime context, e.g. `"typescript"`, `"python"`, `"mixed"` |
| `via` | string | yes | `"invoke"` or `"observe"` |
| `cmd` | string[] | yes | The argv that executed, or `[]` for harness-native ops |
| `cwd` | string | yes | Absolute path of the worktree root |
| `ok` | boolean | yes | Event succeeded by the tool's own criteria |
| `duration_ms` | integer | yes | Wall-clock ms between start and end of the event |
| `input_hash` | string \| null | yes | SHA-256 of the canonical inputs per §7; null if op has no input |
| `output_hash` | string \| null | yes | SHA-256 of the canonical outputs if applicable; else null |
| `data` | object | yes | Op-specific payload per §4 |
| `raw` | object \| null | cond. | Raw-output descriptor per §6. MUST be present when `via = "observe"` or when an underlying tool ran. MAY be null for harness-native ops. |
| `agent` | object | no | `{name, version, session}` identifying the agent that triggered the event |

Additional fields MAY be present. Unknown fields MUST be preserved when
re-emitting Receipts and MUST NOT cause parse failure.

## 4. Op kinds and `data` payloads

### 4.1 `op: "edit"`

A file was modified.

```json
{ "file": "<path relative to cwd>",
  "pre_hash":  "sha256:...",
  "post_hash": "sha256:...",
  "diff_stat": { "added": <int>, "removed": <int> } }
```

### 4.2 `op: "check"`

A static check (type-check, lint) ran.

```json
{ "errors":   [ <ErrorEntry>, ... ],
  "warnings": <int>,
  "files_checked": <int> }
```

`ErrorEntry`:

```json
{ "code":     "<string>",
  "severity": "error" | "warning" | "info",
  "span":     <Span>,
  "message":  "<string>",
  "fix":      <Fix> | null }
```

### 4.3 `op: "test"`

A test suite ran.

```json
{ "passed":      <int>,
  "failed":      [ { "name": "<string>", "file": "<string>", "line": <int>,
                     "message": "<string>", "trace_hash": "sha256:..." | null } ],
  "skipped":     <int>,
  "duration_ms": <int> }
```

### 4.4 `op: "refactor"`

A hash-propagating or name-changing operation on the codebase.

```json
{ "kind":               "rename" | "move" | "extract" | "inline",
  "target":             "<string>",
  "new_target":         "<string>",
  "dependents_updated": <int>,
  "dependents_broken":  <int>,
  "files_touched":      <int> }
```

### 4.5 `op: "deploy"`

The codebase (or an artifact built from it) was shipped to a reachable URL
or endpoint.

```json
{ "url":             "<string>",
  "version_hash":    "sha256:...",
  "health":          { "status":     "ok" | "degraded" | "down",
                        "latency_ms": <int>,
                        "checked_url": "<string>" },
  "idempotent_skip": <boolean> }
```

### 4.6 `op: "digest"`

A summary Receipt produced by compaction (§10).

```json
{ "window":         { "from": "<ISO>", "to": "<ISO>" },
  "counts":         { "<op>": <int>, ... },
  "ok_rate":        { "<op>": <float>, ... },
  "preserved_ids":  [ "<id>", ... ] }
```

### 4.7 `op: "harness"`

A harness-internal event: normalizer failure, cache invalidation, lock
timeout, etc. `data` SHOULD contain a `code` (an `SKR-*` identifier) and
free-form `detail`.

### 4.8 `op: "raw"`

Fallback when no matching normalizer was found. `data` SHOULD be the empty
object; the `raw` envelope field carries the output.

## 5. Span and Fix structures

`Span`:

```json
{ "file":     "<path relative to cwd>",
  "line":     <int, 1-indexed>,
  "col":      <int, 1-indexed, UTF-16 code units>,
  "end_line": <int, 1-indexed>,
  "end_col":  <int, 1-indexed, UTF-16 code units, EXCLUSIVE> }
```

`Fix`:

```json
{ "kind":        "replace" | "insert" | "delete" | "multi",
  "span":        <Span>,             // for replace | delete
  "at":          <Span>,             // for insert; zero-width Span
  "replacement": "<string>",         // for replace
  "text":        "<string>",         // for insert
  "edits":       [ <Fix>, ... ],     // for multi
  "confidence":  "high" | "medium" | "low" }
```

`Fix` application is specified in §8.

## 6. Raw envelope

```json
{ "exit_code":       <int>,
  "stdout_tail_sha": "sha256:..." | null,
  "stderr_tail_sha": "sha256:..." | null,
  "bytes_stdout":    <int>,
  "bytes_stderr":    <int> }
```

Raw blobs are stored by their SHA-256 in
`<cwd>/.skar/raw/sha256/<first-hex-byte>/<full>`. Retrieval is out of band
(`skar raw <receipt_id> stdout | stderr`).

Implementations MUST store at least the tail bytes. Config MAY set
`raw: { stdout_bytes: "full" | "tail" | "none" }` per-op or globally; when
`none`, `stdout_tail_sha` MUST be null.

## 7. `input_hash` canonicalization

`input_hash` is SHA-256 over a deterministic byte sequence. The sequence is
op-specific.

### 7.1 Check and Test

```
for each source file f (sorted by POSIX path, byte-lex):
  write f.path + "\0" + sha256(f.contents) + "\n"
write "config:" + sha256(substrate config file contents) + "\n"
write "normalizer:" + normalizer.name + "@" + normalizer.version + "\n"
write "argv:" + JSON.stringify(argv) + "\n"
```

Line endings in source files are not normalized. Binary files are hashed
byte-for-byte. Symlinks are hashed by target path, not dereferenced.

### 7.2 Edit

`input_hash = pre_hash`. `output_hash = post_hash`.

### 7.3 Refactor

Source-file hash set as in 7.1, plus the refactor kind and target name.

### 7.4 Deploy

`input_hash = sha256(built_artifact_bytes)`. When the artifact is a
directory, hash the canonical tar of its contents (POSIX tar, mtime=0,
uid=0, gid=0, mode=0644 files / 0755 dirs, owner="", group="").

### 7.5 Native ops

`input_hash` MAY be null when no meaningful input exists.

## 8. Fix application semantics

Implementations applying Fixes MUST follow these rules:

1. **Intra-file ordering.** When multiple Fixes apply to the same file,
   apply from highest `line`/`col` to lowest. This prevents earlier edits
   from invalidating later spans.

2. **Overlapping Fixes.** If two Fixes have overlapping spans, apply only
   the one that appears first in the `errors` array. Emit a `harness`
   Receipt with code `SKR-FIX-OVERLAP` naming the dropped Fix.

3. **Atomicity.** A single application pass across one or more files MUST
   be atomic: either all writes succeed or none. Implementations MUST use
   stage-and-rename or equivalent.

4. **Confidence gating.** Implementations SHOULD expose a policy knob with
   default `apply_on: "high"`. Medium and low confidence Fixes are shown
   to the agent but not auto-applied.

5. **Provenance.** Each applied Fix produces a new `edit` Receipt whose
   `parent` points at the `check` Receipt that emitted the Fix.

## 9. Concurrency

Implementations MUST use an advisory lock at `<cwd>/.skar/journal.lock`
to serialize appends. Readers MUST NOT acquire the lock. Append operations
MUST write a complete Receipt line in a single `write(2)` syscall under
the lock, and MUST fsync before releasing.

Shared-filesystem Journals (same path, two hostnames) are not supported in
v1. Implementations MUST detect and refuse.

## 10. Compaction

`skar journal compact` MAY be invoked explicitly. It MUST:

1. Preserve all Receipts newer than the configured `retain_days` (default
   30).
2. Preserve all Receipts with `op: "deploy"`, all Receipts with
   `op: "refactor"` and `dependents_broken > 0`, regardless of age.
3. Collapse older Receipts into `digest` Receipts (§4.6), one per
   (day × op) bucket.
4. Archive the pre-compaction `journal.jsonl` to
   `<cwd>/.skar/archive/journal-<ISO-date>.jsonl.zst`.

Compaction MUST NOT run automatically during an active agent session.

## 11. Versioning

Breaking changes bump the `schema` major version (`receipt/v2`).
Additive changes MUST NOT bump the version. Implementations reading an
unknown `schema` SHOULD attempt to parse fields present in v1 and
otherwise treat the Receipt as raw.

`SKR-*` codes MUST NOT be renamed once introduced in a released
spec version. New codes MAY be added in any version.

## 12. Compliance checklist

A conforming implementation:

- [ ] Writes every Receipt as a single line of valid JSON terminated by `\n`
- [ ] Populates all required envelope fields in §3
- [ ] Uses ULID for `id`
- [ ] Computes `input_hash` per §7
- [ ] Stores raw blobs per §6 and exposes retrieval
- [ ] Applies Fixes per §8
- [ ] Serializes appends per §9
- [ ] Rejects shared-filesystem Journals
- [ ] Supports `skar journal compact` per §10
- [ ] Preserves unknown envelope fields on re-emit

## Appendix A. ABNF for the Journal file

```
journal  = *(receipt LF)
receipt  = "{" *json-content "}"
LF       = %x0A
```

## Appendix B. Canonical example

See `spec/examples/` for round-tripped Receipts illustrating each op
kind. (Not yet populated.)
