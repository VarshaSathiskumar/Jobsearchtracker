import { FatalError } from "workflow";
import {
  NonRetryableSyncError,
  stepFail,
  stepFinalize,
  stepIngest,
  stepMarkRunning,
  stepProcess,
  stepSummarize,
} from "@/lib/sync/steps";

/**
 * Durable sync workflow (Vercel Workflow SDK).
 *
 * Each step is a bounded unit of work (one Gmail page, or one or two agent batches). Progress is
 * persisted in Postgres after every step, so the workflow survives restarts and a later run resumes
 * where an interrupted backfill stopped. Steps retry automatically on transient failures.
 */

const MAX_CHUNKS = 2000;

function asWorkflowError(err: unknown): never {
  if (err instanceof NonRetryableSyncError) throw new FatalError(err.message);
  throw err;
}

async function markRunning(runId: string) {
  "use step";
  await stepMarkRunning(runId).catch(asWorkflowError);
}
markRunning.maxRetries = 5;

async function ingest(runId: string) {
  "use step";
  return stepIngest(runId).catch(asWorkflowError);
}
ingest.maxRetries = 5;

async function processMail(runId: string) {
  "use step";
  return stepProcess(runId).catch(asWorkflowError);
}
processMail.maxRetries = 5;

async function summarize(runId: string) {
  "use step";
  return stepSummarize(runId);
}

async function finalize(runId: string, summaryOk: boolean) {
  "use step";
  await stepFinalize(runId, summaryOk);
}
finalize.maxRetries = 5;

async function fail(runId: string, message: string) {
  "use step";
  await stepFail(runId, message);
}
fail.maxRetries = 5;

export async function syncWorkflow(runId: string) {
  "use workflow";

  try {
    await markRunning(runId);

    for (let i = 0; i < MAX_CHUNKS; i++) {
      const r = await ingest(runId);
      if (r.done) break;
    }

    for (let i = 0; i < MAX_CHUNKS; i++) {
      const r = await processMail(runId);
      if (r.remaining === 0) break;
    }

    const summaryOk = await summarize(runId);
    await finalize(runId, summaryOk);
    return { runId, ok: true };
  } catch (err) {
    await fail(runId, err instanceof Error ? err.message : "Sync failed");
    return { runId, ok: false };
  }
}
