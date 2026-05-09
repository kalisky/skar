import { type FinalResult, type JsonValue, type ToolCallEvent, type Trace } from "./schema.js";

export interface NormalizedToolCall {
  toolName: string;
  arguments: JsonValue;
  result: JsonValue;
}

export interface NormalizedTrace {
  schemaVersion: string;
  prompt: string;
  toolCalls: NormalizedToolCall[];
  final: FinalResult;
}

export function normalizeTrace(trace: Trace): NormalizedTrace {
  return {
    schemaVersion: trace.schema_version,
    prompt: trace.input.prompt,
    toolCalls: trace.events.map(normalizeToolCall),
    final: {
      status: trace.final.status,
      ...(trace.final.output_text ? { output_text: trace.final.output_text } : {}),
    },
  };
}

function normalizeToolCall(event: ToolCallEvent): NormalizedToolCall {
  return {
    toolName: event.tool_name,
    arguments: sortJson(event.arguments),
    result: sortJson(event.result),
  };
}

export function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)] satisfies [string, JsonValue]);

    return Object.fromEntries(entries);
  }

  return value;
}
