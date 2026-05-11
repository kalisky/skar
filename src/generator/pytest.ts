import { type JsonValue } from "../trace/schema.js";
import { type NormalizedTrace } from "../trace/normalizer.js";
import {
  DEFAULT_REDACTION_RULES,
  REDACTED_PLACEHOLDER,
  compileExtraRules,
  redactJsonWithCounts,
  redactStringWithCounts,
  type RedactionCounts,
  type RedactionRule,
} from "../redact/secrets.js";

export type MatchMode = "strict" | "multiset";

export interface GenerateOptions {
  testName?: string;
  extraRedactPatterns?: string[];
  note?: string;
  matchMode?: MatchMode;
  ignoreFields?: string[];
}

export interface GenerateResult {
  source: string;
  redactionCounts: RedactionCounts;
  rulesApplied: RedactionRule[];
  redactedTrace: NormalizedTrace;
}

export function generatePytestCase(
  trace: NormalizedTrace,
  options: string | GenerateOptions = {},
): string {
  return generatePytestCaseDetailed(trace, options).source;
}

export function generatePytestCaseDetailed(
  trace: NormalizedTrace,
  options: string | GenerateOptions = {},
): GenerateResult {
  const opts: GenerateOptions =
    typeof options === "string" ? { testName: options } : options;

  const extraRules = compileExtraRules(opts.extraRedactPatterns ?? []);
  const rules: RedactionRule[] = [...extraRules, ...DEFAULT_REDACTION_RULES];

  const { trace: safeTrace, counts } = redactTraceWithCounts(trace, rules);

  const resolvedTestName = sanitizeTestName(opts.testName ?? defaultTestName(safeTrace.prompt));
  const matchMode: MatchMode = opts.matchMode ?? "strict";
  const ignoreFields = validateIgnoreFields(opts.ignoreFields ?? []);
  const toolSequence = safeTrace.toolCalls.map((event) => event.toolName);
  const renderedTrace = renderPython(safeTrace);
  const renderedToolSequence = indentMultiline(renderPython(toolSequence), 4);
  const renderedExtras = renderExtraVolatilePatterns(extraRules);
  const renderedNote = renderNote(opts.note);
  const extraImports = matchMode === "multiset" ? "\nimport json\nfrom collections import Counter\n" : "";
  const renderedIgnoreFields = renderIgnoreFields(ignoreFields);
  const renderedAssertions = renderToolCallAssertions(matchMode, renderedToolSequence);

  const source = `from __future__ import annotations

import re
${extraImports}
from skar_adapter import run_agent_under_test


${renderedNote}# Skar normalizes a few volatile substrings before comparing tool arguments
# and output text, so a re-run of the agent does not fail this test for
# unrelated reasons (different temp dir, fresh UUID, new timestamp), and
# any secret that slips into a real run is collapsed to <REDACTED> before
# comparison instead of leaking into the test failure message.
# Edit this list to add or remove patterns for your project.
_VOLATILE_PATTERNS = [
${renderedExtras}    # --- Common secret shapes (kept first so they win on overlap). ---
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "<REDACTED>"),
    (re.compile(r"eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"), "<REDACTED>"),
    (re.compile(r"Bearer\\s+[A-Za-z0-9._~+/=-]{20,}"), "<REDACTED>"),
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "<REDACTED>"),
    (re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{32,}"), "<REDACTED>"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "<REDACTED>"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "<REDACTED>"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "<REDACTED>"),
    # --- Drift normalization. ---
    # 36-character UUIDs (session ids, request ids, run ids).
    (re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"), "<UUID>"),
    # macOS per-user temp directory.
    (re.compile(r"/(?:private/)?var/folders/[^/]+/[^/]+/T(?=/|$)"), "<TEMP>"),
    # Linux temp directories.
    (re.compile(r"/var/tmp(?=/|$)"), "<TEMP>"),
    (re.compile(r"/tmp(?=/|$)"), "<TEMP>"),
    # Windows temp directories (backslash and forward-slash forms).
    (re.compile(r"[A-Za-z]:\\\\Users\\\\[^\\\\]+\\\\AppData\\\\Local\\\\Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:\\\\Windows\\\\Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:/Users/[^/]+/AppData/Local/Temp", re.IGNORECASE), "<TEMP>"),
    (re.compile(r"[A-Za-z]:/Windows/Temp", re.IGNORECASE), "<TEMP>"),
    # User home directories — Windows variants first so forward-slash
    # \"C:/Users/...\" is not partially eaten by the macOS \"/Users/...\" rule.
    (re.compile(r"[A-Za-z]:/Users/[^/\\s\\\"']+"), "<HOME>"),
    (re.compile(r"[A-Za-z]:\\\\Users\\\\[^\\\\]+"), "<HOME>"),
    (re.compile(r"/Users/[^/\\s\\\"']+"), "<HOME>"),
    (re.compile(r"/home/[^/\\s\\\"']+"), "<HOME>"),
    # ISO-8601 timestamps and bare dates.
    (re.compile(r"\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})?"), "<TIMESTAMP>"),
    (re.compile(r"\\d{4}-\\d{2}-\\d{2}(?!T\\d)"), "<DATE>"),
]


def _normalize(value):
    if isinstance(value, str):
        out = value
        for pattern, replacement in _VOLATILE_PATTERNS:
            out = pattern.sub(replacement, out)
        return out
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize(child) for key, child in value.items()}
    return value


${renderedIgnoreFields}TRACE = ${renderedTrace}


def test_${resolvedTestName}():
    result = run_agent_under_test(
        prompt=TRACE["prompt"],
        mocked_tool_calls=TRACE["toolCalls"],
    )

${renderedAssertions}
    assert result["status"] == ${renderPython(safeTrace.final.status)}
${renderOutputAssertion(safeTrace)}
`.trimEnd() + "\n";

  return { source, redactionCounts: counts, rulesApplied: rules, redactedTrace: safeTrace };
}

