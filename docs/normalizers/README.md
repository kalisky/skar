# Normalizer contract

A normalizer turns one tool's raw output into a Receipt's op-specific
payload. Anyone who wants Skar to understand a new tool — `cargo test`,
`mypy`, `vercel deploy`, anything — writes one of these. This is the
extension surface; everything else in Skar is downstream of it.

## Interface

```typescript
export interface Normalizer {
  /** Stable machine name. Appears in Receipt.tool. e.g. "tsc", "pytest-json". */
  readonly name: string

  /** Semver. Bumped on any behavior change that alters output. */
  readonly version: string

  /** The op kind this normalizer produces. One normalizer = one op kind. */
  readonly op: OpKind

  /** Optional: declare tool versions this normalizer has been validated against. */
  readonly validated_tool_versions?: readonly string[]

  /** Decide whether this normalizer handles the given command. Must be fast. */
  matches(input: NormalizerInput): boolean

  /** Produce the op-specific payload. May throw; see failure modes below. */
  normalize(input: NormalizerInput): NormalizedPayload
}

export interface NormalizerInput {
  readonly argv: readonly string[]
  readonly stdout: string
  readonly stderr: string
  readonly exit_code: number
  readonly cwd: string
  readonly started_at: string          // ISO 8601
  readonly ended_at: string
  readonly env_fingerprint: string     // hash of env vars the tool is sensitive to
}

export interface NormalizedPayload {
  readonly ok: boolean
  readonly data: OpData                // op-specific schema; see spec/receipt-v1.md §4
  readonly derived_input_hash?: string // optional; harness computes otherwise
  readonly notes?: readonly string[]   // free-form, for debugging
}
```

One normalizer produces one op kind. A tool that yields both `check` and
`test` outputs (e.g. `cargo test`) is two normalizers — one for each
`argv` shape.

## Discovery and ordering

- Built-in normalizers live in `src/normalizer/builtin/`.
- Project-local normalizers live in `.skar/normalizers/*.{js,ts,py}` and
  are loaded at startup.
- `skar.yaml` may pin `normalizers.order: [tsc, pytest, raw]`. First match
  wins.
- The `raw` normalizer is always last and always matches. It guarantees
  every command produces some Receipt.

## Failure modes (authoritative)

| Condition | Harness behavior | Receipt emitted |
|---|---|---|
| `matches()` throws | Skip this normalizer, try next | `SKR-NORM-MATCH-FAIL` warning |
| `normalize()` throws | Fall through to `raw` normalizer | `SKR-NORM-FAIL` + the raw receipt |
| `normalize()` returns schema-invalid | Treat as throw | `SKR-NORM-INVALID` + raw |
| `normalize()` exceeds 5s | Kill, use `raw` | `SKR-NORM-TIMEOUT` + raw |
| `normalize()` returns with `derived_input_hash` that doesn't match harness-computed | Accept (normalizer wins), log anomaly | `SKR-NORM-HASH-MISMATCH` info |

The `SKR-NORM-*` codes are warning/info Receipts with `op: "harness"` —
they never replace the primary Receipt, only accompany it.

## Testing contract

Every normalizer ships with `fixtures/<case>/`:
- `in.json` — a frozen `NormalizerInput` (timestamps set to fixed values)
- `out.json` — the expected `NormalizedPayload`
- `README.md` — one line describing what the case covers

Required cases, at minimum:
- `happy-path/` — tool succeeds, zero issues
- `typical-error/` — tool's most common error category
- `empty/` — tool ran, produced no output
- `malformed/` — tool output doesn't parse (e.g., truncated stdout); the
  normalizer must still produce a valid payload or explicitly throw

The CLI `skar test-normalizer <name>` runs all fixtures and fails on any
diff from `out.json`. Golden updates require `--update --reason "<why>"`;
the reason is stored in the fixture metadata and reviewed in PR.

## PR checklist for a new normalizer

- [ ] Implements `Normalizer` interface
- [ ] `name` is unique across built-ins and plugins
- [ ] `version` is set; changelog entry added
- [ ] Fixtures: happy-path, typical-error, empty, malformed
- [ ] `validated_tool_versions` reflects reality (tested manually)
- [ ] `skar test-normalizer <name>` passes in CI
- [ ] Documented in `docs/normalizers/<name>.md` with: tool link, argv
      shapes recognized, codes emitted, limitations
- [ ] Benchmark suite unaffected or improved (no silent regressions)

Adding a normalizer is small, additive, and mechanical. That's the whole
point of the surface.
