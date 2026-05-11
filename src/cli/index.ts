#!/usr/bin/env node
import { realpathSync } from "node:fs";
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
    const fromIndexRaw = readOption(rest, "--from-index");
    const toIndexRaw = readOption(rest, "--to-index");
    const outPath = readOption(rest, "--out");
    const allowExternalPath = rest.includes("--allow-external-path");

    const lastN = parsePositiveInt(lastNRaw, "--last-n");
    const fromIndex = parseNonNegativeInt(fromIndexRaw, "--from-index");
    const toIndex = parsePositiveInt(toIndexRaw, "--to-index");

    await runCaptureClaudeCode({
      ...(cwd !== undefined ? { cwd } : {}),
      ...(sessionPath !== undefined ? { sessionPath } : {}),
      ...(lastN !== undefined ? { lastN } : {}),
      ...(fromIndex !== undefined ? { fromIndex } : {}),
      ...(toIndex !== undefined ? { toIndex } : {}),
      ...(outPath !== undefined ? { outPath } : {}),
      ...(allowExternalPath ? { allowExternalPath: true } : {}),
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

function readAllOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${name}`);
      }
      values.push(value);
      i += 1;
    }
  }
  return values;
}

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
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
  const tracePath = readOption(args, "--from-trace");
  const outPath = readOption(args, "--out");
  const testName = readOption(args, "--test-name");
  const note = readOption(args, "--note");
  const reportPath = readOption(args, "--report");
  const extraRedactPatterns = readAllOptions(args, "--redact-pattern");
  const matchModeRaw = readOption(args, "--match-mode");

  if (!tracePath || !outPath) {
    throw new Error(
      "Usage: skar generate --from-trace <trace.json> --out <test.py> [--test-name <name>] [--note <text>] [--redact-pattern <regex>]... [--match-mode strict|multiset] [--report <path>]",
    );
  }

  let matchMode: "strict" | "multiset" | undefined;
  if (matchModeRaw !== undefined) {
    if (matchModeRaw !== "strict" && matchModeRaw !== "multiset") {
      throw new Error(`--match-mode must be 'strict' or 'multiset' (got '${matchModeRaw}')`);
    }
    matchMode = matchModeRaw;
  }

  await runGenerate(tracePath, outPath, {
    ...(testName !== undefined ? { testName } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(extraRedactPatterns.length > 0 ? { extraRedactPatterns } : {}),
    ...(matchMode !== undefined ? { matchMode } : {}),
    ...(reportPath !== undefined ? { reportPath } : {}),
  });
}

function helpText(): string {
  return `Skar

Usage:
  skar trace validate <trace.json>
  skar trace inspect <trace.json>
  skar generate --from-trace <trace.json> --out <test.py>
                [--test-name <name>] [--note <text>]
                [--redact-pattern <regex>]... [--report <path>]
                [--match-mode strict|multiset]
  skar capture claude-code [--cwd <path>] [--session <path>]
                           [--last-n <n> | --from-index <n> --to-index <n>]
                           [--out <path>] [--allow-external-path]
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

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath);
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(entryPath);
  }
}
