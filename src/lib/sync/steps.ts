import { and, count, eq, lt } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { gmailConnections, gmailMessages, syncRuns, type GmailMessage } from "@/db/schema";
import { syncTuning } from "@/env";
import { generateRunSummary } from "@/lib/agents/summary";
import type { AgentContext } from "@/lib/agents/context";
import { createModels, type AgentModels } from "@/lib/agents/models";
import { processBatchWithSupervisor } from "@/lib/agents/supervisor";
import { chunk } from "@/lib/async";
import { GmailAuthError, type GmailLike } from "@/lib/gmail/client";
import { createGmailClient } from "@/lib/gmail/connection";
import { log, redact } from "@/lib/log";
import { rematchOpenReviews } from "@/lib/pipeline/handlers";
import { bumpRun } from "@/lib/store/messages";
import { ingestChunk, type IngestResult } from "./ingest";

/**
 * Plain implementations of every workflow step. The Workflow SDK wrappers in src/workflows/sync.ts
 * call these, and tests call them directly. Each step is idempotent and bounded.
 */

export class NonRetryableSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableSyncError";
  }
}

/** Swappable collaborators, overridden in tests. */
export const syncDeps = {
  getDb: (): Db => getDb(),
  gmail: (db: Db, userId: string): Promise<GmailLike> => createGmailClient(db, userId),
  models: (): AgentModels => createModels(),
  processBatch: (ctx: AgentContext, rows: GmailMessage[]): Promise<void> => processBatchWithSupervisor(ctx, rows),
};

const PROCESS_TIME_BUDGET_MS = 150_000;

async function loadRun(db: Db, runId: string) {
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
  if (!run) throw new NonRetryableSyncError("Sync run not found");
  return run;
}

export async function stepMarkRunning(runId: string) {
  const db = syncDeps.getDb();
  // Replaying this step for an already running run is a no-op.
  await db
    .update(syncRuns)
    .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date(), phase: "ingest" })
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.status, "queued")));
}

export async function stepIngest(runId: string): Promise<IngestResult> {
  const db = syncDeps.getDb();
  const run = await loadRun(db, runId);
  if (run.status !== "running") throw new NonRetryableSyncError(`Run is ${run.status}`);
  try {
    const gmail = await syncDeps.gmail(db, run.userId);
    return await ingestChunk(db, gmail, runId);
  } catch (err) {
    if (err instanceof GmailAuthError) throw new NonRetryableSyncError(err.message + ". Reconnect Gmail in Settings.");
    throw err;
  }
}

async function pendingCount(db: Db, userId: string): Promise<number> {
  const { maxMessageAttempts } = syncTuning();
  const [r] = await db
    .select({ c: count() })
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, userId), eq(gmailMessages.processingStatus, "pending"), lt(gmailMessages.attempts, maxMessageAttempts)));
  return Number(r.c);
}

export async function stepProcess(runId: string): Promise<{ remaining: number; processed: number }> {
  const db = syncDeps.getDb();
  const run = await loadRun(db, runId);
  const t = syncTuning();
  await db.update(syncRuns).set({ phase: "classify", heartbeatAt: new Date() }).where(eq(syncRuns.id, runId));

  const rows = await db
    .select()
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, run.userId), eq(gmailMessages.processingStatus, "pending"), lt(gmailMessages.attempts, t.maxMessageAttempts)))
    .orderBy(gmailMessages.internalDate)
    .limit(t.agentBatchSize * t.batchesPerStep);

  const ctx: AgentContext = { db, userId: run.userId, runId, models: syncDeps.models() };
  const started = Date.now();
  let processed = 0;
  for (const batch of chunk(rows, t.agentBatchSize)) {
    if (Date.now() - started > PROCESS_TIME_BUDGET_MS) break;
    await syncDeps.processBatch(ctx, batch); // throws on provider outages, so the step is retried
    processed += batch.length;
    await bumpRun(db, runId, {});
  }

  const remaining = await pendingCount(db, run.userId);
  if (remaining === 0) await rematchOpenReviews(db, run.userId, runId);
  return { remaining, processed };
}

export async function stepSummarize(runId: string): Promise<boolean> {
  const db = syncDeps.getDb();
  const run = await loadRun(db, runId);
  await db.update(syncRuns).set({ phase: "summarize", heartbeatAt: new Date() }).where(eq(syncRuns.id, runId));
  try {
    let models: AgentModels | null = null;
    try {
      models = syncDeps.models();
    } catch {
      models = null; // no API key: deterministic summary only
    }
    await generateRunSummary(db, models, run.userId, runId);
    return true;
  } catch (err) {
    log.error("sync.summary_failed", { runId }, err);
    return false;
  }
}

export async function stepFinalize(runId: string, summaryOk: boolean) {
  const db = syncDeps.getDb();
  const run = await loadRun(db, runId);
  if (run.status !== "running") return;
  const remaining = await pendingCount(db, run.userId);
  const status = run.errorsCount > 0 || remaining > 0 || !summaryOk ? "partial" : "completed";
  const now = new Date();
  await db
    .update(syncRuns)
    .set({
      status,
      phase: "done",
      finishedAt: now,
      heartbeatAt: now,
      error: status === "partial" ? (remaining > 0 ? `${remaining} email(s) still pending and will be retried on the next sync.` : run.error) : null,
    })
    .where(eq(syncRuns.id, runId));
  await db.update(gmailConnections).set({ lastSyncedAt: now, lastError: null }).where(eq(gmailConnections.userId, run.userId));
}

export async function stepFail(runId: string, message: string) {
  const db = syncDeps.getDb();
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
  if (!run || (run.status !== "queued" && run.status !== "running")) return;
  await db
    .update(syncRuns)
    .set({
      // Anything already ingested is kept, so an interrupted run is "partial" and resumable.
      status: run.messagesScanned > 0 ? "partial" : "failed",
      error: redact(message),
      finishedAt: new Date(),
      heartbeatAt: new Date(),
      phase: "done",
    })
    .where(eq(syncRuns.id, runId));
}

const MAX_CHUNKS = 2000;

/**
 * Sequential in-process equivalent of the workflow. Used by tests; production uses the durable
 * workflow so execution survives restarts and does not rely on a single HTTP request.
 */
export async function runSyncInline(runId: string) {
  try {
    await stepMarkRunning(runId);
    for (let i = 0; i < MAX_CHUNKS; i++) if ((await stepIngest(runId)).done) break;
    for (let i = 0; i < MAX_CHUNKS; i++) if ((await stepProcess(runId)).remaining === 0) break;
    const ok = await stepSummarize(runId);
    await stepFinalize(runId, ok);
  } catch (err) {
    await stepFail(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
