import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  captureClaudeCodeSession,
  ClaudeCodeCaptureError,
} from "../../src/capture/claude_code.js";
import { generatePytestCase } from "../../src/generator/pytest.js";
import { normalizeTrace } from "../../src/trace/normalizer.js";

const fixture = path.resolve("tests/fixtures/claude_code_session_minimal.jsonl");

test("captureClaudeCodeSession converts a synthetic session", async () => {
  const result = await captureClaudeCodeSession({
    sessionPath: fixture,
    allowExternalPath: true,
  });

  assert.equal(result.toolCallCount, 2);
  assert.equal(result.totalToolCalls, 2);
  assert.equal(result.trace.input.prompt, "Refund order 123 if eligible");
  assert.deepEqual(
    result.trace.events.map((event) => event.tool_name),
    ["refund_lookup", "refund_create"],
  );
  assert.equal(result.trace.final.status, "unknown");
  assert.equal(result.trace.final.output_text, "Refund created");
});

test("captureClaudeCodeSession ignores sidechain events", async () => {
  const result = await captureClaudeCodeSession({
    sessionPath: fixture,
    allowExternalPath: true,
  });
  const toolNames = result.trace.events.map((event) => event.tool_name);
  assert.equal(toolNames.includes("should_be_ignored"), false);
});

test("captureClaudeCodeSession honors lastNToolCalls", async () => {
  const result = await captureClaudeCodeSession({
    sessionPath: fixture,
    lastNToolCalls: 1,
    allowExternalPath: true,
  });

  assert.equal(result.toolCallCount, 1);
  assert.equal(result.totalToolCalls, 2);
  assert.equal(result.trace.events[0]?.tool_name, "refund_create");
});

test("captureClaudeCodeSession output feeds generatePytestCase", async () => {
  const result = await captureClaudeCodeSession({
    sessionPath: fixture,
    allowExternalPath: true,
  });
  const generated = generatePytestCase(normalizeTrace(result.trace), "captured_refund");

  assert.match(generated, /def test_captured_refund\(\):/);
  assert.match(generated, /"refund_lookup"/);
  assert.match(generated, /"refund_create"/);
});

test("captureClaudeCodeSession surfaces a clear error for a missing session dir", async () => {
  await assert.rejects(
    () =>
      captureClaudeCodeSession({
        cwd: "/nonexistent/path-that-claude-never-saw",
      }),
    (error: unknown) =>
      error instanceof ClaudeCodeCaptureError &&
      /No Claude Code session history found/.test(error.message),
  );
});

test("captureClaudeCodeSession refuses session_path outside ~/.claude/projects/", async () => {
  await assert.rejects(
    () => captureClaudeCodeSession({ sessionPath: fixture }),
    (error: unknown) =>
      error instanceof ClaudeCodeCaptureError &&
      /outside/.test(error.message) &&
      /allow_external_path/.test(error.message),
  );
});
