import { start } from "workflow/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { syncRuns } from "@/db/schema";
import { apiError, authenticate, json } from "@/lib/api";
import { getConnection } from "@/lib/gmail/connection";
import { log } from "@/lib/log";
import { acquireSyncRun, getLatestRun, SyncAlreadyRunningError } from "@/lib/sync/lock";
import { runDto } from "@/lib/sync/dto";
import { syncWorkflow } from "@/workflows/sync";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    mode: z.enum(["refresh", "backfill"]).default("refresh"),
    after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  })
  .default({ mode: "refresh" });

/** Starts a durable sync and returns immediately with the run id. */
export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const { user } = a;

  const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "Invalid request body");
  const { mode, after, before } = parsed.data;
  if (after && before && after >= before) return apiError(400, "The start date must be before the end date");

  const db = getDb();
  const conn = await getConnection(db, user.id);
  if (!conn || conn.status === "disconnected") return apiError(409, "Gmail is not connected", { code: "gmail_not_connected" });
  if (conn.status === "needs_reauth") return apiError(409, "Gmail authorization expired. Reconnect Gmail.", { code: "gmail_needs_reauth" });

  let run;
  try {
    run = await acquireSyncRun(db, user.id, {
      // An unfinished or never-run backfill is resumed automatically by the ingest planner.
      kind: mode === "backfill" ? "backfill" : "incremental",
      params: mode === "backfill" ? { after: after ?? null, before: before ?? null } : null,
    });
  } catch (err) {
    if (err instanceof SyncAlreadyRunningError) return apiError(409, "A sync is already running", { code: "sync_running", runId: err.runId });
    throw err;
  }

  try {
    const wf = await start(syncWorkflow, [run.id]);
    await db.update(syncRuns).set({ workflowRunId: wf.runId }).where(eq(syncRuns.id, run.id));
  } catch (err) {
    log.error("sync.start_failed", { runId: run.id }, err);
    await db.update(syncRuns).set({ status: "failed", error: "Could not start the background workflow", finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    return apiError(500, "Could not start the sync");
  }

  return json({ runId: run.id, status: "queued" }, 202);
}

/** Latest run, for polling and for the initial page state. */
export async function GET(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const run = await getLatestRun(getDb(), a.user.id);
  return json({ run: run ? runDto(run) : null });
}
