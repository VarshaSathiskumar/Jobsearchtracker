"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function DeleteApplicationButton({ id, company }: { id: string; company: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-rose-700 hover:bg-rose-50 hover:text-rose-800"><Trash2 className="size-4" aria-hidden /> Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this application?</DialogTitle>
          <DialogDescription>
            {company} and its status history will be removed from the tracker. Your emails in Gmail are not touched. A later sync may detect it again if the confirmation email is reprocessed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
              setBusy(false);
              if (res.ok) {
                toast.success("Application deleted");
                router.push("/applications");
                router.refresh();
              } else toast.error("Could not delete the application");
            }}
          >
            {busy ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
