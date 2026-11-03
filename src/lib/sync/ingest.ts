import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { gmailConnections, gmailMessages, syncRuns, type BackfillState, type SyncCursor, type SyncRun } from "@/db/schema";
import { syncTuning } from "@/env";
import { chunk } from "@/lib/async";
import { GmailAuthError, HistoryExpiredError, type GmailLike } from "@/lib/gmail/client";
import { getConnection } from "@/lib/gmail/connection";
import { parseMessage } from "@/lib/gmail/parse";
import { log } from "@/lib/log";
import { buildGmailQuery, prefilter } from "@/lib/prefilter";
import { bumpRun } from "@/lib/store/messages";

export type IngestResult = { done: boolean; scanned: number; added: number; relevant: number };

const gmailDate = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

/** Converts an HTML date input (YYYY-MM-DD) to Gmail's YYYY/MM/DD search format. */
export function toGmailDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : v.match(/^\d{4}\/\d{2}\/\d{2}$/) ? v : null;
}

async function saveCursor(db: Db, runId: string, cursor: SyncCursor, extra?: Partial<typeof syncRuns.$inferInsert>) {
  await db.update(syncRuns).set({ cursor, heartbeatAt: new Date(), ...extra }).where(eq(syncRuns.id, runId));
}

/** Decides where this run starts: resume a backfill, a fresh backfill, or an incremental history sync. */
async function initCursor(db: Db, gmail: GmailLike, run: SyncRun): Promise<{ cursor: SyncCursor; kind: SyncRun["kind"] }> {
  const conn = await getConnection(db, run.userId);
  if (!conn) throw new GmailAuthError("Gmail is not connected");
  const profile = await gmail.getProfile();

  const explicitBackfill = run.kind === "backfill";
  const needsBackfill = !conn.historyId || (conn.backfillState && !conn.backfillState.done);

  if (explicitBackfill || needsBackfill) {
    const asked = { after: toGmailDate(run.params?.after), before: toGmailDate(run.params?.before) };
    const resumable = conn.backfillState && !conn.backfillState.done;
    // Resume saved progress unless the user explicitly asked for a different range.
    const sameRange = resumable && (!explicitBackfill || (conn.backfillState!.after === asked.after && conn.backfillState!.before === asked.before));
    const state: BackfillState = sameRange
      ? conn.backfillState!
      : {
          after: explicitBackfill ? asked.after : conn.backfillState?.after ?? null,
          before: explicitBackfill ? asked.before : conn.backfillState?.before ?? null,
          pageToken: null,
          // Captured BEFORE listing so mail arriving during the backfill is picked up by the first incremental sync.
          anchorHistoryId: profile.historyId,
          scanned: 0,
          done: false,
        };
    await db.update(gmailConnections).set({ backfillState: state, updatedAt: new Date() }).where(eq(gmailConnections.userId, run.userId));
    return {
      kind: "backfill",
      cursor: {
        stage: "list",
        query: buildGmailQuery({ after: state.after, before: state.before }),
        listPageToken: state.pageToken,
        anchorHistoryId: state.anchorHistoryId,
      },
    };
  }

  return {
    kind: "incremental",
    cursor: { stage: "history", startHistoryId: conn.historyId, anchorHistoryId: profile.historyId, historyPageToken: null },
  };
}

/** Stores one batch of Gmail ids: metadata first, bodies only for plausible job mail. */
async function ingestIds(db: Db, gmail: GmailLike, run: SyncRun, ids: string[]): Promise<{ added: number; relevant: number }> {
  if (ids.length === 0) return { added: 0, relevant: 0 };
  const existing = await db
    .select({ id: gmailMessages.gmailMessageId })
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, run.userId), inArray(gmailMessages.gmailMessageId, ids)));
  const known = new Set(existing.map((e) => e.id));
  const fresh = ids.filter((id) => !known.has(id));
  if (fresh.length === 0) return { added: 0, relevant: 0 };

  const meta = (await gmail.getMessages(fresh, "metadata")).filter((m): m is NonNullable<typeof m> => !!m);
  const parsed = meta.map((m) => parseMessage(m, { includeBody: false }));
  const verdicts = new Map(parsed.map((p) => [p.gmailMessageId, prefilter(p)]));

  const wantBody = parsed.filter((p) => verdicts.get(p.gmailMessageId)!.verdict !== "irrelevant").map((p) => p.gmailMessageId);
  const bodies = new Map<string, ReturnType<typeof parseMessage>>();
  for (const part of chunk(wantBody, 50)) {
    const full = await gmail.getMessages(part, "full");
    for (const f of full) if (f) bodies.set(f.id, parseMessage(f, { includeBody: true }));
  }

  const rows: (typeof gmailMessages.$inferInsert)[] = [];
  let relevant = 0;
  for (const p of parsed) {
    const v = verdicts.get(p.gmailMessageId)!;
    const base = {
      userId: run.userId,
      gmailMessageId: p.gmailMessageId,
      threadId: p.threadId,
      internalDate: p.internalDate,
      fromEmail: p.fromEmail,
      fromName: p.fromName,
      subject: p.subject,
      snippet: p.snippet,
      labelIds: p.labelIds,
      syncRunId: run.id,
    };
    if (v.verdict === "irrelevant") {
      rows.push({ ...base, processingStatus: "skipped", classification: "irrelevant", classificationSource: "shortcut", classificationConfidence: 1, processedAt: new Date() });
      continue;
    }
    const full = bodies.get(p.gmailMessageId);
    if (!full) continue; // deleted between listing and fetching
    relevant++;
    rows.push({
      ...base,
      bodyExcerpt: full.text || p.snippet,
      links: full.links,
      processingStatus: "pending",
      ...(v.verdict === "job_alert" ? { classification: "job_alert" as const, classificationConfidence: v.confidence, classificationSource: "shortcut" } : {}),
    });
  }
  const inserted = rows.length
    ? await db.insert(gmailMessages).values(rows).onConflictDoNothing({ target: [gmailMessages.userId, gmailMessages.gmailMessageId] }).returning({ id: gmailMessages.id })
    : [];
  return { added: inserted.length, relevant };
}

