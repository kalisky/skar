import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCaptureClaudeCode } from "./capture.js";
import { runGenerate } from "./generate.js";
import { runTraceInspect } from "./trace_inspect.js";
import { runTraceValidate } from "./trace_validate.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(helpText());
    return;
  }

  if (command === "trace") {
    await handleTrace(rest);
    return;
  }

  if (command === "generate") {
    await handleGenerate(rest);
    return;
  }

  if (command === "capture") {
    await handleCapture(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function handleCapture(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    throw new Error("Usage: skar capture claude-code [--cwd <path>] [--session <path>] [--last-n <n>] [--out <path>]");
  }

  if (subcommand === "claude-code") {
    const cwd = readOption(rest, "--cwd");
    const sessionPath = readOption(rest, "--session");
    const lastNRaw = readOption(rest, "--last-n");
    const outPath = readOption(rest, "--out");

    let lastN: number | undefined;
    if (lastNRaw !== undefined) {
      const parsed = Number.parseInt(lastNRaw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--last-n must be a positive integer");
      }
      lastN = parsed;
    }

    await runCaptureClaudeCode({
      ...(cwd !== undefined ? { cwd } : {}),
      ...(sessionPath !== undefined ? { sessionPath } : {}),
      ...(lastN !== undefined ? { lastN } : {}),
      ...(outPath !== undefined ? { outPath } : {}),
    });
    return;
  }

  throw new Error(`Unknown capture subcommand: ${subcommand}`);
}

function readOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function handleTrace(args: string[]): Promise<void> {
  const [subcommand, tracePath] = args;

  if (!subcommand || !tracePath) {
    throw new Error("Usage: skar trace <validate|inspect> <trace.json>");
  }

  if (subcommand === "validate") {
    await runTraceValidate(tracePath);
    return;
  }

  if (subcommand === "inspect") {
    await runTraceInspect(tracePath);
    return;
  }

  throw new Error(`Unknown trace subcommand: ${subcommand}`);
}

async function handleGenerate(args: string[]): Promise<void> {
  const fromTraceIndex = args.indexOf("--from-trace");
  const outIndex = args.indexOf("--out");
  const testNameIndex = args.indexOf("--test-name");

  if (fromTraceIndex === -1 || outIndex === -1) {
    throw new Error(
      "Usage: skar generate --from-trace <trace.json> --out <test.py> [--test-name <name>]",
    );
  }

  const tracePath = args[fromTraceIndex + 1];
  const outPath = args[outIndex + 1];
  const testName = testNameIndex === -1 ? undefined : args[testNameIndex + 1];

  if (!tracePath || !outPath) {
    throw new Error(
      "Usage: skar generate --from-trace <trace.json> --out <test.py> [--test-name <name>]",
    );
  }

  await runGenerate(tracePath, outPath, testName ? { testName } : undefined);
}

function helpText(): string {
  return `Skar

Usage:
  skar trace validate <trace.json>
  skar trace inspect <trace.json>
  skar generate --from-trace <trace.json> --out <test.py> [--test-name <name>]
  skar capture claude-code [--cwd <path>] [--session <path>] [--last-n <n>] [--out <path>]
`;
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(entryPath);
}
