"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/constants";

const ALL = "__all";

export function FiltersBar({ sources, showStatus, exportPreset }: { sources: string[]; showStatus: boolean; exportPreset: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  // Debounced search so the table is not re-queried on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) push({ q: q || null });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportQs = new URLSearchParams(params.toString());
  exportQs.delete("page");
  if (exportPreset !== "all") exportQs.set("preset", exportPreset);
  const hasFilters = ["q", "status", "source", "from", "to"].some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role or job ID" className="bg-card pl-9" aria-label="Search applications" />
      </div>
      {showStatus && (
        <Select value={params.get("status") ?? ALL} onValueChange={(v) => push({ status: v === ALL ? null : v })}>
          <SelectTrigger className="w-44 bg-card" aria-label="Filter by status"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {APPLICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={params.get("source") ?? ALL} onValueChange={(v) => push({ source: v === ALL ? null : v })}>
        <SelectTrigger className="w-40 bg-card" aria-label="Filter by source"><SelectValue placeholder="All sources" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All sources</SelectItem>
          {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <label className="grid gap-0.5 text-xs text-muted-foreground">From
        <Input type="date" value={params.get("from") ?? ""} onChange={(e) => push({ from: e.target.value || null })} className="h-9 w-36 bg-card" />
      </label>
      <label className="grid gap-0.5 text-xs text-muted-foreground">To
        <Input type="date" value={params.get("to") ?? ""} onChange={(e) => push({ to: e.target.value || null })} className="h-9 w-36 bg-card" />
      </label>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); startTransition(() => router.push(pathname)); }} className="gap-1"><X className="size-4" aria-hidden /> Clear</Button>
      )}
      <Button asChild variant="outline" size="sm" className="ml-auto gap-1.5 bg-card">
        <a href={`/api/applications/export?${exportQs.toString()}`} download><Download className="size-4" aria-hidden /> Export CSV</a>
      </Button>
    </div>
  );
}
