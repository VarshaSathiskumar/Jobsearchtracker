"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SamplePanel({ hasSample }: { hasSample: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(action: "load" | "clear") {
    setBusy(true);
    const res = await fetch("/api/sample-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (res.ok) {
      toast.success(action === "load" ? "Sample data loaded" : "Sample data removed");
      router.refresh();
    } else toast.error("Something went wrong");
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-xl text-sm text-muted-foreground">
        Load fictional applications to explore the dashboard before your first sync. Sample rows are labelled &quot;Sample&quot; everywhere and can be removed in one click without touching real data.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || hasSample} onClick={() => run("load")}>Load sample data</Button>
        <Button variant="ghost" disabled={busy || !hasSample} onClick={() => run("clear")}>Remove sample data</Button>
      </div>
    </div>
  );
}
