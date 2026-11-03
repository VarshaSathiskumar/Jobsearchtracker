import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Mail } from "lucide-react";
import { getDb } from "@/db";
import { gmailMessages } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SimpleSearch } from "@/components/simple-search";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConnection } from "@/lib/gmail/connection";
import { gmailMessageUrl } from "@/lib/gmail/client";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Other Emails" };
const PAGE = 25;

export default async function OtherEmailsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireUser();
  const { q = "", page: pageStr } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageStr ?? "1", 10) || 1);
  const db = getDb();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = and(
    eq(gmailMessages.userId, user.id),
    eq(gmailMessages.classification, "other_career"),
    eq(gmailMessages.processingStatus, "processed"),
    q ? or(ilike(gmailMessages.subject, like), ilike(gmailMessages.fromEmail, like), ilike(gmailMessages.fromName, like)) : undefined,
  );
  const [rows, [{ total }], conn] = await Promise.all([
    db.select().from(gmailMessages).where(where).orderBy(desc(gmailMessages.internalDate)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)` }).from(gmailMessages).where(where),
    getConnection(db, user.id),
  ]);
  const count = Number(total);
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Other Emails" description="Career-related emails that are not applications, rejections, callbacks, interviews or job alerts." />
      <div className="mb-4"><SimpleSearch placeholder="Search sender or subject" /></div>
      {rows.length === 0 ? (
        <EmptyState icon={Mail} title={q ? "No emails match your search" : "No other career emails"} description="Newsletters from employers, career events and similar mail will be listed here." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader className="bg-muted/50"><TableRow><TableHead>Subject</TableHead><TableHead className="hidden md:table-cell">From</TableHead><TableHead>Received</TableHead><TableHead className="text-right">Gmail</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="max-w-96"><p className="truncate font-medium">{m.subject || "(no subject)"}</p><p className="truncate text-xs text-muted-foreground">{m.snippet}</p></TableCell>
                  <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">{m.fromName ?? m.fromEmail}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground"><Time value={m.internalDate} /></TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="outline" className="gap-1.5"><a href={gmailMessageUrl(conn?.googleEmail, m.gmailMessageId)} target="_blank" rel="noopener noreferrer"><Mail className="size-3.5" aria-hidden /> Open</a></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>{count} email{count === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm"><Link href={link(Math.max(1, page - 1))} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>Prev</Link></Button>
              <span className="tabular-nums">Page {page} of {pages}</span>
              <Button asChild variant="outline" size="sm"><Link href={link(Math.min(pages, page + 1))} className={page >= pages ? "pointer-events-none opacity-50" : ""}>Next</Link></Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
