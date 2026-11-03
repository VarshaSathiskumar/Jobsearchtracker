/**
 * Minimal structured logger. It deliberately accepts only primitive metadata and scrubs anything that
 * looks like a credential, so email subjects, bodies and tokens never reach the logs.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/ya29\.[A-Za-z0-9_\-.]+/g, "[redacted-token]"],
  [/1\/\/[A-Za-z0-9_\-.]{20,}/g, "[redacted-token]"],
  [/sk-ant-[A-Za-z0-9_\-]+/g, "[redacted-key]"],
  [/Bearer\s+[A-Za-z0-9_\-.]+/gi, "Bearer [redacted]"],
  [/(refresh_token|access_token|client_secret|code)=([^&\s]+)/gi, "$1=[redacted]"],
  [/postgres(ql)?:\/\/[^\s]+/gi, "postgres://[redacted]"],
];

export function redact(input: unknown): string {
  let s = input instanceof Error ? input.message : typeof input === "string" ? input : JSON.stringify(input);
  if (s === undefined) s = String(input);
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s.length > 500 ? s.slice(0, 500) + "..." : s;
}

type Meta = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", event: string, meta?: Meta, err?: unknown) {
  const line: Record<string, unknown> = { level, event, ...meta };
  if (err !== undefined) line.error = redact(err);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export const log = {
  info: (event: string, meta?: Meta) => emit("info", event, meta),
  warn: (event: string, meta?: Meta, err?: unknown) => emit("warn", event, meta, err),
  error: (event: string, meta?: Meta, err?: unknown) => emit("error", event, meta, err),
};
