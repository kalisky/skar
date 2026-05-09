import { z } from "zod";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const toolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  tool_name: z.string().min(1),
  arguments: z.record(jsonValueSchema),
  result: jsonValueSchema,
});

const finalSchema = z.object({
  status: z.string().min(1),
  output_text: z.string().optional(),
});

export const traceSchema = z.object({
  schema_version: z.literal("0.1"),
  input: z.object({
    prompt: z.string().min(1),
  }),
  events: z.array(toolCallEventSchema),
  final: finalSchema,
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolCallEvent = z.infer<typeof toolCallEventSchema>;
export type Trace = z.infer<typeof traceSchema>;
export type FinalResult = z.infer<typeof finalSchema>;
