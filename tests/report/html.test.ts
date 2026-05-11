import assert from "node:assert/strict";
import test from "node:test";

import { renderHtmlReport } from "../../src/report/html.js";
import { DEFAULT_REDACTION_RULES } from "../../src/redact/secrets.js";

test("renderHtmlReport produces a self-contained HTML document", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "Refund order 123 if eligible",
      toolCalls: [
        { toolName: "refund_lookup", arguments: { order_id: "123" }, result: { eligible: true } },
        { toolName: "refund_create", arguments: { order_id: "123" }, result: { ok: true } },
      ],
      final: { status: "success", output_text: "Refund created" },
    },
    testName: "refund_regression",
    testOutputPath: "tests/test_refund.py",
    redactionCounts: { "openai-key": 1, "github-token": 2 },
    rulesApplied: DEFAULT_REDACTION_RULES,
  });

  // Self-contained: no external script/css references.
  assert.match(html, /^<!DOCTYPE html>/);
  assert.equal(/src=/.test(html), false, "references external script");
  assert.equal(/href=/.test(html), false, "references external stylesheet");
  // Surfaces what we want the engineer to see at a glance.
  assert.match(html, /Skar regression report/);
  assert.match(html, /refund_regression/);
  assert.match(html, /refund_lookup/);
  assert.match(html, /refund_create/);
  assert.match(html, /Refund order 123 if eligible/);
  assert.match(html, /3<\/strong> value\(s\) were detected/); // 1 + 2 redactions
  assert.match(html, /<HOME>|HOME/); // drift summary mentions home directories
});

test("renderHtmlReport renders the no-redaction case gracefully", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "x",
      toolCalls: [],
      final: { status: "unknown" },
    },
    redactionCounts: {},
    rulesApplied: DEFAULT_REDACTION_RULES,
  });

  assert.match(html, /did not detect any standard secret shapes/);
  assert.match(html, /No tool calls in the captured slice\./);
});

test("renderHtmlReport renders ignored fields section when set", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "x",
      toolCalls: [],
      final: { status: "unknown" },
    },
    redactionCounts: {},
    rulesApplied: DEFAULT_REDACTION_RULES,
    ignoreFields: ["Bash.cwd", "*.request_id"],
  });

  assert.match(html, /Ignored argument fields/);
  assert.match(html, /<code>Bash\.cwd<\/code>/);
  assert.match(html, /<code>\*\.request_id<\/code>/);
});

test("renderHtmlReport omits ignored-fields section when none set", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "x",
      toolCalls: [],
      final: { status: "unknown" },
    },
    redactionCounts: {},
    rulesApplied: DEFAULT_REDACTION_RULES,
  });

  assert.equal(/Ignored argument fields/.test(html), false);
});

test("renderHtmlReport renders tool result previews in the captured-slice table", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "x",
      toolCalls: [
        { toolName: "lookup", arguments: { id: 1 }, result: { ok: true, refund_eligible: true } },
        { toolName: "process", arguments: { id: 1 }, result: "issued in 3-5 business days" },
      ],
      final: { status: "success" },
    },
    redactionCounts: {},
    rulesApplied: DEFAULT_REDACTION_RULES,
  });

  // The result-preview column exists.
  assert.match(html, /Result preview/);
  // Each row carries a preview (escaped JSON for objects, plain string for str).
  assert.match(html, /refund_eligible/);
  assert.match(html, /issued in 3-5 business days/);
});

test("renderHtmlReport caller is responsible for passing the redacted trace (security regression guard)", () => {
  // The renderer trusts its input. The generator's caller must pass the
  // redacted trace (result.redactedTrace), not the original. This test
  // documents that contract by exercising it directly.
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "x",
      toolCalls: [
        { toolName: "t", arguments: { ok: true }, result: { token: "<REDACTED>" } },
      ],
      final: { status: "success" },
    },
    redactionCounts: { "anthropic-key": 1 },
    rulesApplied: DEFAULT_REDACTION_RULES,
  });
  assert.match(html, /&lt;REDACTED&gt;/);
});

test("renderHtmlReport HTML-escapes user-controlled content", () => {
  const html = renderHtmlReport({
    trace: {
      schemaVersion: "0.1",
      prompt: "<script>alert('xss')</script>",
      toolCalls: [],
      final: { status: "unknown" },
    },
    redactionCounts: {},
    rulesApplied: DEFAULT_REDACTION_RULES,
  });

  assert.equal(/<script>alert/.test(html), false, "raw script tag rendered");
  assert.match(html, /&lt;script&gt;alert/);
});
