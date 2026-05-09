import { type JsonValue } from "../trace/schema.js";
import { type NormalizedTrace } from "../trace/normalizer.js";

export function generatePytestCase(trace: NormalizedTrace, testName?: string): string {
  const resolvedTestName = sanitizeTestName(testName ?? defaultTestName(trace.prompt));
  const toolSequence = trace.toolCalls.map((event) => event.toolName);
  const renderedTrace = renderPython(trace);
  const renderedToolSequence = indentMultiline(renderPython(toolSequence), 4);

  return `from __future__ import annotations

import re

from skar_adapter import run_agent_under_test


# Skar normalizes a few volatile substrings before comparing tool arguments
# and output text, so a re-run of the agent does not fail this test for
# unrelated reasons (a different temp directory, a fresh UUID, a new
# timestamp). Edit this list to add or remove patterns for your project.
_VOLATILE_PATTERNS = [
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


TRACE = ${renderedTrace}


def test_${resolvedTestName}():
    result = run_agent_under_test(
        prompt=TRACE["prompt"],
        mocked_tool_calls=TRACE["toolCalls"],
    )

    assert [call["tool_name"] for call in result["tool_calls"]] == ${renderedToolSequence}

    observed_args = [_normalize(call["arguments"]) for call in result["tool_calls"]]
    expected_args = [_normalize(call["arguments"]) for call in TRACE["toolCalls"]]
    assert observed_args == expected_args

    assert result["status"] == ${renderPython(trace.final.status)}
${renderOutputAssertion(trace)}
`.trimEnd() + "\n";
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
