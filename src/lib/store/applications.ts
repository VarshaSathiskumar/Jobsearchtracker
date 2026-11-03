import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { applicationEvents, applications, gmailMessages, type Application } from "@/db/schema";
import type { ApplicationStatus, EventType } from "@/lib/constants";
import { companiesMatch, dedupeKey, normalizeCompany, normalizeJobId, normalizeTitle } from "@/lib/normalize";
import { deriveStatus, statusTimeline } from "@/lib/status";
import type { CandidateApplication } from "@/lib/matching";

export class DuplicateApplicationError extends Error {
  constructor() {
    super("An application with the same company and role already exists");
    this.name = "DuplicateApplicationError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Recomputes status for one application from its complete, chronologically ordered history. */
export async function recomputeStatus(db: Db, applicationId: string): Promise<{ status: ApplicationStatus; changed: boolean }> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new Error("Application not found");
  const events = await db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(asc(applicationEvents.occurredAt));

  const mapped = events.map((e) => ({ id: e.id, eventType: e.eventType, toStatus: e.toStatus, occurredAt: e.occurredAt, confidence: e.confidence }));
  const status = deriveStatus(mapped);
  const timeline = statusTimeline(mapped);

  for (const e of events) {
    const resulting = timeline.get(e.id) ?? null;
    if (e.resultingStatus !== resulting) {
      await db.update(applicationEvents).set({ resultingStatus: resulting }).where(eq(applicationEvents.id, e.id));
    }
  }

  // The status timestamp is the moment of the last event that actually moved the status.
  let statusUpdatedAt = app.appliedAt;
  let prev: ApplicationStatus | null = null;
  for (const e of events) {
    const r = timeline.get(e.id) ?? null;
    if (r && r !== prev) statusUpdatedAt = e.occurredAt;
    prev = r;
  }
  const lastActivityAt = events.length ? events[events.length - 1].occurredAt : app.appliedAt;

  const changed = app.status !== status;
  await db
    .update(applications)
    .set({ status, statusUpdatedAt, lastActivityAt, updatedAt: new Date() })
    .where(eq(applications.id, applicationId));
  return { status, changed };
}

export type ApplicationUpsertInput = {
  userId: string;
  company: string;
  position: string;
  jobId?: string | null;
  source?: string | null;
  appliedAt: Date;
  threadId?: string | null;
  messageRowId?: string | null;
  confidence?: number | null;
  summary?: string | null;
  runId?: string | null;
};

/**
 * Creates the application for a confirmation email or merges into the existing record. Safe to retry:
 * the (user, dedupe_key) and (application, message) unique constraints make every step idempotent.
 */
export async function upsertApplicationFromConfirmation(
  db: Db,
  input: ApplicationUpsertInput,
): Promise<{ application: Application; created: boolean; eventAdded: boolean }> {
  const companyKey = normalizeCompany(input.company);
  const positionKey = normalizeTitle(input.position);
  const key = dedupeKey(input);
  const jobId = input.jobId?.trim() || null;

  return db.transaction(async (tx) => {
    const sameCompany = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, input.userId), eq(applications.companyKey, companyKey)));

    // Duplicate detection beyond the dedupe key: same job id, or same normalized title, at the company.
    const existing =
      sameCompany.find((a) => a.dedupeKey === key) ??
      (jobId ? sameCompany.find((a) => normalizeJobId(a.jobId) === normalizeJobId(jobId)) : undefined) ??
      sameCompany.find((a) => a.positionKey === positionKey && (!a.jobId || !jobId || normalizeJobId(a.jobId) === normalizeJobId(jobId)));

