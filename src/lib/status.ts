import type { ApplicationStatus, EventType } from "./constants";

export type StatusEvent = {
  eventType: EventType;
  /** Explicit target status, used by manual edits. */
  toStatus?: ApplicationStatus | null;
  occurredAt: Date;
  confidence?: number | null;
};

const RANK: Record<ApplicationStatus, number> = {
  applied: 0,
  callback: 1,
  assessment: 2,
  interview_scheduled: 3,
  offer: 4,
  rejected: 5,
  withdrawn: 5,
};

export function statusRank(s: ApplicationStatus): number {
  return RANK[s];
}

/** Maps an event to the status it argues for. Informational updates argue for nothing. */
export function eventTargetStatus(e: Pick<StatusEvent, "eventType" | "toStatus">): ApplicationStatus | null {
  switch (e.eventType) {
    case "applied":
      return "applied";
    case "rejected":
      return "rejected";
    case "callback":
      return "callback";
    case "assessment":
      return "assessment";
    case "interview_scheduled":
    case "interview_rescheduled":
      return "interview_scheduled";
    case "offer":
      return "offer";
    case "withdrawn":
      return "withdrawn";
    case "manual_edit":
      return e.toStatus ?? null;
    case "update":
      return null;
  }
}

/**
 * Pure transition function.
 *  - Manual edits always win and reset the pipeline.
 *  - Forward progress is accepted, backwards moves are ignored (a late "we received your application"
 *    email cannot undo an interview).
 *  - Rejection and withdrawal are terminal, except for a strictly later offer, interview or
 *    reconsideration with enough confidence (companies do reopen candidacies).
 *  - A rejection overrides any in-progress state, including an offer (rescinded).
 */
export function nextStatus(current: ApplicationStatus, event: StatusEvent): ApplicationStatus {
  const target = eventTargetStatus(event);
  if (!target) return current;
  if (event.eventType === "manual_edit") return target;
  if (target === current) return current;

  if (current === "rejected" || current === "withdrawn") {
    const reopening = target === "offer" || target === "interview_scheduled";
    return reopening && (event.confidence ?? 1) >= 0.85 ? target : current;
  }
  if (target === "rejected" || target === "withdrawn") return target;
  return RANK[target] > RANK[current] ? target : current;
}

/**
 * Derives the current status from the complete event history. Events are sorted chronologically
 * so that out-of-order processing (a backfill reads newest mail first) gives the same answer
 * as in-order processing.
 */
export function deriveStatus(events: StatusEvent[]): ApplicationStatus {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let status: ApplicationStatus = "applied";
  for (const e of ordered) status = nextStatus(status, e);
  return status;
}

/** Returns the resulting status after each event, in chronological order. */
export function statusTimeline(events: (StatusEvent & { id: string })[]): Map<string, ApplicationStatus> {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const out = new Map<string, ApplicationStatus>();
  let status: ApplicationStatus = "applied";
  for (const e of ordered) {
    status = nextStatus(status, e);
    out.set(e.id, status);
  }
  return out;
}
