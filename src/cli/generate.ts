import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generatePytestCase } from "../generator/pytest.js";
import { parseTraceFile } from "../trace/parser.js";
import { normalizeTrace } from "../trace/normalizer.js";

export async function runGenerate(
  tracePath: string,
  outPath: string,
  options?: { testName?: string },
): Promise<void> {
  const trace = await parseTraceFile(tracePath);
  const normalized = normalizeTrace(trace);
  const generated = generatePytestCase(normalized, options?.testName);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, generated, "utf8");
  process.stdout.write(`Generated pytest file at ${outPath}\n`);
}
