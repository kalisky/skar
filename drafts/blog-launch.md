# Turning a bad agent run into a committed regression test

A few months ago I started shipping a custom agent — a Python loop
around the Anthropic Messages API that picks tools, dispatches them,
parses results, and decides when to stop. Standard stuff. The kind
of code anyone writing agent infrastructure ends up with.

It broke, of course. Not a stack trace — a *behavioral* break.
Wrong tool, wrong order, plausible-looking final answer. I had the
trace. I had a clear "this exact failure should never happen again"
instinct. What I didn't have was a good way to turn that instinct
into a test that lives next to the agent code and runs in CI.

What was on offer:

- **Observability tools** were great at letting me *look* at the
  trace. They had no answer to "now lock it as a regression."
- **Eval platforms** wanted me to upload my traces to their cloud,
  define datasets, run jobs. Heavy, hosted, and aimed at "evaluate
  the model" rather than "regression-test my code that wraps the
  model."
- **Hand-writing the test** was tractable but slow, and the parts
  of the trace that mattered (tool sequence, tool arguments, final
  outcome class) were tedious to type out from JSON into Python.

I wanted: trace JSON in, readable pytest file out, committed to my
repo, runnable locally, no SaaS in the loop. So I built that. It's
called Skar.

## What it does, concretely

Skar is one verb: convert a captured trace into a regression test.

```bash
skar generate \
  --from-trace traces/bad_run.json \
  --out tests/test_bad_run.py
```

The output is plain Python. No DSL, no magic — a pytest file you
can read, edit, and `git add`. The trace is embedded verbatim at
the top so anyone reviewing the test can see what the agent
actually did. The assertions check three things by default:

- The agent called the same tools in the same order.
- Each tool was called with the same arguments (after
  normalizing volatile bits — UUIDs, temp dirs, home dirs,
  timestamps).
- The final outcome class (`success` / `failure`) matches.

There's a small adapter contract the user implements — a function
that runs *the real agent code* against scripted tool responses
from the trace. The agent's parsing, loop control, message
construction, and final-text extraction all execute under the
test. Only the LLM call and the tool implementations are stubbed
from the captured run.

That's it. That's the product.

## What this actually catches

