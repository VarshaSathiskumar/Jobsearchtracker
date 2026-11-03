import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { applicationEvents, applications, dashboardSummaries, gmailMessages, jobAlerts, reviewItems, syncRuns } from "@/db/schema";

const n = (v: unknown) => Number(v ?? 0);

export type Totals = {
  applications: number;
  rejections: number;
  callbacks: number;
  interviews: number;
  offers: number;
  jobAlerts: number;
  needsReview: number;
  otherEmails: number;
};

/** All dashboard numbers come from SQL aggregates. No LLM is involved. */
export async function getTotals(db: Db, userId: string): Promise<Totals> {
  const [[a], [j], [r], [o]] = await Promise.all([
    db
    .select({
      total: sql<number>`count(*)`,
      rejected: sql<number>`count(*) filter (where ${applications.status} = 'rejected')`,
      callbacks: sql<number>`count(*) filter (where ${applications.status} in ('callback','assessment'))`,
      interviews: sql<number>`count(*) filter (where ${applications.status} = 'interview_scheduled')`,
      offers: sql<number>`count(*) filter (where ${applications.status} = 'offer')`,
    })
    .from(applications)
    .where(eq(applications.userId, userId)),
    db
      .select({ c: sql<number>`count(distinct coalesce(${jobAlerts.gmailMessageId}::text, ${jobAlerts.id}::text))` })
      .from(jobAlerts)
      .where(eq(jobAlerts.userId, userId)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(reviewItems)
      .where(and(eq(reviewItems.userId, userId), eq(reviewItems.status, "open"))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(gmailMessages)
      .where(and(eq(gmailMessages.userId, userId), eq(gmailMessages.classification, "other_career"), eq(gmailMessages.processingStatus, "processed"))),
  ]);
  return {
    applications: n(a.total),
    rejections: n(a.rejected),
    callbacks: n(a.callbacks),
    interviews: n(a.interviews),
    offers: n(a.offers),
    jobAlerts: n(j.c),
    needsReview: n(r.c),
    otherEmails: n(o.c),
  };
}

export type NewCounts = {
  applications: number;
  rejections: number;
  callbacks: number;
  interviews: number;
  offers: number;
  jobAlerts: number;
  needsReview: number;
};

export const EMPTY_NEW: NewCounts = { applications: 0, rejections: 0, callbacks: 0, interviews: 0, offers: 0, jobAlerts: 0, needsReview: 0 };

/** Items first detected during one sync run, counted from the records tagged with that run. */
export async function getNewCounts(db: Db, userId: string, runId: string): Promise<NewCounts> {
  const [[ev], [ap], [al], [rv]] = await Promise.all([
    db
    .select({
      rejections: sql<number>`count(distinct ${applicationEvents.id}) filter (where ${applicationEvents.eventType} = 'rejected')`,
      callbacks: sql<number>`count(distinct ${applicationEvents.id}) filter (where ${applicationEvents.eventType} in ('callback','assessment'))`,
      interviews: sql<number>`count(distinct ${applicationEvents.id}) filter (where ${applicationEvents.eventType} in ('interview_scheduled','interview_rescheduled'))`,
      offers: sql<number>`count(distinct ${applicationEvents.id}) filter (where ${applicationEvents.eventType} = 'offer')`,
    })
    .from(applicationEvents)
    .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.syncRunId, runId))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.syncRunId, runId))),
    db
      .select({ c: sql<number>`count(distinct coalesce(${jobAlerts.gmailMessageId}::text, ${jobAlerts.id}::text))` })
      .from(jobAlerts)
      .where(and(eq(jobAlerts.userId, userId), eq(jobAlerts.syncRunId, runId))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(reviewItems)
      .where(and(eq(reviewItems.userId, userId), eq(reviewItems.syncRunId, runId))),
  ]);
  return {
    applications: n(ap.c),
    rejections: n(ev.rejections),
    callbacks: n(ev.callbacks),
    interviews: n(ev.interviews),
    offers: n(ev.offers),
    jobAlerts: n(al.c),
    needsReview: n(rv.c),
  };
}

export async function getStatusDistribution(db: Db, userId: string) {
  const rows = await db
    .select({ status: applications.status, count: sql<number>`count(*)` })
    .from(applications)
    .where(eq(applications.userId, userId))
    .groupBy(applications.status);
  return rows.map((r) => ({ status: r.status, count: n(r.count) }));
}

/** Weekly applications vs. responses for the last `weeks` weeks (zero filled). */
export async function getTrend(db: Db, userId: string, weeks = 12) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - weeks * 7);
  const [apps, evs] = await Promise.all([
    db
    .select({ week: sql<string>`to_char(date_trunc('week', ${applications.appliedAt}), 'YYYY-MM-DD')`, c: sql<number>`count(*)` })
    .from(applications)
    .where(and(eq(applications.userId, userId), gte(applications.appliedAt, since)))
    .groupBy(sql`1`),
    db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${applicationEvents.occurredAt}), 'YYYY-MM-DD')`,
      type: applicationEvents.eventType,
      c: sql<number>`count(*)`,
    })
    .from(applicationEvents)
    .where(and(eq(applicationEvents.userId, userId), gte(applicationEvents.occurredAt, since), inArray(applicationEvents.eventType, ["rejected", "callback", "assessment", "interview_scheduled", "interview_rescheduled", "offer"])))
    .groupBy(sql`1`, applicationEvents.eventType),
  ]);

  const monday = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const buckets = new Map<string, { week: string; applied: number; rejected: number; progressed: number }>();
  const start = new Date(monday(since));
  for (let i = 0; i <= weeks; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const k = d.toISOString().slice(0, 10);
    buckets.set(k, { week: k, applied: 0, rejected: 0, progressed: 0 });
  }
  for (const r of apps) if (buckets.has(r.week)) buckets.get(r.week)!.applied += n(r.c);
  for (const r of evs) {
    const b = buckets.get(r.week);
    if (!b) continue;
    if (r.type === "rejected") b.rejected += n(r.c);
    else b.progressed += n(r.c);
  }
  return [...buckets.values()];
}

export async function getRecentActivity(db: Db, userId: string, limit = 10) {
  return db
    .select({
      id: applicationEvents.id,
      applicationId: applications.id,
      company: applications.company,
      position: applications.position,
      eventType: applicationEvents.eventType,
      occurredAt: applicationEvents.occurredAt,
      summary: applicationEvents.summary,
      isSample: applicationEvents.isSample,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .where(eq(applicationEvents.userId, userId))
    .orderBy(desc(applicationEvents.occurredAt))
    .limit(limit);
}

export async function getLatestSummary(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(dashboardSummaries)
    .where(eq(dashboardSummaries.userId, userId))
    .orderBy(desc(dashboardSummaries.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getLastFinishedRun(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.status, ["completed", "partial"])))
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);
  return row ?? null;
}

export async function getActiveOrLatestRun(db: Db, userId: string) {
  const [row] = await db.select().from(syncRuns).where(eq(syncRuns.userId, userId)).orderBy(desc(syncRuns.createdAt)).limit(1);
  return row ?? null;
}

export async function hasSampleData(db: Db, userId: string): Promise<boolean> {
  const [r] = await db
    .select({ c: sql<number>`count(*)` })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.isSample, true)));
  return n(r.c) > 0;
}
