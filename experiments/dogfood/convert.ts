// Throwaway converter: Claude Code session JSONL -> Skar trace JSON.
// Usage: bun run experiments/dogfood/convert.ts <session.jsonl> <out.json>
//
// Not for production. The real capture story belongs in src/ once we know
// what shape it should take.

import { readFileSync, writeFileSync } from "node:fs";

import { parseTrace } from "../../src/trace/parser.js";

type AssistantContent =
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: string; [key: string]: unknown };

type UserContent =
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown };

interface SessionEvent {
  type: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: string | AssistantContent[] | UserContent[];
  };
}

function readJsonl(path: string): SessionEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SessionEvent);
}

function asJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error("Usage: bun run experiments/dogfood/convert.ts <session.jsonl> <out.json>");
    process.exit(1);
  }

  const events = readJsonl(inPath).filter((e) => !e.isSidechain);

  let prompt: string | null = null;
  for (const e of events) {
    if (e.type === "user" && typeof e.message?.content === "string") {
      prompt = e.message.content;
      break;
    }
  }
  if (!prompt) throw new Error("No initial user prompt found");

  const toolUses = new Map<string, { name: string; input: unknown; order: number }>();
  const toolResults = new Map<string, unknown>();
  let order = 0;
  let lastAssistantText: string | null = null;

  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const block of e.message.content as AssistantContent[]) {
        if (block.type === "tool_use") {
          toolUses.set(block.id, { name: block.name, input: block.input, order: order++ });
        } else if (block.type === "text" && typeof block.text === "string") {
          lastAssistantText = block.text;
        }
      }
    } else if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const block of e.message.content as UserContent[]) {
        if (block.type === "tool_result") {
          toolResults.set(block.tool_use_id, block.content ?? null);
        }
      }
    }
  }

  const ordered = Array.from(toolUses.entries()).sort((a, b) => a[1].order - b[1].order);

  const traceEvents = ordered.map(([id, { name, input }]) => ({
    type: "tool_call" as const,
    tool_name: name,
    arguments: asJsonValue(input),
    result: asJsonValue(toolResults.get(id) ?? null),
  }));

  const trace = {
    schema_version: "0.1" as const,
    input: { prompt },
    events: traceEvents,
    final: {
      status: "success",
      ...(lastAssistantText ? { output_text: lastAssistantText } : {}),
    },
  };

  // Validate using the project's own schema before writing.
  parseTrace(trace, inPath);

  writeFileSync(outPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath} with ${traceEvents.length} tool_call events`);
}

main();
