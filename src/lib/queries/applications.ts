import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { applicationEvents, applications, gmailMessages, type Application } from "@/db/schema";
import { APPLICATION_STATUSES, CALLBACK_STATUSES, type ApplicationStatus } from "@/lib/constants";

export type Preset = "all" | "rejections" | "callbacks" | "interviews";

export const SORT_FIELDS = ["company", "position", "appliedAt", "status", "lastActivityAt", "source"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type ApplicationFilters = {
  q: string;
  statuses: ApplicationStatus[];
  source: string;
  from: string;
  to: string;
  sort: SortField;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  preset: Preset;
};

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFilters(params: Params, preset: Preset = "all"): ApplicationFilters {
  const statuses = first(params.status)
    .split(",")
    .filter((s): s is ApplicationStatus => (APPLICATION_STATUSES as readonly string[]).includes(s));
  const sort = first(params.sort);
  const pageSize = Number(first(params.pageSize));
  return {
    q: first(params.q).trim().slice(0, 100),
    statuses,
    source: first(params.source).trim().slice(0, 60),
    from: /^\d{4}-\d{2}-\d{2}$/.test(first(params.from)) ? first(params.from) : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(first(params.to)) ? first(params.to) : "",
    sort: (SORT_FIELDS as readonly string[]).includes(sort) ? (sort as SortField) : "lastActivityAt",
    dir: first(params.dir) === "asc" ? "asc" : "desc",
    page: Math.max(1, Number.parseInt(first(params.page), 10) || 1),
    pageSize: [10, 25, 50, 100].includes(pageSize) ? pageSize : 25,
    preset,
  };
}

const SORT_COLUMNS = {
  company: applications.company,
  position: applications.position,
  appliedAt: applications.appliedAt,
  status: applications.status,
  lastActivityAt: applications.lastActivityAt,
  source: applications.source,
} as const;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereFor(userId: string, f: ApplicationFilters): SQL {
  const conds: (SQL | undefined)[] = [eq(applications.userId, userId)];
  if (f.preset === "rejections") conds.push(eq(applications.status, "rejected"));
  if (f.preset === "callbacks") conds.push(inArray(applications.status, CALLBACK_STATUSES));
  if (f.preset === "interviews") conds.push(eq(applications.status, "interview_scheduled"));
  if (f.statuses.length) conds.push(inArray(applications.status, f.statuses));
  if (f.source) conds.push(ilike(applications.source, `%${escapeLike(f.source)}%`));
  if (f.from) conds.push(gte(applications.appliedAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lte(applications.appliedAt, new Date(`${f.to}T23:59:59Z`)));
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(or(ilike(applications.company, like), ilike(applications.position, like), ilike(applications.jobId, like)));
  }
  return and(...conds)!;
}

export type ApplicationRow = Application & { latestGmailMessageId: string | null };

export async function listApplications(db: Db, userId: string, f: ApplicationFilters, opts?: { all?: boolean }) {
  const where = whereFor(userId, f);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(applications).where(where);
  const count = Number(total);

  const col = SORT_COLUMNS[f.sort];
  const order = f.dir === "asc" ? [asc(col), asc(applications.id)] : [desc(col), desc(applications.id)];
  let q = db.select().from(applications).where(where).orderBy(...order).$dynamic();
  if (!opts?.all) q = q.limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  else q = q.limit(10_000);
  const rows = await q;

  const latest = new Map<string, string>();
  if (rows.length) {
    const links = await db
      .select({ appId: applicationEvents.applicationId, gmailId: gmailMessages.gmailMessageId, at: applicationEvents.occurredAt })
      .from(applicationEvents)
      .innerJoin(gmailMessages, eq(gmailMessages.id, applicationEvents.gmailMessageId))
      .where(inArray(applicationEvents.applicationId, rows.map((r) => r.id)))
      .orderBy(desc(applicationEvents.occurredAt));
    for (const l of links) if (!latest.has(l.appId)) latest.set(l.appId, l.gmailId);
  }
  return {
    rows: rows.map((r) => ({ ...r, latestGmailMessageId: latest.get(r.id) ?? null })) as ApplicationRow[],
    total: count,
    pages: Math.max(1, Math.ceil(count / f.pageSize)),
  };
}

export async function listSources(db: Db, userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ s: applications.source }).from(applications).where(eq(applications.userId, userId));
  return rows.map((r) => r.s).filter((s): s is string => !!s).sort();
}

export async function getApplicationDetail(db: Db, userId: string, id: string) {
  const [app] = await db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).limit(1);
  if (!app) return null;
  const events = await db
    .select({
      id: applicationEvents.id,
      eventType: applicationEvents.eventType,
      resultingStatus: applicationEvents.resultingStatus,
      occurredAt: applicationEvents.occurredAt,
      summary: applicationEvents.summary,
      confidence: applicationEvents.confidence,
      actor: applicationEvents.actor,
      isSample: applicationEvents.isSample,
      gmailMessageId: gmailMessages.gmailMessageId,
      subject: gmailMessages.subject,
      fromEmail: gmailMessages.fromEmail,
      fromName: gmailMessages.fromName,
      snippet: gmailMessages.snippet,
    })
    .from(applicationEvents)
    .leftJoin(gmailMessages, eq(gmailMessages.id, applicationEvents.gmailMessageId))
    .where(eq(applicationEvents.applicationId, id))
    .orderBy(asc(applicationEvents.occurredAt));
  return { app, events };
}

/** CSV with formula-injection protection (cells beginning with = + - @ are prefixed with a quote). */
export function toCsv(rows: ApplicationRow[], accountEmail: string | null): string {
  const esc = (v: unknown) => {
    let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Company", "Position", "Applied", "Status", "Job ID", "Source", "Last update", "Gmail link", "Sample"];
  const lines = rows.map((r) =>
    [
      r.company, r.position, r.appliedAt, r.status, r.jobId, r.source, r.lastActivityAt,
      r.latestGmailMessageId ? `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail ?? "0")}/#all/${r.latestGmailMessageId}` : "",
      r.isSample ? "yes" : "no",
    ].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
