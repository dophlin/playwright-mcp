const SENSITIVE_KEYS = new Set([
  "code",
  "accessToken",
  "refreshToken",
  "authorization",
  "password",
  "token",
  "handoff",
]);

/**
 * Redacts common secret fields for debug logging. Never logs handoff codes, tokens, or raw API bodies.
 */
export function formatForLog(value: unknown, depth = 0): string {
  if (depth > 4)
    return "[depth-limit]";
  if (value === null || value === undefined)
    return String(value);
  if (typeof value === "string")
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return `[${value.map(v => formatForLog(v, depth + 1)).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase()) || k.toLowerCase().includes("token") || k.toLowerCase().includes("secret")) {
        parts.push(`${k}:[REDACTED]`);
        continue;
      }
      parts.push(`${k}:${formatForLog(v, depth + 1)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return "[omitted]";
}

export function logDebug(_scope: string, _message: string, _data?: unknown): void {
  // Intentionally quiet in production; hook for future diagnostics.
}

export function shouldNeverLogRequestBody(_url: string): true {
  return true;
}
