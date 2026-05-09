import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseTrace } from "../../src/trace/parser.js";
import { normalizeTrace } from "../../src/trace/normalizer.js";

const fixturesDir = path.resolve("tests/fixtures");

test("normalizeTrace produces a stable internal shape", async () => {
  const raw = await readFile(path.join(fixturesDir, "trace_refund.json"), "utf8");
  const normalized = normalizeTrace(parseTrace(JSON.parse(raw)));

  assert.deepEqual(normalized.toolCalls[1], {
    toolName: "refund_create",
    arguments: {
      order_id: "123",
    },
    result: {
      refund_id: "r_123",
      status: "success",
    },
  });
});
