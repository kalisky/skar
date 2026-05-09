import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runGenerate } from "../../src/cli/generate.js";

test("runGenerate supports a custom test name override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skar-generate-"));
  const outPath = path.join(tempDir, "case.py");

  await runGenerate("tests/fixtures/trace_refund.json", outPath, {
    testName: "custom_refund_case",
  });

  const generated = await readFile(outPath, "utf8");
  assert.match(generated, /def test_custom_refund_case\(\):/);
});
