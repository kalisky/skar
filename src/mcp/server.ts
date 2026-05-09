#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { generatePytestCase } from "../generator/pytest.js";
import { normalizeTrace } from "../trace/normalizer.js";
import { parseTrace, parseTraceFile, TraceParseError } from "../trace/parser.js";
import { type Trace } from "../trace/schema.js";

const SERVER_NAME = "skar";
const SERVER_VERSION = "0.0.1";

const traceSourceShape = {
  trace_path: z
    .string()
    .optional()
    .describe(
      "Absolute or workspace-relative path to a captured agent trace JSON file. Provide this OR trace_json, not both.",
    ),
  trace_json: z
    .string()
    .optional()
    .describe(
      "Raw JSON string of a captured agent trace, when the trace is already in memory and not on disk. Provide this OR trace_path, not both.",
    ),
};

export function createSkarServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "generate_pytest_regression",
    {
      title: "Generate a pytest regression test from a captured agent trace",
      description: [
        "USE THIS WHEN: a tool-using AI agent produced a wrong, broken, or surprising run and the user wants to lock that failure as an executable regression test that can be checked into the repo and run in CI.",
        "TRIGGER PHRASES: 'turn this trace into a test', 'generate a regression test for that bad run', 'make sure this never happens again', 'pin this failure', 'capture this as a test'.",
        "INPUT: a captured agent trace conforming to the Skar trace schema (schema_version 0.1) — provide either a file path (trace_path) or the raw JSON string (trace_json). Also accepts an optional output_path to write the file, and an optional test_name.",
        "OUTPUT: ready-to-commit pytest source code that asserts on the captured tool sequence, tool arguments, and final status. The user wires a tiny `skar_adapter.run_agent_under_test` shim once; everything else is generated.",
        "DO NOT USE FOR: live trace capture, generic eval scoring, observability dashboards, or non-tool-using LLM completions. Skar's scope is narrow on purpose: trace -> committed regression test.",
      ].join(" "),
      inputSchema: {
        ...traceSourceShape,
        output_path: z
          .string()
          .optional()
          .describe(
            "Optional path to write the generated pytest file (e.g. tests/test_refund_regression.py). If omitted, the generated source is only returned in the response.",
          ),
        test_name: z
          .string()
          .optional()
          .describe(
            "Optional pytest test function suffix. The generator emits `def test_<test_name>():`. If omitted, a name is derived from the trace prompt.",
          ),
      },
    },
    async ({ trace_path, trace_json, output_path, test_name }) => {
      const trace = await loadTrace({ trace_path, trace_json });
      const normalized = normalizeTrace(trace);
      const generated = generatePytestCase(normalized, test_name);

      const messageLines = ["Generated pytest regression test."];
      if (output_path) {
        await mkdir(path.dirname(path.resolve(output_path)), { recursive: true });
        await writeFile(output_path, generated, "utf8");
        messageLines.push(`Wrote file: ${output_path}`);
      }
      messageLines.push(
        "Next: ensure your project exposes `skar_adapter.run_agent_under_test(prompt, mocked_tool_calls)` returning {tool_calls, status, output_text?}, then run pytest.",
      );

      return {
        content: [
          { type: "text", text: messageLines.join("\n") },
          { type: "text", text: generated },
        ],
      };
    },
  );

  server.registerTool(
    "validate_trace",
    {
      title: "Validate a captured agent trace against the Skar schema",
      description: [
        "USE THIS WHEN: you have a captured agent trace and want to confirm it conforms to the Skar trace schema before generating a regression test, OR when generate_pytest_regression failed and you want a clear field-level error message.",
        "INPUT: trace_path or trace_json (one of).",
        "OUTPUT: 'Trace is valid' on success, or a structured error listing the offending field paths and reasons. Use this as a precheck if you are unsure whether a captured run is in the right shape.",
      ].join(" "),
      inputSchema: traceSourceShape,
    },
    async ({ trace_path, trace_json }) => {
      try {
        await loadTrace({ trace_path, trace_json });
        return {
          content: [{ type: "text", text: "Trace is valid." }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "inspect_trace",
    {
      title: "Summarize a captured agent trace",
      description: [
        "USE THIS WHEN: the user wants a quick structured summary of what a captured agent run did (prompt, tool calls in order, final status), or when you need to decide which assertions a generated regression test should target.",
        "INPUT: trace_path or trace_json (one of).",
        "OUTPUT: a short human-readable summary plus the normalized trace as JSON.",
      ].join(" "),
      inputSchema: traceSourceShape,
    },
    async ({ trace_path, trace_json }) => {
      const trace = await loadTrace({ trace_path, trace_json });
      const normalized = normalizeTrace(trace);

      const summary = [
        `schema_version: ${normalized.schemaVersion}`,
        `prompt: ${normalized.prompt}`,
        `tool_calls: ${normalized.toolCalls.length}`,
        `final_status: ${normalized.final.status}`,
      ].join("\n");

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(normalized, null, 2) },
        ],
      };
    },
  );

  return server;
}

async function loadTrace(args: {
  trace_path?: string | undefined;
  trace_json?: string | undefined;
}): Promise<Trace> {
  const { trace_path, trace_json } = args;

  if (trace_path && trace_json) {
    throw new TraceParseError(
      "Provide either trace_path or trace_json, not both.",
    );
  }

  if (trace_path) {
    return parseTraceFile(trace_path);
  }

  if (trace_json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trace_json);
    } catch (error) {
      throw new TraceParseError(
        `Invalid JSON in trace_json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseTrace(parsed, "trace_json");
  }

  throw new TraceParseError(
    "Missing input: provide either trace_path or trace_json.",
  );
}

export async function runStdio(): Promise<void> {
  const server = createSkarServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isDirectExecution()) {
  runStdio().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return fileURLToPath(import.meta.url) === path.resolve(entryPath);
}
