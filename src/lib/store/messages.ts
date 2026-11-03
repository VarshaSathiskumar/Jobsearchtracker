import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { gmailMessages, reviewItems, syncRuns, type GmailMessage } from "@/db/schema";
import type { EmailClassification, MessageProcessingStatus, ReviewReason } from "@/lib/constants";

export async function setMessageClassification(
  db: Db,
  id: string,
  c: { classification: EmailClassification; confidence: number; source: "agent" | "shortcut" },
) {
  await db
    .update(gmailMessages)
    .set({ classification: c.classification, classificationConfidence: c.confidence, classificationSource: c.source })
    .where(eq(gmailMessages.id, id));
}

/** Marks a message finished and drops the transient body copy so private mail is not retained. */
export async function finishMessage(db: Db, id: string, status: MessageProcessingStatus, error?: string | null) {
  await db
    .update(gmailMessages)
    .set({
      processingStatus: status,
      bodyExcerpt: null,
      links: null,
      processedAt: new Date(),
      lastError: error ?? null,
    })
    .where(eq(gmailMessages.id, id));
}

export async function bumpAttempt(db: Db, id: string, error: string): Promise<number> {
  const [row] = await db
    .update(gmailMessages)
    .set({ attempts: sql`${gmailMessages.attempts} + 1`, lastError: error.slice(0, 300) })
    .where(eq(gmailMessages.id, id))
    .returning({ attempts: gmailMessages.attempts });
  return row?.attempts ?? 0;
}

export async function getMessage(db: Db, userId: string, id: string): Promise<GmailMessage | null> {
  const [m] = await db
    .select()
    .from(gmailMessages)
    .where(and(eq(gmailMessages.id, id), eq(gmailMessages.userId, userId)))
    .limit(1);
  return m ?? null;
}

export async function createReviewItem(
  db: Db,
  args: {
    userId: string;
    messageRowId: string;
    reason: ReviewReason;
    proposedClassification?: EmailClassification | null;
    proposedPayload?: Record<string, unknown> | null;
    candidateApplicationIds?: string[];
    note?: string | null;
    runId?: string | null;
  },
): Promise<boolean> {
  const inserted = await db
    .insert(reviewItems)
    .values({
      userId: args.userId,
      gmailMessageId: args.messageRowId,
      reason: args.reason,
      proposedClassification: args.proposedClassification ?? null,
      proposedPayload: args.proposedPayload ?? null,
      candidateApplicationIds: args.candidateApplicationIds ?? [],
      note: args.note ?? null,
      syncRunId: args.runId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: reviewItems.id });
  await finishMessage(db, args.messageRowId, "review", args.note ?? args.reason);
  return inserted.length > 0;
}

export type CounterDelta = Partial<{
  messagesScanned: number;
  messagesNew: number;
  messagesRelevant: number;
  messagesProcessed: number;
  applicationsAdded: number;
  applicationsUpdated: number;
  eventsAdded: number;
  alertsAdded: number;
  reviewAdded: number;
  errorsCount: number;
}>;

/** Atomic counter increments plus a heartbeat that keeps the durable lock alive. */
export async function bumpRun(db: Db, runId: string, d: CounterDelta, extra?: Partial<typeof syncRuns.$inferInsert>) {
  const inc = (col: any, n?: number) => (n ? sql`${col} + ${n}` : undefined);
  const set: Record<string, unknown> = { heartbeatAt: new Date(), ...extra };
  const map: [keyof CounterDelta, any][] = [
    ["messagesScanned", syncRuns.messagesScanned],
    ["messagesNew", syncRuns.messagesNew],
    ["messagesRelevant", syncRuns.messagesRelevant],
    ["messagesProcessed", syncRuns.messagesProcessed],
    ["applicationsAdded", syncRuns.applicationsAdded],
    ["applicationsUpdated", syncRuns.applicationsUpdated],
    ["eventsAdded", syncRuns.eventsAdded],
    ["alertsAdded", syncRuns.alertsAdded],
    ["reviewAdded", syncRuns.reviewAdded],
    ["errorsCount", syncRuns.errorsCount],
  ];
  for (const [k, col] of map) {
    const v = inc(col, d[k]);
    if (v) set[k] = v;
  }
  await db.update(syncRuns).set(set).where(eq(syncRuns.id, runId));
}
