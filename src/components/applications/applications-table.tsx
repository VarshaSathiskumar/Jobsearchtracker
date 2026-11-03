import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, ChevronLeft, ChevronRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { SampleBadge, StatusBadge } from "@/components/status-badge";
import { Time } from "@/components/time";
import { ApplicationFormDialog } from "./application-form-dialog";
import { gmailMessageUrl } from "@/lib/gmail/client";
import type { ApplicationFilters, ApplicationRow, SortField } from "@/lib/queries/applications";

function qs(base: Record<string, string>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams({ ...base });
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) p.delete(k);
    else p.set(k, v);
  }
  return `?${p.toString()}`;
}

function SortHead({ field, label, filters, base, className }: { field: SortField; label: string; filters: ApplicationFilters; base: Record<string, string>; className?: string }) {
  const active = filters.sort === field;
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={qs(base, { sort: field, dir: nextDir, page: undefined })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icon className={`size-3.5 ${active ? "text-primary" : "text-muted-foreground/60"}`} aria-hidden />
      </Link>
    </TableHead>
  );
}

export function ApplicationsTable({
  rows, total, pages, filters, accountEmail, params, emptyTitle, emptyDescription,
}: {
  rows: ApplicationRow[];
  total: number;
  pages: number;
  filters: ApplicationFilters;
  accountEmail: string | null;
  params: Record<string, string>;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) {
    const filtered = Object.keys(params).some((k) => ["q", "status", "source", "from", "to"].includes(k));
    return (
      <EmptyState
        icon={Briefcase}
        title={filtered ? "No applications match these filters" : emptyTitle}
        description={filtered ? "Try clearing a filter or searching for something else." : emptyDescription}
        action={filtered ? undefined : <ApplicationFormDialog />}
      />
    );
  }

  const from = (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(total, filters.page * filters.pageSize);

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <SortHead field="company" label="Company" filters={filters} base={params} />
            <SortHead field="position" label="Position" filters={filters} base={params} />
            <SortHead field="appliedAt" label="Applied" filters={filters} base={params} />
            <SortHead field="status" label="Status" filters={filters} base={params} />
            <TableHead className="hidden xl:table-cell">Job ID</TableHead>
            <SortHead field="source" label="Source" filters={filters} base={params} className="hidden lg:table-cell" />
            <SortHead field="lastActivityAt" label="Last update" filters={filters} base={params} className="hidden md:table-cell" />
            <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id} className="group">
              <TableCell className="font-medium">
                <Link href={`/applications/${a.id}`} className="inline-flex items-center gap-2 hover:text-primary hover:underline">
                  {a.company}
                </Link>
                {a.isSample && <span className="ml-2 align-middle"><SampleBadge /></span>}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={a.position}>{a.position}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground"><Time value={a.appliedAt} /></TableCell>
              <TableCell><StatusBadge status={a.status} /></TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground xl:table-cell">{a.jobId ?? "-"}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{a.source ?? "-"}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell"><Time value={a.lastActivityAt} /></TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {a.latestGmailMessageId ? (
                    <Button asChild variant="ghost" size="icon" aria-label={`Open latest email for ${a.company} in Gmail`}>
                      <a href={gmailMessageUrl(accountEmail, a.latestGmailMessageId)} target="_blank" rel="noopener noreferrer"><Mail className="size-4" aria-hidden /></a>
                    </Button>
                  ) : (
                    <span className="grid size-9 place-items-center text-muted-foreground/40" title={a.isSample ? "Sample data has no email" : "No linked email"}><Mail className="size-4" aria-hidden /></span>
                  )}
                  <ApplicationFormDialog compact application={{ id: a.id, company: a.company, position: a.position, jobId: a.jobId, source: a.source, appliedAt: a.appliedAt.toISOString(), status: a.status, notes: a.notes }} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
        <span>Showing {from}-{to} of {total}</span>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" disabled={filters.page <= 1} aria-disabled={filters.page <= 1}>
            <Link href={qs(params, { page: String(Math.max(1, filters.page - 1)) })} aria-label="Previous page" className={filters.page <= 1 ? "pointer-events-none opacity-50" : ""}><ChevronLeft className="size-4" aria-hidden /> Prev</Link>
          </Button>
          <span className="tabular-nums">Page {filters.page} of {pages}</span>
          <Button asChild variant="outline" size="sm" disabled={filters.page >= pages} aria-disabled={filters.page >= pages}>
            <Link href={qs(params, { page: String(Math.min(pages, filters.page + 1)) })} aria-label="Next page" className={filters.page >= pages ? "pointer-events-none opacity-50" : ""}>Next <ChevronRight className="size-4" aria-hidden /></Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