    let app: Application;
    let created = false;
    if (existing) {
      const patch: Partial<typeof applications.$inferInsert> = { updatedAt: new Date() };
      if (!existing.jobId && jobId) patch.jobId = jobId;
      if (!existing.source && input.source) patch.source = input.source;
      if (!existing.threadId && input.threadId) patch.threadId = input.threadId;
      if (!existing.firstMessageId && input.messageRowId) patch.firstMessageId = input.messageRowId;
      if (input.appliedAt < existing.appliedAt && !existing.manuallyEdited) patch.appliedAt = input.appliedAt;
      const [updated] = await tx.update(applications).set(patch).where(eq(applications.id, existing.id)).returning();
      app = updated;
    } else {
      const inserted = await tx
        .insert(applications)
        .values({
          userId: input.userId,
          company: input.company.trim(),
          companyKey,
          position: input.position.trim(),
          positionKey,
          jobId,
          source: input.source ?? null,
          appliedAt: input.appliedAt,
          status: "applied",
          statusUpdatedAt: input.appliedAt,
          lastActivityAt: input.appliedAt,
          threadId: input.threadId ?? null,
          firstMessageId: input.messageRowId ?? null,
          dedupeKey: key,
          syncRunId: input.runId ?? null,
        })
        .onConflictDoNothing({ target: [applications.userId, applications.dedupeKey] })
        .returning();
      if (inserted[0]) {
        app = inserted[0];
        created = true;
      } else {
        const [row] = await tx
          .select()
          .from(applications)
          .where(and(eq(applications.userId, input.userId), eq(applications.dedupeKey, key)))
          .limit(1);
        app = row;
      }
    }

    let eventAdded = false;
    if (input.messageRowId) {
      const ev = await tx
        .insert(applicationEvents)
        .values({
          userId: input.userId,
          applicationId: app.id,
          gmailMessageId: input.messageRowId,
          eventType: "applied",
          occurredAt: input.appliedAt,
          confidence: input.confidence ?? null,
          summary: input.summary ?? "Application confirmation email received",
          actor: "agent",
          syncRunId: input.runId ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: applicationEvents.id });
      eventAdded = ev.length > 0;
    }
    await recomputeStatus(tx as unknown as Db, app.id);
    const [fresh] = await tx.select().from(applications).where(eq(applications.id, app.id)).limit(1);
    return { application: fresh, created, eventAdded };
  });
}

export type ResponseEventInput = {
  userId: string;
  applicationId: string;
  messageRowId: string;
  eventType: EventType;
  occurredAt: Date;
  confidence?: number | null;
  summary?: string | null;
  runId?: string | null;
  actor?: "agent" | "user";
};

export async function recordResponseEvent(db: Db, input: ResponseEventInput) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(applicationEvents)
      .values({
        userId: input.userId,
        applicationId: input.applicationId,
        gmailMessageId: input.messageRowId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        confidence: input.confidence ?? null,
        summary: input.summary ?? null,
        actor: input.actor ?? "agent",
        syncRunId: input.runId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: applicationEvents.id });
    const result = await recomputeStatus(tx as unknown as Db, input.applicationId);
    return { eventAdded: inserted.length > 0, ...result };
  });
}

/**
 * Candidate applications (with the threads of already-linked emails) for the matcher. A single user
 * has at most a few thousand applications, so company comparison is done in code with the same
 * normalization the matcher uses, which keeps SQL and matcher behaviour from drifting apart.
 */
export async function loadCandidates(
  db: Db,
  userId: string,
  q: { company?: string | null; jobId?: string | null; threadId?: string | null },
): Promise<CandidateApplication[]> {
  const all = await db.select().from(applications).where(eq(applications.userId, userId)).limit(5000);
  const threadRows = q.threadId
    ? await db
        .select({ appId: applicationEvents.applicationId })
        .from(applicationEvents)
        .innerJoin(gmailMessages, eq(gmailMessages.id, applicationEvents.gmailMessageId))
        .where(and(eq(applicationEvents.userId, userId), eq(gmailMessages.threadId, q.threadId)))
    : [];
  const threadApps = new Set(threadRows.map((r) => r.appId));
  const qJob = normalizeJobId(q.jobId);

  const relevant = all.filter(
    (a) =>
      (q.company && companiesMatch(a.company, q.company)) ||
      (qJob && normalizeJobId(a.jobId) === qJob) ||
      threadApps.has(a.id) ||
      (q.threadId && a.threadId === q.threadId),
  );
  return relevant.map((a) => ({
    id: a.id,
    company: a.company,
    position: a.position,
    jobId: a.jobId,
    threadIds: [...new Set([...(threadApps.has(a.id) && q.threadId ? [q.threadId] : []), ...(a.threadId ? [a.threadId] : [])])],
  }));
}