/**
 * One bounded ingest chunk (a single Gmail list/history page). Safe to call repeatedly: progress lives
 * in sync_runs.cursor and, for backfills, in gmail_connections.backfill_state, so any interrupted
 * execution (or a brand new run) continues from the last committed page.
 */
export async function ingestChunk(db: Db, gmail: GmailLike, runId: string): Promise<IngestResult> {
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
  if (!run) throw new Error("Sync run not found");
  const tuning = syncTuning();

  let cursor = run.cursor;
  let kind = run.kind;
  if (!cursor) {
    const init = await initCursor(db, gmail, run);
    cursor = init.cursor;
    kind = init.kind;
    await saveCursor(db, runId, cursor, { kind, phase: "ingest", historyIdStart: cursor.startHistoryId ?? null });
    run.kind = kind;
  }
  if (cursor.stage === "done") return { done: true, scanned: 0, added: 0, relevant: 0 };

  let ids: string[] = [];
  let finalHistoryId: string | null = null;

  if (cursor.stage === "history") {
    try {
      const page = await gmail.listHistory({ startHistoryId: cursor.startHistoryId!, pageToken: cursor.historyPageToken, maxResults: 500 });
      ids = page.ids;
      cursor = { ...cursor, historyPageToken: page.nextPageToken, stage: page.nextPageToken ? "history" : "done" };
      finalHistoryId = page.historyId;
    } catch (err) {
      if (!(err instanceof HistoryExpiredError)) throw err;
      // The stored history id is too old for Gmail. Fall back to a bounded rescan of the period since
      // the last successful sync (with a safety margin). Deduplication makes overlap harmless.
      const conn = await getConnection(db, run.userId);
      const since = new Date((conn?.lastSyncedAt ?? new Date(Date.now() - 30 * 86_400_000)).getTime() - 3 * 86_400_000);
      log.warn("sync.history_expired_rescan", { runId });
      kind = "rescan";
      cursor = { stage: "list", query: buildGmailQuery({ after: gmailDate(since) }), listPageToken: null, anchorHistoryId: cursor.anchorHistoryId };
      await saveCursor(db, runId, cursor, { kind });
      return { done: false, scanned: 0, added: 0, relevant: 0 };
    }
  } else {
    const page = await gmail.listMessageIds({ query: cursor.query ?? "", pageToken: cursor.listPageToken, maxResults: tuning.listPageSize });
    ids = page.ids;
    cursor = { ...cursor, listPageToken: page.nextPageToken, stage: page.nextPageToken ? "list" : "done" };
  }

  const { added, relevant } = await ingestIds(db, gmail, run, ids);
  await bumpRun(db, runId, { messagesScanned: ids.length, messagesNew: added, messagesRelevant: relevant });

  if (kind === "backfill") {
    const conn = await getConnection(db, run.userId);
    if (conn?.backfillState) {
      const state: BackfillState = { ...conn.backfillState, pageToken: cursor.listPageToken ?? null, scanned: conn.backfillState.scanned + ids.length, done: cursor.stage === "done" };
      await db.update(gmailConnections).set({ backfillState: state, updatedAt: new Date() }).where(eq(gmailConnections.userId, run.userId));
    }
  }

  if (cursor.stage === "done") {
    // Commit the history id only after every message up to that point is durably stored.
    const conn = await getConnection(db, run.userId);
    let committed: string | null;
    if (kind === "incremental") committed = finalHistoryId ?? cursor.anchorHistoryId ?? null;
    else if (kind === "backfill" && conn?.historyId) committed = conn.historyId; // never move an existing checkpoint backwards
    else committed = cursor.anchorHistoryId ?? null;
    await db.update(gmailConnections).set({ historyId: committed ?? conn?.historyId ?? null, updatedAt: new Date() }).where(eq(gmailConnections.userId, run.userId));
    await saveCursor(db, runId, cursor, { historyIdEnd: committed ?? null });
    return { done: true, scanned: ids.length, added, relevant };
  }
  await saveCursor(db, runId, cursor);
  return { done: false, scanned: ids.length, added, relevant };
}
