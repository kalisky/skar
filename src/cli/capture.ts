import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { captureClaudeCodeSession } from "../capture/claude_code.js";

interface CaptureClaudeCodeOptions {
  cwd?: string;
  sessionPath?: string;
  lastN?: number;
  fromIndex?: number;
  toIndex?: number;
  outPath?: string;
  allowExternalPath?: boolean;
}

export async function runCaptureClaudeCode(opts: CaptureClaudeCodeOptions): Promise<void> {
  const result = await captureClaudeCodeSession({
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.sessionPath !== undefined ? { sessionPath: opts.sessionPath } : {}),
    ...(opts.lastN !== undefined ? { lastNToolCalls: opts.lastN } : {}),
    ...(opts.fromIndex !== undefined ? { fromToolCallIndex: opts.fromIndex } : {}),
    ...(opts.toIndex !== undefined ? { toToolCallIndex: opts.toIndex } : {}),
    ...(opts.allowExternalPath !== undefined ? { allowExternalPath: opts.allowExternalPath } : {}),
  });

  const traceJson = `${JSON.stringify(result.trace, null, 2)}\n`;
  const totalRedactions = Object.values(result.redactionCounts).reduce((acc, n) => acc + n, 0);

  if (opts.outPath) {
    await mkdir(path.dirname(path.resolve(opts.outPath)), { recursive: true });
    await writeFile(opts.outPath, traceJson, "utf8");
    process.stdout.write(
      `Captured ${result.toolCallCount} tool_call event(s)` +
        (result.toolCallCount !== result.totalToolCalls
          ? ` (sliced from ${result.totalToolCalls})`
          : "") +
        ` from ${result.sessionPath}\n`,
    );
    if (totalRedactions > 0) {
      process.stdout.write(`Redacted ${totalRedactions} secret-shaped value(s) before writing.\n`);
    }
    process.stdout.write(`Wrote trace JSON: ${opts.outPath}\n`);
  } else {
    process.stdout.write(traceJson);
  }
}
