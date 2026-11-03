import { z } from "zod";

/**
 * Environment access is lazy so that `next build` and unit tests do not need every
 * secret to be present. Each accessor validates only what it needs.
 */

const base64Key = z
  .string()
  .min(1, "TOKEN_ENCRYPTION_KEY is required")
  .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

export function appUrl(): string {
  const explicit = process.env.APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function dbEnv() {
  return parse(z.object({ DATABASE_URL: z.string().min(1, "DATABASE_URL is required") }), process.env);
}

export function googleEnv() {
  return parse(
    z.object({
      GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
      GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
    }),
    process.env,
  );
}

export function cryptoEnv() {
  return parse(z.object({ TOKEN_ENCRYPTION_KEY: base64Key }), process.env);
}

export function allowedEmail(): string {
  const v = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!v) throw new Error("ALLOWED_EMAIL is not set");
  return v;
}

export function openaiEnv() {
  return parse(
    z.object({
      OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
      OPENAI_MODEL_SUPERVISOR: z.string().default("gpt-4.1"),
      OPENAI_MODEL_FAST: z.string().default("gpt-4.1-mini"),
      OPENAI_MODEL_SUMMARY: z.string().optional(),
    }),
    {
      ...process.env,
      OPENAI_MODEL_SUPERVISOR: process.env.OPENAI_MODEL_SUPERVISOR || undefined,
      OPENAI_MODEL_FAST: process.env.OPENAI_MODEL_FAST || undefined,
    },
  );
}

/** Tunables with safe defaults. */
export function syncTuning() {
  const int = (name: string, def: number) => {
    const n = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    /** Gmail ids listed per ingest step. */
    listPageSize: Math.min(int("SYNC_LIST_PAGE_SIZE", 100), 500),
    /** Concurrent Gmail API requests. */
    gmailConcurrency: Math.min(int("GMAIL_CONCURRENCY", 5), 10),
    /** Messages sent to the supervisor per agent invocation. */
    agentBatchSize: Math.min(int("AGENT_BATCH_SIZE", 5), 10),
    /** Max agent batches per workflow step. */
    batchesPerStep: int("AGENT_BATCHES_PER_STEP", 2),
    /** A run with no heartbeat for this long is considered dead and its lock is released. */
    staleLockMs: int("SYNC_STALE_LOCK_MINUTES", 15) * 60_000,
    /** Max processing attempts per message before it is sent to Needs Review. */
    maxMessageAttempts: int("MAX_MESSAGE_ATTEMPTS", 3),
  };
}
