import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  generatePytestCase,
  generatePytestCaseDetailed,
} from "../../src/generator/pytest.js";
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

test("generatePytestCase honors extra_redact_patterns and emits them into _VOLATILE_PATTERNS", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "look up customer CUST-12345 then ID-9876" },
    events: [
      {
        type: "tool_call" as const,
        tool_name: "lookup",
        arguments: { customer: "CUST-99999" },
        result: { status: "ok" },
      },
    ],
    final: { status: "success" },
  };

  const result = generatePytestCaseDetailed(normalizeTrace(parseTrace(trace)), {
    extraRedactPatterns: ["CUST-\\d+"],
    testName: "extras",
  });

  assert.equal(/CUST-12345/.test(result.source), false, "matched custom pattern leaked");
  assert.equal(/CUST-99999/.test(result.source), false, "matched custom pattern leaked");
  // The extra pattern should appear in the rendered _VOLATILE_PATTERNS list.
  assert.match(result.source, /CUST-/);
  assert.equal(result.redactionCounts["extra-0"], 2);
});

test("generatePytestCase renders the note as a comment block at the top", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do the thing" },
    events: [],
    final: { status: "success" },
  };

  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)), {
    note: "This run was wrong because the agent skipped validation.\nLinked: ENG-1234",
    testName: "with_note",
  });

  assert.match(generated, /Note from author/);
  assert.match(generated, /# This run was wrong because the agent skipped validation\./);
  assert.match(generated, /# Linked: ENG-1234/);
});

test("generatePytestCase defaults to strict match_mode (exact sequence assertion)", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do" },
    events: [
      { type: "tool_call" as const, tool_name: "Bash", arguments: { command: "ls" }, result: "ok" },
      { type: "tool_call" as const, tool_name: "Read", arguments: { path: "/x" }, result: "ok" },
    ],
    final: { status: "success" },
  };

  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)));

  // Strict mode emits an exact list equality on tool_name sequence.
  assert.match(generated, /assert \[call\["tool_name"\] for call in result\["tool_calls"\]\] ==/);
  // And does NOT pull in Counter/json (which are multiset-only imports).
  assert.equal(/from collections import Counter/.test(generated), false);
});

test("generatePytestCase emits multiset assertions when match_mode='multiset'", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do" },
    events: [
      { type: "tool_call" as const, tool_name: "Bash", arguments: { command: "ls" }, result: "ok" },
      { type: "tool_call" as const, tool_name: "Read", arguments: { path: "/x" }, result: "ok" },
    ],
    final: { status: "success" },
  };

  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)), {
    matchMode: "multiset",
  });

  // Multiset mode imports Counter and json, uses _sig + Counter equality.
  assert.match(generated, /from collections import Counter/);
  assert.match(generated, /import json/);
  assert.match(generated, /def _sig\(name, args\):/);
  assert.match(generated, /Counter\(_sig\(c\["tool_name"\], c\["arguments"\]\) for c in result\["tool_calls"\]\)/);
  // And does NOT emit the strict positional args list comparison.
  assert.equal(/observed_args = \[_normalize/.test(generated), false);
});

test("generatePytestCase emits _IGNORE_FIELDS and _prepare_args helpers", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do" },
    events: [
      {
        type: "tool_call" as const,
        tool_name: "Bash",
        arguments: { command: "ls", cwd: "/Users/alice" },
        result: "ok",
      },
    ],
    final: { status: "success" },
  };

  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)), {
    ignoreFields: ["Bash.cwd", "*.request_id"],
  });

  assert.match(generated, /_IGNORE_FIELDS = \[/);
  assert.match(generated, /"Bash\.cwd"/);
  assert.match(generated, /"\*\.request_id"/);
  assert.match(generated, /def _strip_ignored\(tool_name, args\):/);
  assert.match(generated, /def _prepare_args\(tool_name, args\):/);
  // Assertions should go through _prepare_args.
  assert.match(generated, /_prepare_args\(call\["tool_name"\], call\["arguments"\]\)/);
});

test("generatePytestCase emits empty _IGNORE_FIELDS when none provided", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do" },
    events: [],
    final: { status: "success" },
  };
  const generated = generatePytestCase(normalizeTrace(parseTrace(trace)));
  assert.match(generated, /_IGNORE_FIELDS = \[\]/);
  assert.match(generated, /def _prepare_args/);
});

test("generatePytestCase rejects malformed ignore_fields paths", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do" },
    events: [],
    final: { status: "success" },
  };
  assert.throws(
    () => generatePytestCase(normalizeTrace(parseTrace(trace)), { ignoreFields: ["Bash.cwd with spaces"] }),
    /not a valid path/,
  );
});

test("generatePytestCaseDetailed reports zero redaction counts on a clean trace", () => {
  const trace = {
    schema_version: "0.1" as const,
    input: { prompt: "do the thing" },
    events: [
      {
        type: "tool_call" as const,
        tool_name: "noop",
        arguments: { x: 1 },
        result: null,
      },
    ],
    final: { status: "success" },
  };

  const result = generatePytestCaseDetailed(normalizeTrace(parseTrace(trace)));
  assert.deepEqual(result.redactionCounts, {});
});
