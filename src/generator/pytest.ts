import { type JsonValue } from "../trace/schema.js";
import { type NormalizedTrace } from "../trace/normalizer.js";

export function generatePytestCase(trace: NormalizedTrace, testName?: string): string {
  const resolvedTestName = sanitizeTestName(testName ?? defaultTestName(trace.prompt));
  const toolSequence = trace.toolCalls.map((event) => event.toolName);
  const toolArgs = trace.toolCalls.map((event) => event.arguments);
  const renderedTrace = renderPython(trace);
  const renderedToolSequence = indentMultiline(renderPython(toolSequence), 4);
  const renderedToolArgs = indentMultiline(renderPython(toolArgs), 4);

  return `from __future__ import annotations

from skar_adapter import run_agent_under_test


TRACE = ${renderedTrace}


def test_${resolvedTestName}():
    result = run_agent_under_test(
        prompt=TRACE["prompt"],
        mocked_tool_calls=TRACE["toolCalls"],
    )

    assert [call["tool_name"] for call in result["tool_calls"]] == ${renderedToolSequence}
    assert [call["arguments"] for call in result["tool_calls"]] == ${renderedToolArgs}
    assert result["status"] == ${renderPython(trace.final.status)}
${renderOutputAssertion(trace)}
`.trimEnd() + "\n";
}

function renderOutputAssertion(trace: NormalizedTrace): string {
  if (!trace.final.output_text) {
    return "";
  }

  return `    assert ${renderPython(trace.final.output_text)} in result.get("output_text", "")\n`;
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
