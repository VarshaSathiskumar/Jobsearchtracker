import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { applications, gmailMessages, reviewItems } from "@/db/schema";
import type { EmailClassification, EventType } from "@/lib/constants";
import { finishMessage } from "./messages";
import { recordResponseEvent, upsertApplicationFromConfirmation } from "./applications";
import { OUTCOME_TO_EVENT } from "@/lib/pipeline/handlers";
import type { ResponseOutcome } from "@/lib/agents/schemas";

export type ResolveAction =
  | { action: "assign"; applicationId: string; eventType?: EventType }
  | { action: "create"; company: string; position: string; jobId?: string | null; source?: string | null; eventType?: EventType }
  | { action: "other" }
  | { action: "dismiss" };

const DEFAULT_EVENT: Partial<Record<EmailClassification, EventType>> = {
  rejection: "rejected",
  recruiter_callback: "callback",
  interview_scheduling: "interview_scheduled",
};

export class ReviewError extends Error {}

/** Applies a human decision to a Needs Review item through the same deterministic status rules. */
export async function resolveReviewItem(db: Db, userId: string, reviewId: string, input: ResolveAction): Promise<{ applicationId: string | null }> {
  const [item] = await db.select().from(reviewItems).where(and(eq(reviewItems.id, reviewId), eq(reviewItems.userId, userId))).limit(1);
  if (!item) throw new ReviewError("Review item not found");
  if (item.status !== "open") throw new ReviewError("Review item is already resolved");
  const [msg] = await db.select().from(gmailMessages).where(eq(gmailMessages.id, item.gmailMessageId)).limit(1);
  if (!msg) throw new ReviewError("Email record not found");

  const payload = item.proposedPayload as { outcome?: ResponseOutcome } | null;
  const inferred: EventType | undefined =
    (payload?.outcome ? OUTCOME_TO_EVENT[payload.outcome] : undefined) ?? (item.proposedClassification ? DEFAULT_EVENT[item.proposedClassification] : undefined);

  const close = async (status: "resolved" | "dismissed", applicationId: string | null) => {
    await db.update(reviewItems).set({ status, resolvedApplicationId: applicationId, resolvedAt: new Date() }).where(eq(reviewItems.id, reviewId));
  };

  switch (input.action) {
    case "dismiss": {
      await finishMessage(db, msg.id, "skipped");
      await close("dismissed", null);
      return { applicationId: null };
    }
    case "other": {
      await db.update(gmailMessages).set({ classification: "other_career", classificationSource: "user" }).where(eq(gmailMessages.id, msg.id));
      await finishMessage(db, msg.id, "processed");
      await close("resolved", null);
      return { applicationId: null };
    }
    case "assign": {
      const [app] = await db.select().from(applications).where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId))).limit(1);
      if (!app) throw new ReviewError("Application not found");
      const eventType = input.eventType ?? inferred ?? "update";
      await recordResponseEvent(db, {
        userId, applicationId: app.id, messageRowId: msg.id, eventType, occurredAt: msg.internalDate,
        confidence: 1, summary: "Assigned manually from Needs Review", actor: "user",
      });
      await finishMessage(db, msg.id, "processed");
      await close("resolved", app.id);
      return { applicationId: app.id };
    }
    case "create": {
      const created = await upsertApplicationFromConfirmation(db, {
        userId, company: input.company, position: input.position, jobId: input.jobId, source: input.source,
        appliedAt: msg.internalDate, threadId: msg.threadId,
        // A confirmation email creates the application. Other emails create it without an applied event.
        messageRowId: item.proposedClassification === "application_confirmation" ? msg.id : null,
        confidence: 1, summary: "Created manually from Needs Review",
      });
      const eventType = input.eventType ?? inferred;
      if (eventType && eventType !== "applied") {
        await recordResponseEvent(db, {
          userId, applicationId: created.application.id, messageRowId: msg.id, eventType, occurredAt: msg.internalDate,
          confidence: 1, summary: "Recorded manually from Needs Review", actor: "user",
        });
      }
      await finishMessage(db, msg.id, "processed");
      await close("resolved", created.application.id);
      return { applicationId: created.application.id };
    }
  }
}
