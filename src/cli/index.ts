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

  throw new Error(`Unknown command: ${command}`);
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
`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
