import { and, eq } from "drizzle-orm";
import type { AgentContext } from "@/lib/agents/context";
import type { ApplicationExtraction, ClassificationOutput, JobAlertExtraction, ResponseExtraction, ResponseOutcome } from "@/lib/agents/schemas";
import { REVIEW_CONFIDENCE_THRESHOLD, type EventType } from "@/lib/constants";
import { gmailMessages, reviewItems, type GmailMessage } from "@/db/schema";
import type { Db } from "@/db";
import { matchApplication, resolveMatch, type MatchQuery } from "@/lib/matching";
import { loadCandidates, recordResponseEvent, upsertApplicationFromConfirmation } from "@/lib/store/applications";
import { saveJobAlerts } from "@/lib/store/alerts";
import { bumpRun, createReviewItem, finishMessage, setMessageClassification } from "@/lib/store/messages";

/**
 * Deterministic handlers. Agents only produce validated, structured proposals. Everything that
 * touches the database, applies status rules or decides between "apply" and "review" lives here.
 */

export type NextAgent = "application_agent" | "response_agent" | "job_alerts_agent" | "none";

const NEXT_BY_CLASS: Partial<Record<ClassificationOutput["classification"], NextAgent>> = {
  application_confirmation: "application_agent",
  rejection: "response_agent",
  recruiter_callback: "response_agent",
  interview_scheduling: "response_agent",
  job_alert: "job_alerts_agent",
};

export function nextAgentFor(c: ClassificationOutput["classification"]): NextAgent {
  return NEXT_BY_CLASS[c] ?? "none";
}

export const OUTCOME_TO_EVENT: Record<ResponseOutcome, EventType> = {
  rejection: "rejected",
  recruiter_callback: "callback",
  assessment: "assessment",
  interview_invitation: "interview_scheduled",
  interview_rescheduled: "interview_rescheduled",
  offer: "offer",
  withdrawn: "withdrawn",
  other_update: "update",
};

export async function handleClassification(
  ctx: AgentContext,
  msg: GmailMessage,
  out: ClassificationOutput,
  source: "agent" | "shortcut",
): Promise<{ next: NextAgent; status: string }> {
  const { db, userId, runId } = ctx;
  const c = out.classification;
  const floor = c === "irrelevant" ? 0.5 : REVIEW_CONFIDENCE_THRESHOLD;

  await setMessageClassification(db, msg.id, { classification: c, confidence: out.confidence, source });

  if (out.confidence < floor) {
    const added = await createReviewItem(db, {
      userId,
      messageRowId: msg.id,
      reason: "low_confidence",
      proposedClassification: c,
      note: out.reasoning,
      runId,
    });
    if (added) await bumpRun(db, runId, { reviewAdded: 1, messagesProcessed: 1 });
    return { next: "none", status: "needs_review" };
  }
  if (c === "irrelevant") {
    await finishMessage(db, msg.id, "skipped");
    await bumpRun(db, runId, { messagesProcessed: 1 });
    return { next: "none", status: "skipped" };
  }
  if (c === "other_career") {
    await finishMessage(db, msg.id, "processed");
    await bumpRun(db, runId, { messagesProcessed: 1 });
    return { next: "none", status: "stored_as_other" };
  }
  return { next: NEXT_BY_CLASS[c] ?? "none", status: "classified" };
}

function parseApplicationDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return fallback;
  const dayMs = 86_400_000;
  // An application cannot be confirmed before it was made, or long before the email arrived.
  if (d.getTime() > fallback.getTime() + dayMs || d.getTime() < fallback.getTime() - 90 * dayMs) return fallback;
  return d;
}

export async function handleApplicationExtraction(ctx: AgentContext, msg: GmailMessage, ext: ApplicationExtraction): Promise<string> {
  const { db, userId, runId } = ctx;
  if (msg.classification !== "application_confirmation") return "error: message is not classified as an application confirmation";

  const complete = ext.isApplicationConfirmation && ext.company?.trim() && ext.jobTitle?.trim();
  if (!complete || ext.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
    const added = await createReviewItem(db, {
      userId,
      messageRowId: msg.id,
      reason: complete ? "low_confidence" : "extraction_failed",
      proposedClassification: "application_confirmation",
      proposedPayload: { kind: "application", ...ext },
      note: complete ? "Low confidence extraction" : "Company or job title could not be extracted",
      runId,
    });
    if (added) await bumpRun(db, runId, { reviewAdded: 1, messagesProcessed: 1 });
    return "sent to needs review";
  }

  const result = await upsertApplicationFromConfirmation(db, {
    userId,
    company: ext.company!,
    position: ext.jobTitle!,
    jobId: ext.jobId,
    source: ext.source,
    appliedAt: parseApplicationDate(ext.applicationDate, msg.internalDate),
    threadId: msg.threadId,
    messageRowId: msg.id,
    confidence: ext.confidence,
    runId,
  });
  await finishMessage(db, msg.id, "processed");
  await bumpRun(db, runId, {
    messagesProcessed: 1,
    applicationsAdded: result.created ? 1 : 0,
    applicationsUpdated: result.created ? 0 : 1,
    eventsAdded: result.eventAdded ? 1 : 0,
  });
  return result.created ? "application created" : "existing application updated";
}

export function matchQueryFor(msg: Pick<GmailMessage, "threadId">, ext: Pick<ResponseExtraction, "company" | "jobTitle" | "jobId">): MatchQuery {
  return { company: ext.company?.trim() || null, position: ext.jobTitle?.trim() || null, jobId: ext.jobId?.trim() || null, threadId: msg.threadId };
}

