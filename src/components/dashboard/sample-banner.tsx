"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SampleDataBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div role="note" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
      <p className="flex items-center gap-2 text-sm">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span>
          <strong>Sample data is included</strong> in these numbers. Rows marked &quot;Sample&quot; are fictional and are not from your Gmail.
        </span>
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="border-amber-400 bg-white"
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/sample-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) });
          setBusy(false);
          if (res.ok) {
            toast.success("Sample data removed");
            router.refresh();
          } else toast.error("Could not remove sample data");
        }}
      >
        Remove sample data
      </Button>
    </div>
  );
}