function redactTraceWithCounts(
  trace: NormalizedTrace,
  rules: RedactionRule[],
): { trace: NormalizedTrace; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  const promptRedacted = redactStringWithCounts(trace.prompt, rules, counts);
  const safeToolCalls = trace.toolCalls.map((call) => ({
    toolName: call.toolName,
    arguments: redactJsonInline(call.arguments, rules, counts),
    result: redactJsonInline(call.result, rules, counts),
  }));
  const outputText = trace.final.output_text
    ? redactStringWithCounts(trace.final.output_text, rules, counts)
    : undefined;
  return {
    trace: {
      schemaVersion: trace.schemaVersion,
      prompt: promptRedacted,
      toolCalls: safeToolCalls,
      final: {
        status: trace.final.status,
        ...(outputText ? { output_text: outputText } : {}),
      },
    },
    counts,
  };
}

function redactJsonInline(
  value: JsonValue,
  rules: RedactionRule[],
  counts: RedactionCounts,
): JsonValue {
  const { value: redacted, counts: nested } = redactJsonWithCounts(value, rules);
  for (const [k, v] of Object.entries(nested)) {
    counts[k] = (counts[k] ?? 0) + v;
  }
  return redacted;
}

function validateIgnoreFields(paths: string[]): string[] {
  const valid = /^[A-Za-z_*][A-Za-z0-9_*]*(\.[A-Za-z_*][A-Za-z0-9_*]*)*$/;
  for (const p of paths) {
    if (!valid.test(p)) {
      throw new Error(
        `ignore_fields[${paths.indexOf(p)}] is not a valid path: ${JSON.stringify(p)}. ` +
          "Expected format: 'tool_name.field' or '*.field' (nested OK: 'tool.env.PATH').",
      );
    }
  }
  return [...paths];
}

function renderIgnoreFields(paths: string[]): string {
  // Always emit the helpers so the generated test composes cleanly with
  // _normalize whether or not the user passed any paths. Empty list means
  // _strip_ignored is a no-op for every tool.
  const renderedList = paths.length === 0
    ? "[]"
    : `[\n${paths.map((p) => `    ${JSON.stringify(p)},`).join("\n")}\n]`;
  return [
    `# Field paths to drop from a tool's arguments BEFORE _normalize runs.`,
    `# Syntax: "tool_name.field" or "*.field" for any tool; nested OK ("tool.env.PATH").`,
    `# Edit this list to add or remove per-tool ignore rules.`,
    `_IGNORE_FIELDS = ${renderedList}`,
    ``,
    ``,
    `def _strip_ignored(tool_name, args):`,
    `    if not isinstance(args, dict):`,
    `        return args`,
    `    result = {key: _deep_copy_jsonable(value) for key, value in args.items()}`,
    `    for path in _IGNORE_FIELDS:`,
    `        head, *rest = path.split(".")`,
    `        if head not in (tool_name, "*"):`,
    `            continue`,
    `        _pop_path(result, rest)`,
    `    return result`,
    ``,
    ``,
    `def _pop_path(obj, parts):`,
    `    if not parts:`,
    `        return`,
    `    head, *rest = parts`,
    `    if not rest:`,
    `        if isinstance(obj, dict):`,
    `            obj.pop(head, None)`,
    `        return`,
    `    nested = obj.get(head) if isinstance(obj, dict) else None`,
    `    if isinstance(nested, dict):`,
    `        _pop_path(nested, rest)`,
    ``,
    ``,
    `def _deep_copy_jsonable(value):`,
    `    if isinstance(value, dict):`,
    `        return {k: _deep_copy_jsonable(v) for k, v in value.items()}`,
    `    if isinstance(value, list):`,
    `        return [_deep_copy_jsonable(v) for v in value]`,
    `    return value`,
    ``,
    ``,
    `def _prepare_args(tool_name, args):`,
    `    return _normalize(_strip_ignored(tool_name, args))`,
    ``,
    ``,
    ``,
  ].join("\n");
}

