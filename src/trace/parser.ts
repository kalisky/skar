import { readFile } from "node:fs/promises";

import { ZodError } from "zod";

import { type Trace, traceSchema } from "./schema.js";

export class TraceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceParseError";
  }
}

export async function parseTraceFile(path: string): Promise<Trace> {
  const raw = await readFile(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TraceParseError(
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseTrace(parsed, path);
}

export function parseTrace(value: unknown, source = "trace"): Trace {
  try {
    return traceSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => {
          const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${fieldPath}: ${issue.message}`;
        })
        .join("; ");

      throw new TraceParseError(`Invalid trace in ${source}: ${issues}`);
    }

    throw error;
  }
}
