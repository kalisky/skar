import { parseTraceFile } from "../trace/parser.js";
import { normalizeTrace } from "../trace/normalizer.js";

export async function runTraceInspect(path: string): Promise<void> {
  const trace = await parseTraceFile(path);
  const normalized = normalizeTrace(trace);

  const summary = [
    `schema_version: ${normalized.schemaVersion}`,
    `prompt: ${normalized.prompt}`,
    `tool_calls: ${normalized.toolCalls.length}`,
    `final_status: ${normalized.final.status}`,
  ].join("\n");

  process.stdout.write(`${summary}\n\n`);
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
}
