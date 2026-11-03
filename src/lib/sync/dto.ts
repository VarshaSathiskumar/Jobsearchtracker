import type { SyncRun } from "@/db/schema";

/** Client-safe view of a run. Cursors and internal ids are not exposed. */
export function runDto(r: SyncRun) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    phase: r.phase,
    scanned: r.messagesScanned,
    newMessages: r.messagesNew,
    relevant: r.messagesRelevant,
    processed: r.messagesProcessed,
    added: r.applicationsAdded + r.alertsAdded,
    applicationsAdded: r.applicationsAdded,
    updated: r.applicationsUpdated,
    alertsAdded: r.alertsAdded,
    pendingReview: r.reviewAdded,
    errors: r.errorsCount,
    error: r.error,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}
export type RunDto = ReturnType<typeof runDto>;
