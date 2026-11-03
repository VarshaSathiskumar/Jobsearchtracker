"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RunDto } from "@/lib/sync/dto";
import type { ConnectionView } from "@/lib/gmail/connection";

type SyncContextValue = {
  run: RunDto | null;
  active: boolean;
  starting: boolean;
  connection: ConnectionView;
  dismissed: boolean;
  dismiss: () => void;
  start: (opts?: { mode?: "refresh" | "backfill"; after?: string; before?: string }) => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside SyncProvider");
  return ctx;
}

const isActive = (r: RunDto | null) => !!r && (r.status === "queued" || r.status === "running");

function describe(run: RunDto) {
  const parts = [`${run.scanned} emails scanned`];
  if (run.applicationsAdded) parts.push(`${run.applicationsAdded} new application${run.applicationsAdded === 1 ? "" : "s"}`);
  if (run.updated) parts.push(`${run.updated} updated`);
  if (run.alertsAdded) parts.push(`${run.alertsAdded} job alert role${run.alertsAdded === 1 ? "" : "s"}`);
  if (run.pendingReview) parts.push(`${run.pendingReview} need review`);
  return parts.join(", ");
}

export function SyncProvider({ initialRun, connection, children }: { initialRun: RunDto | null; connection: ConnectionView; children: React.ReactNode }) {
  const router = useRouter();
  const [run, setRun] = useState<RunDto | null>(initialRun);
  const [starting, setStarting] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const announced = useRef<string | null>(initialRun && !isActive(initialRun) ? initialRun.id : null);
  const active = isActive(run);

  // Poll the run while it is queued or running. This keeps working after a page reload because the
  // run lives in the database, not in this tab.
  useEffect(() => {
    if (!run || !isActive(run)) return;
    const id = run.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sync/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const { run: next } = (await res.json()) as { run: RunDto };
        if (cancelled) return;
        setRun(next);
        if (!isActive(next) && announced.current !== next.id) {
          announced.current = next.id;
          setDismissed(false);
          if (next.status === "completed") toast.success("Sync complete", { description: describe(next) });
          else if (next.status === "partial") toast.warning("Sync finished with issues", { description: next.error ?? describe(next) });
          else toast.error("Sync failed", { description: next.error ?? "Unknown error" });
          router.refresh();
        }
      } catch {
        /* transient network error, the next tick retries */
      }
    };
    const timer = setInterval(tick, 1500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [run?.id, run?.status, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback<SyncContextValue["start"]>(
    async (opts) => {
      if (starting || isActive(run)) return;
      setStarting(true);
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts ?? { mode: "refresh" }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 202 || (res.status === 409 && body.code === "sync_running")) {
          if (res.status === 409) toast.info("A sync is already running. Showing its progress.");
          setDismissed(false);
          announced.current = null;
          setRun({
            id: body.runId, kind: "incremental", status: "queued", phase: "queued", scanned: 0, newMessages: 0, relevant: 0, processed: 0,
            added: 0, applicationsAdded: 0, updated: 0, alertsAdded: 0, pendingReview: 0, errors: 0, error: null,
            createdAt: new Date().toISOString() as unknown as Date, startedAt: null, finishedAt: null,
          });
          return;
        }
        if (body.code === "gmail_not_connected" || body.code === "gmail_needs_reauth") {
          toast.error(body.error ?? "Connect Gmail first", { action: { label: "Open settings", onClick: () => router.push("/settings") } });
          return;
        }
        toast.error(body.error ?? "Could not start the sync");
      } catch {
        toast.error("Network error. Could not start the sync.");
      } finally {
        setStarting(false);
      }
    },
    [starting, run, router],
  );

  const value = useMemo<SyncContextValue>(
    () => ({ run, active, starting, connection, dismissed, dismiss: () => setDismissed(true), start }),
    [run, active, starting, connection, dismissed, start],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
