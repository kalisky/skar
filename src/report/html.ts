import { type NormalizedTrace } from "../trace/normalizer.js";
import {
  DEFAULT_REDACTION_RULES,
  type RedactionCounts,
  type RedactionRule,
} from "../redact/secrets.js";

export interface ReportInput {
  trace: NormalizedTrace;
  testName?: string | undefined;
  testOutputPath?: string | undefined;
  sourceTracePath?: string | undefined;
  sessionPath?: string | undefined;
  redactionCounts: RedactionCounts;
  rulesApplied: RedactionRule[];
  totalToolCallsInSource?: number | undefined;
  note?: string | undefined;
  matchMode?: "strict" | "multiset" | undefined;
  ignoreFields?: string[] | undefined;
}

const DRIFT_SUMMARY = [
  "36-character UUIDs (session, request, run ids) — collapsed to <UUID>",
  "Per-user temp directories on macOS (/var/folders/.../T), Linux (/tmp, /var/tmp), and Windows (AppData\\Local\\Temp, Windows\\Temp) — collapsed to <TEMP>",
  "User home directories on macOS (/Users/<name>), Linux (/home/<name>), Windows (C:\\Users\\<name>) — collapsed to <HOME>",
  "ISO-8601 timestamps and bare YYYY-MM-DD dates — collapsed to <TIMESTAMP> / <DATE>",
];

