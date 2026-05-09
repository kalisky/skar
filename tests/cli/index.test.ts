import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../src/cli/index.js";

test("main prints help text for --help", async () => {
  const { stdout, stderr, exitCode } = await captureCliOutput(["--help"]);

  assert.match(stdout, /Usage:/);
  assert.equal(stderr, "");
  assert.equal(exitCode, 0);
});

test("main validates a trace through the CLI", async () => {
  const { stdout, stderr, exitCode } = await captureCliOutput([
    "trace",
    "validate",
    "tests/fixtures/trace_refund.json",
  ]);

  assert.match(stdout, /Trace is valid:/);
  assert.equal(stderr, "");
  assert.equal(exitCode, 0);
});

test("main reports unknown commands to stderr", async () => {
  const { stdout, stderr, exitCode } = await captureCliOutput(["unknown"]);

  assert.equal(stdout, "");
  assert.match(stderr, /Unknown command: unknown/);
  assert.equal(exitCode, 1);
});

async function captureCliOutput(argv: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  let stdout = "";
  let stderr = "";
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;

  process.exitCode = 0;

  try {
    await main(argv);
    return { stdout, stderr, exitCode: process.exitCode ?? 0 };
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
}
