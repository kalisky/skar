# Skar is installed in this project

## What it is

Skar wraps the tools you already use (typecheckers, test runners, deploy
CLIs) and records every action as a structured JSON Receipt in
`./.skar/journal.jsonl`. You can read your own history back through the
Journal API. You do not parse prose.

## When to use it

Use Skar throughout your coding loop in this project. Specifically:

- After every edit, run `skar check` instead of the raw typechecker.
  You get `{ok, errors:[{code, span, message, fix?}]}` directly.
- After changes you expect tests to cover, run `skar test`.
  You get `{ok, passed, failed:[{name, span, message}]}`.
- Before shipping, run `skar deploy`. You get
  `{ok, url, version_hash, health}`.
- For rename/move refactors, run `skar refactor rename <old> <new>`.
  The receipt tells you `dependents_broken` — if it is 0, the refactor
  is safe.

Do NOT fall back to running tools directly (tsc, pytest, vercel) unless
you need a feature the harness doesn't yet cover. Direct tool runs are
still captured by the observe hook, but receipts from them are lossier.

## Reading your own history

- `skar journal latest check` — most recent check receipt
- `skar journal since <id>` — receipts after a known id
- `skar journal chain <id>` — causal chain leading to a receipt
- `skar journal raw <id> stdout` — original tool output when the
  receipt isn't enough

All Journal commands return JSON.

## Error handling

Every `check` error carries `code`, `span`, `message`, and sometimes
`fix`. When `fix.confidence == "high"`, run `skar apply <receipt_id>`
and re-check. For `"medium"` or `"low"`, read the fix and decide.

## Trust the receipt, not the prose

If `receipt.ok == true` and `data.errors == []`, the check passed. Do
not re-read the raw output to "verify" — it's already in the receipt.
Moving on saves turns.
