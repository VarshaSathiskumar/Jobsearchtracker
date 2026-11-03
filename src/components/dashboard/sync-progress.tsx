"use client";

import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSync } from "./sync-provider";

const PHASES: Record<string, string> = {
  queued: "Waiting for the background worker to start",
  ingest: "Reading new mail from Gmail",
  classify: "AI agents are classifying and filing emails",
  summarize: "Writing the summary of what changed",
  done: "Finished",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24">
      <dd className="text-lg font-semibold tabular-nums leading-tight">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

export function SyncProgress() {
  const { run, active, dismissed, dismiss, start } = useSync();
  if (!run || (!active && dismissed)) return null;

  const pct = !active
    ? 100
    : run.phase === "ingest"
      ? 12
      : run.phase === "classify"
        ? Math.round(25 + 65 * Math.min(1, run.processed / Math.max(run.relevant, 1)))
        : run.phase === "summarize"
          ? 95
          : 4;

  const tone = active ? "border-indigo-200 bg-indigo-50/70" : run.status === "completed" ? "border-emerald-200 bg-emerald-50/70" : run.status === "partial" ? "border-amber-200 bg-amber-50/70" : "border-rose-200 bg-rose-50/70";
  const Icon = active ? Loader2 : run.status === "completed" ? CheckCircle2 : run.status === "partial" ? AlertTriangle : XCircle;
  const title = active
    ? PHASES[run.phase] ?? "Syncing"
    : run.status === "completed"
      ? "Sync complete. Dashboard updated."
      : run.status === "partial"
        ? "Sync finished with some issues"
        : "Sync failed";

  return (
    <section role="status" aria-live="polite" className={`mx-4 mt-4 rounded-xl border p-4 sm:mx-6 ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${active ? "animate-spin text-indigo-600" : run.status === "completed" ? "text-emerald-600" : run.status === "partial" ? "text-amber-600" : "text-rose-600"}`} aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            {run.kind === "backfill" && active && <p className="text-xs text-muted-foreground">Historical backfill. This can take a while and keeps running if you close this tab.</p>}
            {run.kind === "rescan" && active && <p className="text-xs text-muted-foreground">Gmail history expired, rescanning recent mail safely.</p>}
            {!active && run.error && <p className="text-sm text-muted-foreground">{run.error}</p>}
          </div>
          <Progress value={pct} aria-label="Sync progress" className="h-1.5" />
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Stat label="Emails scanned" value={run.scanned} />
            <Stat label="Records added" value={run.added} />
            <Stat label="Records updated" value={run.updated} />
            <Stat label="Pending review" value={run.pendingReview} />
          </dl>
        </div>
        {!active && (
          <div className="flex items-center gap-1">
            {run.status !== "completed" && (
              <Button size="sm" variant="outline" onClick={() => start({ mode: "refresh" })}>
                {run.status === "partial" ? "Resume" : "Retry"}
              </Button>
            )}
            <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
              <X className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
