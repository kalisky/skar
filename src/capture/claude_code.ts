import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { parseTrace } from "../trace/parser.js";
import { type Trace } from "../trace/schema.js";

export class ClaudeCodeCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCodeCaptureError";
  }
}

export interface CaptureOptions {
  cwd?: string;
  sessionPath?: string;
  lastNToolCalls?: number;
  allowExternalPath?: boolean;
}

export interface CaptureResult {
  trace: Trace;
  sessionPath: string;
  toolCallCount: number;
  totalToolCalls: number;
}

export async function captureClaudeCodeSession(
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const sessionPath = options.sessionPath
    ? options.sessionPath
    : await discoverLatestSession(options.cwd ?? process.cwd());

  if (options.sessionPath && !options.allowExternalPath) {
    const projectsRoot = path.join(homedir(), ".claude", "projects");
    const resolved = path.resolve(options.sessionPath);
    if (resolved !== projectsRoot && !resolved.startsWith(projectsRoot + path.sep)) {
      throw new ClaudeCodeCaptureError(
        `session_path is outside ${projectsRoot}: ${resolved}. ` +
          "Pass allow_external_path=true (MCP) or --allow-external-path (CLI) if this is intentional.",
      );
    }
  }

  const events = await readSessionJsonl(sessionPath);
  const filtered = events.filter((event) => event.isSidechain !== true);

  const prompt = findFirstUserPrompt(filtered);
  if (!prompt) {
    throw new ClaudeCodeCaptureError(
      `Could not find an initial user prompt in ${sessionPath}.`,
    );
  }

  const { toolUses, toolResults, lastAssistantText } = collectToolEvents(filtered);

  const ordered = Array.from(toolUses.values()).sort((a, b) => a.order - b.order);
  const total = ordered.length;
  const sliced =
    options.lastNToolCalls !== undefined && options.lastNToolCalls > 0
      ? ordered.slice(-options.lastNToolCalls)
      : ordered;

  const traceEvents = sliced.map((entry) => ({
    type: "tool_call" as const,
    tool_name: entry.name,
    arguments: jsonOrNull(entry.input),
    result: jsonOrNull(toolResults.get(entry.id) ?? null),
  }));

  const candidate = {
    schema_version: "0.1" as const,
    input: { prompt },
    events: traceEvents,
    final: {
      status: "unknown",
      ...(lastAssistantText ? { output_text: lastAssistantText } : {}),
    },
  };

  const trace = parseTrace(candidate, sessionPath);

  return {
    trace,
    sessionPath,
    toolCallCount: traceEvents.length,
    totalToolCalls: total,
  };
}

export async function discoverLatestSession(cwd: string): Promise<string> {
  const projectDir = projectDirForCwd(cwd);

  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ClaudeCodeCaptureError(
        `No Claude Code session history found for ${cwd} (looked in ${projectDir}). ` +
          "Either Claude Code has not run in this directory yet, or pass session_path explicitly.",
      );
    }
    throw error;
  }

  const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) {
    throw new ClaudeCodeCaptureError(
      `No .jsonl session files found in ${projectDir}. Pass session_path explicitly or run Claude Code in ${cwd} first.`,
    );
  }

  const stats = await Promise.all(
    jsonlFiles.map(async (name) => {
      const fullPath = path.join(projectDir, name);
      const info = await stat(fullPath);
      return { fullPath, mtimeMs: info.mtimeMs };
    }),
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = stats[0];
  if (!latest) {
    throw new ClaudeCodeCaptureError(`No readable session files in ${projectDir}.`);
  }
  return latest.fullPath;
}

export function projectDirForCwd(cwd: string): string {
  const absolute = path.resolve(cwd);
  const encoded = absolute.replace(/\//g, "-");
  return path.join(homedir(), ".claude", "projects", encoded);
}

interface SessionEvent {
  type?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: string | unknown[];
  };
}

interface ToolUseEntry {
  id: string;
  name: string;
  input: unknown;
  order: number;
}

async function readSessionJsonl(filePath: string): Promise<SessionEvent[]> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as SessionEvent;
    } catch (error) {
      throw new ClaudeCodeCaptureError(
        `Invalid JSON on line ${index + 1} of ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function findFirstUserPrompt(events: SessionEvent[]): string | null {
  for (const event of events) {
    if (event.type === "user" && typeof event.message?.content === "string") {
      return event.message.content;
    }
  }
  return null;
}

function collectToolEvents(events: SessionEvent[]): {
  toolUses: Map<string, ToolUseEntry>;
  toolResults: Map<string, unknown>;
  lastAssistantText: string | null;
} {
  const toolUses = new Map<string, ToolUseEntry>();
  const toolResults = new Map<string, unknown>();
  let order = 0;
  let lastAssistantText: string | null = null;

  for (const event of events) {
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          toolUses.set(block.id, {
            id: block.id,
            name: block.name,
            input: block.input,
            order: order++,
          });
        } else if (block.type === "text" && typeof block.text === "string") {
          lastAssistantText = block.text;
        }
      }
    } else if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          toolResults.set(block.tool_use_id, block.content ?? null);
        }
      }
    }
  }

  return { toolUses, toolResults, lastAssistantText };
}

function jsonOrNull(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as { code?: string }).code === "string";
}