// ---------- manual edits ----------

export type ManualApplicationInput = {
  company: string;
  position: string;
  jobId?: string | null;
  source?: string | null;
  appliedAt: Date;
  status?: ApplicationStatus;
  notes?: string | null;
};

export async function createApplicationManually(db: Db, userId: string, input: ManualApplicationInput) {
  try {
    return await db.transaction(async (tx) => {
      const [app] = await tx
        .insert(applications)
        .values({
          userId,
          company: input.company.trim(),
          companyKey: normalizeCompany(input.company),
          position: input.position.trim(),
          positionKey: normalizeTitle(input.position),
          jobId: input.jobId?.trim() || null,
          source: input.source?.trim() || null,
          appliedAt: input.appliedAt,
          statusUpdatedAt: input.appliedAt,
          lastActivityAt: input.appliedAt,
          notes: input.notes ?? null,
          manuallyEdited: true,
          dedupeKey: dedupeKey(input),
        })
        .returning();
      await tx.insert(applicationEvents).values({
        userId,
        applicationId: app.id,
        eventType: "applied",
        occurredAt: input.appliedAt,
        summary: "Added manually",
        actor: "user",
      });
      if (input.status && input.status !== "applied") {
        await tx.insert(applicationEvents).values({
          userId,
          applicationId: app.id,
          eventType: "manual_edit",
          toStatus: input.status,
          occurredAt: new Date(),
          summary: `Status set to ${input.status} manually`,
          actor: "user",
        });
      }
      await recomputeStatus(tx as unknown as Db, app.id);
      const [fresh] = await tx.select().from(applications).where(eq(applications.id, app.id));
      return fresh;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateApplicationError();
    throw err;
  }
}

export type ManualApplicationPatch = Partial<ManualApplicationInput>;

export async function updateApplicationManually(db: Db, userId: string, id: string, patch: ManualApplicationPatch) {
  try {
    return await db.transaction(async (tx) => {
      const [app] = await tx
        .select()
        .from(applications)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .limit(1);
      if (!app) return null;

      const company = patch.company?.trim() ?? app.company;
      const position = patch.position?.trim() ?? app.position;
      const jobId = patch.jobId === undefined ? app.jobId : patch.jobId?.trim() || null;
      const set: Partial<typeof applications.$inferInsert> = {
        company,
        companyKey: normalizeCompany(company),
        position,
        positionKey: normalizeTitle(position),
        jobId,
        dedupeKey: dedupeKey({ company, position, jobId }),
        manuallyEdited: true,
        updatedAt: new Date(),
      };
      if (patch.source !== undefined) set.source = patch.source?.trim() || null;
      if (patch.appliedAt) set.appliedAt = patch.appliedAt;
      if (patch.notes !== undefined) set.notes = patch.notes;
      await tx.update(applications).set(set).where(eq(applications.id, id));

      if (patch.status && patch.status !== app.status) {
        await tx.insert(applicationEvents).values({
          userId,
          applicationId: id,
          eventType: "manual_edit",
          toStatus: patch.status,
          occurredAt: new Date(),
          summary: `Status changed from ${app.status} to ${patch.status} manually`,
          actor: "user",
        });
      }
      await recomputeStatus(tx as unknown as Db, id);
      const [fresh] = await tx.select().from(applications).where(eq(applications.id, id));
      return fresh;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateApplicationError();
    throw err;
  }
}

export async function deleteApplication(db: Db, userId: string, id: string): Promise<boolean> {
  const r = await db.delete(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).returning({ id: applications.id });
  return r.length > 0;
}