export async function handleResponseExtraction(ctx: AgentContext, msg: GmailMessage, ext: ResponseExtraction): Promise<string> {
  const { db, userId, runId } = ctx;
  if (!["rejection", "recruiter_callback", "interview_scheduling"].includes(msg.classification ?? "")) {
    return "error: message is not classified as an employer response";
  }
  const payload = { kind: "response", ...ext };

  if (ext.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
    const added = await createReviewItem(db, {
      userId, messageRowId: msg.id, reason: "low_confidence", proposedClassification: msg.classification,
      proposedPayload: payload, note: "Low confidence outcome extraction", runId,
    });
    if (added) await bumpRun(db, runId, { reviewAdded: 1, messagesProcessed: 1 });
    return "sent to needs review (low confidence)";
  }

  const query = matchQueryFor(msg, ext);
  const candidates = await loadCandidates(db, userId, query);
  const deterministic = matchApplication(query, candidates);
  const resolved = resolveMatch(
    deterministic,
    ext.matchedApplicationId ? { applicationId: ext.matchedApplicationId, confidence: ext.matchConfidence, evidence: ext.matchEvidence } : null,
    query,
    candidates,
  );

  if (resolved.kind !== "matched") {
    const ids = resolved.kind === "ambiguous" ? resolved.candidateIds : [];
    const added = await createReviewItem(db, {
      userId, messageRowId: msg.id,
      reason: resolved.kind === "ambiguous" ? "ambiguous_match" : "unmatched",
      proposedClassification: msg.classification,
      proposedPayload: payload,
      candidateApplicationIds: ids,
      note: resolved.reasons.join("; "),
      runId,
    });
    if (added) await bumpRun(db, runId, { reviewAdded: 1, messagesProcessed: 1 });
    return `sent to needs review (${resolved.kind})`;
  }

  const summary = [ext.summary, ext.interviewDetails].filter(Boolean).join(" | ").slice(0, 300);
  const r = await recordResponseEvent(db, {
    userId,
    applicationId: resolved.applicationId,
    messageRowId: msg.id,
    eventType: OUTCOME_TO_EVENT[ext.outcome],
    occurredAt: msg.internalDate,
    confidence: ext.confidence,
    summary,
    runId,
  });
  await finishMessage(db, msg.id, "processed");
  await bumpRun(db, runId, {
    messagesProcessed: 1,
    eventsAdded: r.eventAdded ? 1 : 0,
    applicationsUpdated: r.eventAdded ? 1 : 0,
  });
  return `recorded ${OUTCOME_TO_EVENT[ext.outcome]} on one application`;
}

export async function handleJobAlertExtraction(ctx: AgentContext, msg: GmailMessage, ext: JobAlertExtraction): Promise<string> {
  const { db, userId, runId } = ctx;
  if (msg.classification !== "job_alert") return "error: message is not classified as a job alert";

  // URL guard: only links that were actually present in the email may be stored.
  const known = new Set((msg.links ?? []).map((l) => l.url));
  const items = ext.items
    .filter((i) => i.title.trim())
    .map((i) => ({
      company: i.company?.trim() || null,
      position: i.title.trim(),
      location: i.location?.trim() || null,
      url: i.url && known.has(i.url) ? i.url : null,
    }));

  const added = await saveJobAlerts(db, {
    userId, messageRowId: msg.id, receivedAt: msg.internalDate, source: ext.alertSource, items, runId,
  });
  await finishMessage(db, msg.id, "processed");
  await bumpRun(db, runId, { messagesProcessed: 1, alertsAdded: added });
  return `stored ${added} advertised roles`;
}

/**
 * Re-evaluates open unmatched/ambiguous responses with the deterministic matcher only. Applications
 * created later in the same run (or manually) can resolve items that had no match when first seen.
 */
export async function rematchOpenReviews(db: Db, userId: string, runId: string): Promise<number> {
  const open = await db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.userId, userId), eq(reviewItems.status, "open")));
  let resolved = 0;
  for (const item of open) {
    const p = item.proposedPayload as (Partial<ResponseExtraction> & { kind?: string }) | null;
    if (!p || p.kind !== "response" || !p.outcome) continue;
    if (item.reason !== "unmatched" && item.reason !== "ambiguous_match") continue;
    const [msg] = await db.select().from(gmailMessages).where(eq(gmailMessages.id, item.gmailMessageId)).limit(1);
    if (!msg) continue;
    const query = matchQueryFor(msg, { company: p.company ?? null, jobTitle: p.jobTitle ?? null, jobId: p.jobId ?? null });
    const candidates = await loadCandidates(db, userId, query);
    const m = matchApplication(query, candidates);
    if (m.kind !== "matched") continue;
    await recordResponseEvent(db, {
      userId, applicationId: m.applicationId, messageRowId: msg.id,
      eventType: OUTCOME_TO_EVENT[p.outcome], occurredAt: msg.internalDate,
      confidence: p.confidence ?? null, summary: p.summary ?? null, runId,
    });
    await db.update(reviewItems).set({ status: "resolved", resolvedApplicationId: m.applicationId, resolvedAt: new Date() }).where(eq(reviewItems.id, item.id));
    await finishMessage(db, msg.id, "processed");
    resolved++;
  }
  return resolved;
}
