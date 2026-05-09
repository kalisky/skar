import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { generatePytestCase } from "../../src/generator/pytest.js";
import { normalizeTrace } from "../../src/trace/normalizer.js";
import { parseTrace } from "../../src/trace/parser.js";

const fixturesDir = path.resolve("tests/fixtures");

test("generatePytestCase matches the committed refund fixture", async () => {
  const traceRaw = await readFile(path.join(fixturesDir, "trace_refund.json"), "utf8");
  const expected = await readFile(path.join(fixturesDir, "generated_refund.py"), "utf8");

  const generated = generatePytestCase(normalizeTrace(parseTrace(JSON.parse(traceRaw))));

  assert.equal(generated, expected);
});
