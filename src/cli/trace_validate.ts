import { parseTraceFile } from "../trace/parser.js";

export async function runTraceValidate(path: string): Promise<void> {
  await parseTraceFile(path);
  process.stdout.write(`Trace is valid: ${path}\n`);
}
