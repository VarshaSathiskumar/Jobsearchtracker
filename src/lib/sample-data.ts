import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { applicationEvents, applications, jobAlerts } from "@/db/schema";
import type { EventType } from "@/lib/constants";
import { dedupeKey, normalizeCompany, normalizeTitle } from "@/lib/normalize";
import { alertItemKey } from "@/lib/store/alerts";
import { recomputeStatus } from "@/lib/store/applications";

type Sample = { company: string; position: string; source: string; daysAgo: number; events: { type: EventType; afterDays: number }[] };

const SAMPLES: Sample[] = [
  { company: "Northwind Labs", position: "Frontend Engineer", source: "LinkedIn", daysAgo: 52, events: [{ type: "callback", afterDays: 6 }, { type: "interview_scheduled", afterDays: 12 }, { type: "offer", afterDays: 24 }] },
  { company: "Contoso Cloud", position: "Platform Engineer", source: "Company site", daysAgo: 47, events: [{ type: "rejected", afterDays: 9 }] },
  { company: "Contoso Cloud", position: "Site Reliability Engineer", source: "Company site", daysAgo: 45, events: [{ type: "assessment", afterDays: 5 }, { type: "interview_scheduled", afterDays: 14 }] },
  { company: "Fabrikam Health", position: "Data Analyst", source: "Indeed", daysAgo: 40, events: [{ type: "rejected", afterDays: 14 }] },
  { company: "Globex Systems", position: "Senior Backend Engineer", source: "Greenhouse", daysAgo: 33, events: [{ type: "callback", afterDays: 4 }] },
  { company: "Initech", position: "Full Stack Developer", source: "LinkedIn", daysAgo: 30, events: [] },
  { company: "Umbrella Robotics", position: "Machine Learning Engineer", source: "Lever", daysAgo: 26, events: [{ type: "interview_scheduled", afterDays: 8 }] },
  { company: "Hooli Media", position: "Product Engineer", source: "Referral", daysAgo: 21, events: [{ type: "rejected", afterDays: 7 }] },
  { company: "Stark Analytics", position: "Data Engineer", source: "LinkedIn", daysAgo: 15, events: [{ type: "callback", afterDays: 3 }] },
  { company: "Wayne Logistics", position: "Software Engineer II", source: "Workday", daysAgo: 9, events: [] },
  { company: "Pied Piper", position: "Cloud Engineer", source: "Indeed", daysAgo: 4, events: [] },
];

const ALERTS = [
  { company: "Acme Robotics", position: "Staff Software Engineer", location: "Remote", source: "LinkedIn", url: "https://example.com/jobs/acme-staff-swe", daysAgo: 6 },
  { company: "Soylent Corp", position: "DevOps Engineer", location: "Austin, TX", source: "Indeed", url: "https://example.com/jobs/soylent-devops", daysAgo: 6 },
  { company: "Cyberdyne", position: "AI Engineer", location: "San Jose, CA", source: "LinkedIn", url: "https://example.com/jobs/cyberdyne-ai", daysAgo: 2 },
];

const day = 86_400_000;

export async function loadSampleData(db: Db, userId: string): Promise<number> {
  const now = Date.now();
  let created = 0;
  for (const s of SAMPLES) {
    const appliedAt = new Date(now - s.daysAgo * day);
    const [app] = await db
      .insert(applications)
      .values({
        userId, company: s.company, companyKey: normalizeCompany(s.company), position: s.position, positionKey: normalizeTitle(s.position),
        source: s.source, appliedAt, statusUpdatedAt: appliedAt, lastActivityAt: appliedAt, isSample: true,
        dedupeKey: dedupeKey({ company: s.company, position: s.position }),
      })
      .onConflictDoNothing({ target: [applications.userId, applications.dedupeKey] })
      .returning();
    if (!app) continue;
    created++;
    await db.insert(applicationEvents).values({ userId, applicationId: app.id, eventType: "applied", occurredAt: appliedAt, summary: "Sample application", actor: "system", isSample: true });
    for (const e of s.events) {
      await db.insert(applicationEvents).values({
        userId, applicationId: app.id, eventType: e.type, occurredAt: new Date(appliedAt.getTime() + e.afterDays * day),
        summary: "Sample event", actor: "system", isSample: true,
      });
    }
    await recomputeStatus(db, app.id);
  }
  for (const a of ALERTS) {
    await db
      .insert(jobAlerts)
      .values({
        userId, company: a.company, position: a.position, location: a.location, url: a.url, source: a.source,
        receivedAt: new Date(now - a.daysAgo * day), itemKey: alertItemKey({ ...a, url: a.url }), isSample: true,
      })
      .onConflictDoNothing();
  }
  return created;
}

export async function clearSampleData(db: Db, userId: string): Promise<void> {
  await db.delete(applications).where(and(eq(applications.userId, userId), eq(applications.isSample, true)));
  await db.delete(jobAlerts).where(and(eq(jobAlerts.userId, userId), eq(jobAlerts.isSample, true)));
}
