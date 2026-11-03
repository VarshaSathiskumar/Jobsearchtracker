import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { syncRuns, type SyncRun } from "@/db/schema";
import { syncTuning } from "@/env";
import type { SyncKind } from "@/lib/constants";
import { isUniqueViolation } from "@/lib/store/applications";

export class SyncAlreadyRunningError extends Error {
  constructor(public runId: string) {
    super("A sync is already running");
    this.name = "SyncAlreadyRunningError";
  }
}

/**
 * Durable lock. The partial unique index sync_runs_one_active_per_user guarantees at most one
 * queued/running run per user, even across serverless instances. Runs whose heartbeat stopped
 * (crashed function, lost workflow) are reaped first so a dead run can never block syncing forever.
 */
export async function acquireSyncRun(
  db: Db,
  userId: string,
  opts: { kind: SyncKind; trigger?: string; params?: SyncRun["params"] },
): Promise<SyncRun> {
  await reapStaleRuns(db, userId);
  try {
    const [run] = await db
      .insert(syncRuns)
      .values({ userId, kind: opts.kind, status: "queued", trigger: opts.trigger ?? "manual", params: opts.params ?? null })
      .returning();
    return run;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [active] = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ["queued", "running"])))
      .limit(1);
    throw new SyncAlreadyRunningError(active?.id ?? "unknown");
  }
}

export async function reapStaleRuns(db: Db, userId: string) {
  const cutoff = new Date(Date.now() - syncTuning().staleLockMs);
  await db
    .update(syncRuns)
    .set({
      status: sql`case when ${syncRuns.messagesScanned} > 0 then 'partial'::sync_status else 'failed'::sync_status end`,
      error: "The sync stopped responding and was released. Start a new sync to resume.",
      finishedAt: new Date(),
    })
    .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ["queued", "running"]), lt(syncRuns.heartbeatAt, cutoff)));
}

export async function getRun(db: Db, userId: string, runId: string): Promise<SyncRun | null> {
  const [r] = await db.select().from(syncRuns).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId))).limit(1);
  return r ?? null;
}

export async function getLatestRun(db: Db, userId: string): Promise<SyncRun | null> {
  const [r] = await db.select().from(syncRuns).where(eq(syncRuns.userId, userId)).orderBy(desc(syncRuns.createdAt)).limit(1);
  return r ?? null;
}
