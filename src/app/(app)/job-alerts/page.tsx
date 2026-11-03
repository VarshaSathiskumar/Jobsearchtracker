import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Bell, ExternalLink, Mail } from "lucide-react";
import { getDb } from "@/db";
import { gmailMessages, jobAlerts } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SampleBadge } from "@/components/status-badge";
import { Time } from "@/components/time";
import { SimpleSearch } from "@/components/simple-search";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConnection } from "@/lib/gmail/connection";
import { gmailMessageUrl } from "@/lib/gmail/client";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job Alerts" };
const PAGE = 25;

export default async function JobAlertsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireUser();
  const { q = "", page: pageStr } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageStr ?? "1", 10) || 1);
  const db = getDb();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = and(eq(jobAlerts.userId, user.id), q ? or(ilike(jobAlerts.position, like), ilike(jobAlerts.company, like), ilike(jobAlerts.location, like)) : undefined);

  const [rows, [{ total }], conn] = await Promise.all([
    db
      .select({ alert: jobAlerts, gmailId: gmailMessages.gmailMessageId })
      .from(jobAlerts)
      .leftJoin(gmailMessages, eq(gmailMessages.id, jobAlerts.gmailMessageId))
      .where(where)
      .orderBy(desc(jobAlerts.receivedAt), desc(jobAlerts.id))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)` }).from(jobAlerts).where(where),
    getConnection(db, user.id),
  ]);
  const count = Number(total);
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Job Alerts" description="Roles advertised in job-alert emails. These are recommendations, never counted as applications." />
      <div className="mb-4"><SimpleSearch placeholder="Search role, company or location" /></div>
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={q ? "No alerts match your search" : "No job alerts yet"} description={q ? "Try a different search." : "Alert emails from LinkedIn, Indeed and similar services will be listed here after a sync."} />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Role</TableHead><TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ alert: a, gmailId }) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-72 font-medium">{a.position}{a.isSample && <span className="ml-2 align-middle"><SampleBadge /></span>}</TableCell>
                  <TableCell>{a.company ?? "-"}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{a.location ?? "-"}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{a.source ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><Time value={a.receivedAt} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {a.url && (
                        <Button asChild size="sm" variant="outline" className="gap-1.5">
                          <a href={a.url} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink className="size-3.5" aria-hidden /> Posting</a>
                        </Button>
                      )}
                      {gmailId && (
                        <Button asChild size="icon" variant="ghost" aria-label="Open alert email in Gmail">
                          <a href={gmailMessageUrl(conn?.googleEmail, gmailId)} target="_blank" rel="noopener noreferrer"><Mail className="size-4" aria-hidden /></a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>{count} role{count === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm"><Link href={link(Math.max(1, page - 1))} className={page <= 1 ? "pointer-events-none opacity-50" : ""} aria-disabled={page <= 1}>Prev</Link></Button>
              <span className="tabular-nums">Page {page} of {pages}</span>
              <Button asChild variant="outline" size="sm"><Link href={link(Math.min(pages, page + 1))} className={page >= pages ? "pointer-events-none opacity-50" : ""} aria-disabled={page >= pages}>Next</Link></Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
