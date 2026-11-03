"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, History, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSync } from "@/components/dashboard/sync-provider";
import { Time } from "@/components/time";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function GmailPanel({ backfill }: { backfill: { done: boolean; scanned: number; after: string | null; before: string | null } | null }) {
  const router = useRouter();
  const { connection, start, active, starting } = useSync();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const connected = connection.status === "connected";

  const preset = (days: number | null) => {
    setBefore("");
    if (days === null) return setAfter("");
    setAfter(daysAgoIso(days));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-medium">
            {connected ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : connection.status === "needs_reauth" ? <AlertTriangle className="size-4 text-amber-600" aria-hidden /> : <Unplug className="size-4 text-slate-500" aria-hidden />}
            {connected ? "Connected" : connection.status === "needs_reauth" ? "Authorization expired" : "Not connected"}
            {connection.googleEmail && <span className="text-sm font-normal text-muted-foreground">· {connection.googleEmail}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            Scope: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">gmail.readonly</code>. Last synced <Time value={connection.lastSyncedAt} mode="relative" empty="never" />.
          </p>
          {connection.status === "needs_reauth" && (
            <p className="text-sm text-amber-800">Google revoked or expired the grant. If your OAuth app is in Testing mode, grants expire after 7 days. Reconnect to continue.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant={connected ? "outline" : "default"}>
            <a href="/api/gmail/connect">{connection.status === "none" || connection.status === "disconnected" ? "Connect Gmail" : "Reconnect"}</a>
          </Button>
          {(connected || connection.status === "needs_reauth") && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button variant="ghost" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800">Disconnect</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disconnect Gmail?</DialogTitle>
                  <DialogDescription>
                    The stored refresh token is deleted and Google is asked to revoke it. Your tracked applications stay. You can reconnect at any time.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const res = await fetch("/api/gmail/disconnect", { method: "POST" });
                      setBusy(false);
                      setOpen(false);
                      if (res.ok) {
                        toast.success("Gmail disconnected");
                        router.refresh();
                        window.location.reload();
                      } else toast.error("Could not disconnect");
                    }}
                  >
                    Disconnect
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-muted/30 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" aria-hidden /> Historical backfill</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Reads older mail in resumable batches. It keeps running on the server if you close this tab, and a later Refresh Now continues where it stopped.
        </p>
        {backfill && !backfill.done && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A backfill is in progress ({backfill.scanned} emails scanned so far). Refresh Now resumes it automatically.
          </p>
        )}
        {backfill?.done && <p className="mt-2 text-sm text-emerald-700">Last backfill completed ({backfill.scanned} emails scanned).</p>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5"><Label htmlFor="bf-after">From</Label><Input id="bf-after" type="date" value={after} onChange={(e) => setAfter(e.target.value)} className="w-40 bg-card" /></div>
          <div className="grid gap-1.5"><Label htmlFor="bf-before">To (optional)</Label><Input id="bf-before" type="date" value={before} onChange={(e) => setBefore(e.target.value)} className="w-40 bg-card" /></div>
          <div className="flex flex-wrap gap-1.5">
            {[["30 days", 30], ["90 days", 90], ["6 months", 182], ["1 year", 365]].map(([label, days]) => (
              <Button key={label as string} type="button" size="sm" variant="outline" className="bg-card" onClick={() => preset(days as number)}>{label}</Button>
            ))}
            <Button type="button" size="sm" variant="outline" className="bg-card" onClick={() => preset(null)}>All time</Button>
          </div>
          <Button disabled={!connected || active || starting} onClick={() => start({ mode: "backfill", after: after || undefined, before: before || undefined })}>
            {backfill && !backfill.done ? "Restart with this range" : "Start backfill"}
          </Button>
        </div>
      </div>
    </div>
  );
}
