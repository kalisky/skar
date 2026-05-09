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

test("generatePytestCase redacts secret-shaped strings before rendering", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "use my API key sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa to call" },
    events: [
      {
        type: "tool_call" as const,
        tool_name: "Bash",
        arguments: {
          command: "curl -H 'Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' https://api.example.com",
        },
        result: "AKIAIOSFODNN7EXAMPLE configured\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
      },
    ],
    final: { status: "success", output_text: "ok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" },
  };

  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)));

  assert.equal(/sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa/.test(generated), false, "Anthropic key leaked");
  assert.equal(/ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345/.test(generated), false, "GitHub token leaked");
  assert.equal(/AKIAIOSFODNN7EXAMPLE/.test(generated), false, "AWS key leaked");
  assert.equal(/BEGIN RSA PRIVATE KEY/.test(generated), false, "PEM block leaked");
  assert.equal(/eyJhbGciOiJIUzI1NiJ9\.eyJzdWIiOiIxMjM0NTY3ODkwIn0/.test(generated), false, "JWT leaked");
  assert.match(generated, /<REDACTED>/);
});