export function renderHtmlReport(input: ReportInput): string {
  const totalRedactions = Object.values(input.redactionCounts).reduce(
    (acc, n) => acc + n,
    0,
  );

  const ruleByLabel = new Map(input.rulesApplied.map((rule) => [rule.label, rule]));
  for (const rule of DEFAULT_REDACTION_RULES) {
    if (!ruleByLabel.has(rule.label)) ruleByLabel.set(rule.label, rule);
  }

  const ruleRows = Object.entries(input.redactionCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => {
      const rule = ruleByLabel.get(label);
      const desc = rule ? rule.description : label;
      return `      <tr><td>${escapeHtml(desc)}</td><td class="num">${count}</td></tr>`;
    });

  const toolRows = input.trace.toolCalls.map((call, index) => {
    const argSummary = summarizeArguments(call.arguments);
    return `      <tr><td class="num">${index + 1}</td><td><code>${escapeHtml(call.toolName)}</code></td><td>${escapeHtml(argSummary)}</td></tr>`;
  });

  const slice = input.totalToolCallsInSource
    ? `${input.trace.toolCalls.length} of ${input.totalToolCallsInSource} captured`
    : `${input.trace.toolCalls.length} captured`;

  const finalAssertion = input.trace.final.output_text
    ? `<li>The final <code>output_text</code> contains <code>${escapeHtml(truncate(input.trace.final.output_text, 80))}</code> (after drift normalization).</li>`
    : "";

  const noteBlock = input.note
    ? `<section class="note"><h2>Author's note</h2><pre>${escapeHtml(input.note)}</pre></section>`
    : "";

  const generatedAt = new Date().toISOString();
  const testNameDisplay = input.testName ?? "(auto-derived from prompt)";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Skar regression report — ${escapeHtml(testNameDisplay)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin: 0 0 0.25rem; }
  h2 { margin-top: 2rem; padding-bottom: 0.25rem; border-bottom: 1px solid #ddd; }
  .meta { color: #666; font-size: 0.85em; margin-bottom: 2rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; vertical-align: top; }
  th { font-weight: 600; color: #555; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  code { background: rgba(127,127,127,0.12); padding: 0.05em 0.3em; border-radius: 3px; font-size: 0.95em; }
  pre { background: rgba(127,127,127,0.08); padding: 0.75rem 1rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
  ul, ol { padding-left: 1.4rem; }
  li { margin: 0.25rem 0; }
  .pill { display: inline-block; background: rgba(127,127,127,0.15); padding: 0.1em 0.6em; border-radius: 999px; font-size: 0.85em; margin-right: 0.4em; }
  .note pre { white-space: pre-wrap; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e6e6e6; }
    h2 { border-color: #333; }
    th, td { border-color: #2a2a2a; }
    .meta { color: #999; }
  }
</style>
</head>
<body>
<h1>Skar regression report</h1>
<p class="meta">
  Generated ${escapeHtml(generatedAt)} ·
  Test <code>${escapeHtml(testNameDisplay)}</code>${
    input.testOutputPath
      ? ` · Output <code>${escapeHtml(input.testOutputPath)}</code>`
      : ""
  }${
    input.sourceTracePath
      ? ` · Trace <code>${escapeHtml(input.sourceTracePath)}</code>`
      : ""
  }
</p>

${noteBlock}

<section>
  <h2>Captured slice</h2>
  <p><span class="pill">${escapeHtml(slice)}</span></p>
  <p>The agent began with this prompt:</p>
  <pre>${escapeHtml(truncate(input.trace.prompt, 800))}</pre>
  ${
    toolRows.length > 0
      ? `<table>
    <thead><tr><th class="num">#</th><th>Tool</th><th>Argument summary</th></tr></thead>
    <tbody>
${toolRows.join("\n")}
    </tbody>
  </table>`
      : "<p><em>No tool calls in the captured slice.</em></p>"
  }
</section>

<section>
  <h2>Redactions</h2>
  ${
    totalRedactions === 0
      ? `<p>Skar did not detect any standard secret shapes in the captured trace. The default rules cover ${DEFAULT_REDACTION_RULES.length} categories of secrets — review the trace yourself for project-specific sensitive content (internal hostnames, customer names, account numbers).</p>`
      : `<p><strong>${totalRedactions}</strong> value(s) were detected and replaced with <code>&lt;REDACTED&gt;</code> before the trace was written into the test file. The actual values are not shown here.</p>
  <table>
    <thead><tr><th>Category</th><th class="num">Count</th></tr></thead>
    <tbody>
${ruleRows.join("\n")}
    </tbody>
  </table>`
  }
</section>

<section>
  <h2>Drift tolerance</h2>
  <p>The generated test will not fail when these volatile substrings differ between captured and observed runs:</p>
  <ul>
${DRIFT_SUMMARY.map((line) => `    <li>${escapeHtml(line)}</li>`).join("\n")}
  </ul>
  <p>Edit <code>_VOLATILE_PATTERNS</code> at the top of the generated test file to add or remove patterns for your project.</p>
</section>

${renderIgnoreFieldsSection(input.ignoreFields)}

<section>
  <h2>What this test asserts</h2>
  <p>Match mode: <code>${escapeHtml(input.matchMode ?? "strict")}</code>${
    input.matchMode === "multiset"
      ? ' — captured tool calls may appear in any order on rerun, but every (tool_name, arguments) pair must appear with the same frequency.'
      : ' — captured tool calls must appear in the same order, with the same arguments.'
  }</p>
  <ul>
    ${
      input.matchMode === "multiset"
        ? `<li>The agent calls these tools (set, frequency-counted, any order): <code>${input.trace.toolCalls.map((c) => escapeHtml(c.toolName)).join(", ") || "(none)"}</code>.</li>`
        : `<li>The agent calls these tools in this order, and only these: <code>${input.trace.toolCalls.map((c) => escapeHtml(c.toolName)).join(" → ") || "(none)"}</code>.</li>`
    }
    <li>Each captured tool argument matches the observed argument (after drift and secret normalization).</li>
    <li>The agent reports a final status of <code>${escapeHtml(input.trace.final.status)}</code>.</li>
    ${finalAssertion}
  </ul>
</section>

<section>
  <h2>What you need to wire</h2>
  <p>The generated test imports <code>skar_adapter.run_agent_under_test</code>. Provide this in your project as a module that <em>mocks</em> your agent and replays captured tool calls — it should not actually invoke real tools, APIs, or shells.</p>
  <pre># skar_adapter.py
def run_agent_under_test(*, prompt, mocked_tool_calls):
    # Return a dict: tool_calls (list), status (str), output_text (optional str).
    ...</pre>
</section>

</body>
</html>
`;
}

function renderIgnoreFieldsSection(paths: string[] | undefined): string {
  if (!paths || paths.length === 0) return "";
  const items = paths
    .map((p) => `    <li><code>${escapeHtml(p)}</code></li>`)
    .join("\n");
  return `<section>
  <h2>Ignored argument fields</h2>
  <p>These argument paths are stripped from each tool call before comparison. A re-run can change their values freely without failing the test — but the rest of the tool's arguments stay strict-checked.</p>
  <ul>
${items}
  </ul>
  <p>Edit <code>_IGNORE_FIELDS</code> at the top of the generated test file to add or remove paths.</p>
</section>
`;
}

function summarizeArguments(args: unknown): string {
  if (typeof args === "string") return truncate(args, 80);
  if (typeof args === "number" || typeof args === "boolean") return String(args);
  if (args === null) return "null";
  if (Array.isArray(args)) return `[${args.length} item(s)]`;
  if (typeof args === "object") {
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const compact = entries
      .slice(0, 3)
      .map(([k, v]) => `${k}=${truncate(stringifyShort(v), 40)}`)
      .join(", ");
    return entries.length > 3 ? `${compact}, …` : compact;
  }
  return String(args);
}

function stringifyShort(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
