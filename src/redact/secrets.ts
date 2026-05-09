import { type JsonValue } from "../trace/schema.js";

export interface RedactionRule {
  label: string;
  description: string;
  jsRegex: RegExp;
  pythonPattern: string;
  pythonFlags?: string;
}

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  {
    label: "pem-private-key",
    description: "PEM private key blocks",
    jsRegex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    pythonPattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
  },
  {
    label: "jwt",
    description: "JSON Web Tokens (eyJ... three-segment shape)",
    jsRegex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    pythonPattern: "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
  },
  {
    label: "bearer",
    description: "Bearer tokens in Authorization-header shape",
    jsRegex: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    pythonPattern: "Bearer\\s+[A-Za-z0-9._~+/=-]{20,}",
  },
  {
    label: "anthropic-key",
    description: "Anthropic API keys (sk-ant-...)",
    jsRegex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    pythonPattern: "sk-ant-[A-Za-z0-9_-]{20,}",
  },
  {
    label: "openai-key",
    description: "OpenAI API keys (sk-, sk-proj-...)",
    jsRegex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
    pythonPattern: "sk-(?:proj-)?[A-Za-z0-9_-]{32,}",
  },
  {
    label: "github-token",
    description: "GitHub personal access / OAuth / app tokens (gh[pousr]_...)",
    jsRegex: /gh[pousr]_[A-Za-z0-9]{20,}/g,
    pythonPattern: "gh[pousr]_[A-Za-z0-9]{20,}",
  },
  {
    label: "aws-access-key",
    description: "AWS access key ids (AKIA...)",
    jsRegex: /AKIA[0-9A-Z]{16}/g,
    pythonPattern: "AKIA[0-9A-Z]{16}",
  },
  {
    label: "slack-token",
    description: "Slack tokens (xox[baprs]-...)",
    jsRegex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    pythonPattern: "xox[baprs]-[A-Za-z0-9-]{10,}",
  },
];

export const REDACTED_PLACEHOLDER = "<REDACTED>";

export interface RedactionCounts {
  [label: string]: number;
}

export interface RedactionResult<T> {
  value: T;
  counts: RedactionCounts;
}

export function compileExtraRules(patterns: string[]): RedactionRule[] {
  return patterns.map((pattern, index) => {
    let jsRegex: RegExp;
    try {
      jsRegex = new RegExp(pattern, "g");
    } catch (error) {
      throw new Error(
        `extra_redact_patterns[${index}] is not a valid regex: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      label: `extra-${index}`,
      description: `User-provided pattern: ${pattern}`,
      jsRegex,
      pythonPattern: pattern,
    };
  });
}

export function redactStringWithCounts(
  input: string,
  rules: RedactionRule[],
  counts: RedactionCounts,
): string {
  let out = input;
  for (const rule of rules) {
    let hits = 0;
    out = out.replace(rule.jsRegex, () => {
      hits += 1;
      return REDACTED_PLACEHOLDER;
    });
    if (hits > 0) {
      counts[rule.label] = (counts[rule.label] ?? 0) + hits;
    }
  }
  return out;
}

export function redactJsonWithCounts(
  value: JsonValue,
  rules: RedactionRule[],
): RedactionResult<JsonValue> {
  const counts: RedactionCounts = {};
  const redacted = redactJsonInner(value, rules, counts);
  return { value: redacted, counts };
}

function redactJsonInner(
  value: JsonValue,
  rules: RedactionRule[],
  counts: RedactionCounts,
): JsonValue {
  if (typeof value === "string") {
    return redactStringWithCounts(value, rules, counts);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonInner(item, rules, counts));
  }
  if (value !== null && typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = redactJsonInner(child, rules, counts);
    }
    return result;
  }
  return value;
}
