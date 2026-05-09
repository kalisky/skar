import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseTrace, parseTraceFile, TraceParseError } from "../../src/trace/parser.js";

const fixturesDir = path.resolve("tests/fixtures");

test("parseTraceFile loads a valid trace fixture", async () => {
  const trace = await parseTraceFile(path.join(fixturesDir, "trace_refund.json"));

  assert.equal(trace.schema_version, "0.1");
  assert.equal(trace.events.length, 2);
  assert.equal(trace.final.status, "success");
});

test("parseTrace emits readable validation errors", async () => {
  const raw = await readFile(path.join(fixturesDir, "trace_minimal.json"), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  delete parsed.final;

  assert.throws(
    () => parseTrace(parsed, "broken_trace.json"),
    (error: unknown) =>
      error instanceof TraceParseError &&
      error.message.includes("broken_trace.json") &&
      error.message.includes("final"),
  );
});