function renderToolCallAssertions(mode: MatchMode, renderedToolSequence: string): string {
  if (mode === "multiset") {
    return [
      "    # match_mode=multiset — agent may produce the captured tool calls",
      "    # in any order, but every (tool_name, normalized_args) pair must",
      "    # appear with the same frequency. Tolerates reorderings between",
      "    # independent tool invocations without ignoring extras or drops.",
      "    def _sig(name, args):",
      "        return (name, json.dumps(_prepare_args(name, args), sort_keys=True, default=str))",
      "",
      "    observed = Counter(_sig(c[\"tool_name\"], c[\"arguments\"]) for c in result[\"tool_calls\"])",
      "    expected = Counter(_sig(c[\"toolName\"], c[\"arguments\"]) for c in TRACE[\"toolCalls\"])",
      "    assert observed == expected",
    ].join("\n");
  }

  return [
    `    assert [call["tool_name"] for call in result["tool_calls"]] == ${renderedToolSequence}`,
    "",
    "    observed_args = [_prepare_args(call[\"tool_name\"], call[\"arguments\"]) for call in result[\"tool_calls\"]]",
    "    expected_args = [_prepare_args(call[\"toolName\"], call[\"arguments\"]) for call in TRACE[\"toolCalls\"]]",
    "    assert observed_args == expected_args",
  ].join("\n");
}

function renderExtraVolatilePatterns(extras: RedactionRule[]): string {
  if (extras.length === 0) return "";
  const lines = extras.map(
    (rule) =>
      `    (re.compile(${pythonStringLiteral(rule.pythonPattern)}), ${pythonStringLiteral(REDACTED_PLACEHOLDER)}),`,
  );
  return `    # --- User-provided extra patterns (run first so they win on overlap). ---\n${lines.join("\n")}\n`;
}

function pythonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function renderNote(note: string | undefined): string {
  if (!note || note.trim().length === 0) return "";
  const lines = note.replace(/\r\n/g, "\n").split("\n").map((line) => `# ${line}`.trimEnd());
  return `# --- Note from author ---\n${lines.join("\n")}\n# --- End note ---\n\n\n`;
}

function renderOutputAssertion(trace: NormalizedTrace): string {
  if (!trace.final.output_text) {
    return "";
  }

  return `    assert _normalize(${renderPython(trace.final.output_text)}) in _normalize(result.get("output_text", ""))\n`;
}

function defaultTestName(prompt: string): string {
  return sanitizeTestName(
    prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "generated_regression",
  );
}

function renderPython(value: JsonValue | NormalizedTrace | string[]): string {
  return renderValue(value, 0);
}

function renderValue(value: unknown, indent: number): string {
  if (value === null) {
    return "None";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const childIndent = indent + 4;
    const renderedItems = value.map((item) => `${" ".repeat(childIndent)}${renderValue(item, childIndent)}`);
    return `[\n${renderedItems.join(",\n")}\n${" ".repeat(indent)}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }

    const childIndent = indent + 4;
    const renderedEntries = entries.map(
      ([key, child]) =>
        `${" ".repeat(childIndent)}${JSON.stringify(key)}: ${renderValue(child, childIndent)}`,
    );
    return `{\n${renderedEntries.join(",\n")}\n${" ".repeat(indent)}}`;
  }

  throw new Error(`Unsupported Python render value: ${typeof value}`);
}

function indentMultiline(value: string, spaces: number): string {
  return value
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${" ".repeat(spaces)}${line}`))
    .join("\n");
}

function sanitizeTestName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "generated_regression";
}
