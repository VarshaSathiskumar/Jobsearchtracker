"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Menu, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Time } from "@/components/time";
import { Brand, NavLinks } from "./sidebar";
import { useSync } from "@/components/dashboard/sync-provider";

function ConnectionChip() {
  const { connection } = useSync();
  if (connection.status === "connected")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Gmail connected</span>
        <span className="sm:hidden">Gmail</span>
        {connection.googleEmail && <span className="hidden max-w-40 truncate text-emerald-700/80 xl:inline">· {connection.googleEmail}</span>}
      </span>
    );
  if (connection.status === "needs_reauth")
    return (
      <Link href="/api/gmail/connect" className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
        <AlertTriangle className="size-3.5" aria-hidden /> Reconnect Gmail
      </Link>
    );
  return (
    <Link href="/settings" className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
      <Unplug className="size-3.5" aria-hidden /> Connect Gmail
    </Link>
  );
}

export function Topbar({ counts }: { counts: { needsReview: number } }) {
  const { active, starting, start, connection } = useSync();
  const [open, setOpen] = useState(false);
  const busy = active || starting;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 gap-6 p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
          </SheetHeader>
          <NavLinks counts={counts} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ConnectionChip />
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          Last synced: <span className="font-medium text-foreground"><Time value={connection.lastSyncedAt} mode="relative" empty="never" /></span>
        </span>
      </div>

      <Button
        onClick={() => start({ mode: "refresh" })}
        disabled={busy}
        size="lg"
        className="gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:brightness-110 hover:shadow-lg disabled:opacity-80"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        {busy ? "Syncing..." : "Refresh Now"}
      </Button>
    </header>
  );
}
