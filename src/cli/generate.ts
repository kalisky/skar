import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generatePytestCaseDetailed, type GenerateOptions } from "../generator/pytest.js";
import { renderHtmlReport } from "../report/html.js";
import { parseTraceFile } from "../trace/parser.js";
import { normalizeTrace } from "../trace/normalizer.js";

export interface RunGenerateOptions extends GenerateOptions {
  reportPath?: string;
}

export async function runGenerate(
  tracePath: string,
  outPath: string,
  options?: RunGenerateOptions,
): Promise<void> {
  const trace = await parseTraceFile(tracePath);
  const normalized = normalizeTrace(trace);
  const opts: GenerateOptions = {
    ...(options?.testName !== undefined ? { testName: options.testName } : {}),
    ...(options?.extraRedactPatterns !== undefined
      ? { extraRedactPatterns: options.extraRedactPatterns }
      : {}),
    ...(options?.note !== undefined ? { note: options.note } : {}),
    ...(options?.matchMode !== undefined ? { matchMode: options.matchMode } : {}),
  };
  const result = generatePytestCaseDetailed(normalized, opts);

  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, result.source, "utf8");
  process.stdout.write(`Generated pytest file at ${outPath}\n`);

  if (options?.reportPath) {
    const html = renderHtmlReport({
      trace: normalized,
      testName: opts.testName,
      testOutputPath: outPath,
      sourceTracePath: tracePath,
      redactionCounts: result.redactionCounts,
      rulesApplied: result.rulesApplied,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
      ...(opts.matchMode !== undefined ? { matchMode: opts.matchMode } : {}),
    });
    await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
    await writeFile(options.reportPath, html, "utf8");
    process.stdout.write(`Wrote HTML report at ${options.reportPath}\n`);
  }
}