A worked example lives at
[`examples/anthropic-sdk-mini-agent/`](https://github.com/kalisky/skar/tree/main/examples/anthropic-sdk-mini-agent):
~100 lines of real agent code, one captured trace, one generated
test, runnable with `pytest`. Inject a real bug into `agent.py` —
say, exit the tool-use loop one turn early — and the test fails
with a readable diff:

```
AssertionError: tool sequence mismatch
  expected: ['lookup_order', 'process_refund']
  observed: ['lookup_order']
```

Restore the code, the test goes green.

It catches loop-control bugs, message-construction regressions,
tool-dispatch errors, final-text extraction bugs, and silent
argument drift in the places the volatility patterns don't cover.

## What it doesn't catch

Being explicit about scope is half the value of a narrow tool.
The generated test does **not** catch:

- **LLM behavior changes.** Claude is scripted from the trace.
  Model upgrades, prompt edits, or temperature tweaks won't ring
  this bell.
- **Tool implementation regressions.** Tool *results* are
  replayed from the trace. If the real `lookup_order` quietly
  starts returning the wrong shape, this test won't notice. Tool
  implementations should have their own unit tests.
- **System prompt regressions.** If your prompt change makes the
  real agent pick a different tool sequence in production, the
  scripted-Claude test in CI won't see it.

To catch live LLM / prompt / tool drift, you want a separate
test that actually invokes the API against a fixed scenario.
That test has different cost, flakiness, and CI implications.
Skar's snapshot-of-decisions test and your live-API test are
complementary, not substitutes.

## The interesting design constraint

The thing I didn't expect was how much of Skar's surface area got
shaped by *one* problem: captured traces are full of values that
will be different on the next run.

The first dogfood pass — a real Claude Code session captured from
a project of mine — had a one-shot temp UUID embedded in seven of
nine `Bash` commands' working directories. A naive regression
test asserting exact argument equality would have passed on
replay and **failed on every subsequent run.** That's the
dominant flakiness mode for any trace-derived test, and it would
have killed adoption immediately.

So Skar grew a small drift-tolerance layer: a `_VOLATILE_PATTERNS`
list emitted into every generated test, normalizing UUIDs, temp
dirs, home directories, and timestamps to placeholder tokens
before comparison. The patterns are hand-editable. The list is
short on purpose — I chose only patterns that were *universally*
volatile, not "probably regression-relevant" ones like git SHAs.

Every subsequent dogfood pass either confirmed an existing
pattern or surfaced a new failure mode that drove a specific
addition:

- A `Bash.cwd` of `/var/folders/.../T/pytest-of-alice-7` —
  *almost* temp-shaped but one path component short, regex
  doesn't match. → `--ignore-field Bash.cwd` for per-field
  drift the patterns can't catch.
- A predicted (not yet observed) failure mode: real LLM agents
  reordering independent tool calls between runs. →
  `--match-mode multiset` for "same calls, any order."
- The HTML summary report leaking redacted-shaped tokens because
  it received the un-redacted trace. → Single point of
  redaction, fed to every output.

The full evidence trail is in
[`docs/dogfood-findings.md`](https://github.com/kalisky/skar/blob/main/docs/dogfood-findings.md).
The point isn't that the matcher is clever. The point is that
every loosening is documented against a specific observed (or in
one case predicted-and-then-engineered) failure, so future-me
can't quietly add a fifth pattern based on taste.

## Who this is for

Skar is for teams **writing the code that wraps an LLM into a
tool-using agent.** If you ship a custom agent — LangChain,
LlamaIndex, Anthropic SDK direct, a Java service calling Claude,
AutoGen — and you've ever wanted to lock a specific run as a
regression test, this is for you.

Skar is **not** for engineers using Claude Code or Cursor to
write non-agent code. Those tools *are* the agent — you don't
own their internals, so there's nothing for Skar to regression-
test. Skar will happily capture and visualize those sessions
(the HTML report works for any trace), but the headline value
only lights up when you control the agent's code.

## Try it in 30 seconds

The fastest way to see the loop end-to-end is the worked example
in the repo. From a clean checkout:

```bash
git clone https://github.com/kalisky/skar
cd skar/examples/anthropic-sdk-mini-agent
pip install -r requirements.txt
PYTHONPATH=. pytest tests/
```

You should see `1 passed`. The test that just ran was generated
from a captured trace at `traces/refund_eligible.json` — open
`tests/test_refund_eligible.py` and you'll see the trace
embedded near the top, then a small set of assertions. Inject a
bug into `agent.py` (change `if response.stop_reason != "tool_use":`
to `if True:`) and re-run pytest to watch it fail with a
readable diff.

For your own agent, two halves, two packages:

```bash
# CLI + MCP server (npm)
npm install -g @kalisky/skar
claude mcp add skar -- skar-mcp

# Python runtime — Recorder for capturing your custom agent (PyPI)
pip install skar
```

The MCP server gives an agent like Claude Code direct access to
four tools: `capture_claude_code_session`,
`generate_pytest_regression`, `validate_trace`, `inspect_trace`.
The Python `Recorder` is what you wire into your own agent code
to produce the trace in the first place.

Repo: [github.com/kalisky/skar](https://github.com/kalisky/skar).
MIT-licensed.

## Where this goes next

The next investment is intentionally not "more matcher
features." The matcher is good enough to be embarrassed by, and
the dogfood evidence trail is long enough that the next round of
real signal has to come from outside my own machine. If you're
building a custom agent and have a recent bad run you'd like to
lock as a test, I'd love to watch you try Skar on it and see
what hurts.
