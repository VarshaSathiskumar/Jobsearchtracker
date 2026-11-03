"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/constants";

export type EditableApplication = {
  id: string;
  company: string;
  position: string;
  jobId: string | null;
  source: string | null;
  appliedAt: string;
  status: ApplicationStatus;
  notes: string | null;
};

export function ApplicationFormDialog({ application, compact }: { application?: EditableApplication; compact?: boolean }) {
  const router = useRouter();
  const editing = !!application;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ApplicationStatus>(application?.status ?? "applied");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      company: String(f.get("company") ?? ""),
      position: String(f.get("position") ?? ""),
      jobId: String(f.get("jobId") ?? "").trim() || null,
      source: String(f.get("source") ?? "").trim() || null,
      appliedAt: String(f.get("appliedAt") ?? ""),
      status,
      notes: String(f.get("notes") ?? "").trim() || null,
    };
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/applications/${application!.id}` : "/api/applications", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not save the application");
        return;
      }
      toast.success(editing ? "Application updated" : "Application added");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size={compact ? "icon" : "sm"} aria-label={`Edit ${application!.company}`} className="gap-1.5">
            <Pencil className="size-4" aria-hidden />
            {!compact && "Edit"}
          </Button>
        ) : (
          <Button className="gap-1.5"><Plus className="size-4" aria-hidden /> Add application</Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit application" : "Add application"}</DialogTitle>
          <DialogDescription>
            {editing ? "Manual changes are recorded in the history and are never overwritten by later syncs." : "Track an application that did not come from Gmail."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="company">Company</Label><Input id="company" name="company" required maxLength={120} defaultValue={application?.company} /></div>
            <div className="grid gap-1.5"><Label htmlFor="position">Position</Label><Input id="position" name="position" required maxLength={160} defaultValue={application?.position} /></div>
            <div className="grid gap-1.5"><Label htmlFor="appliedAt">Application date</Label><Input id="appliedAt" name="appliedAt" type="date" required defaultValue={application?.appliedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10)} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ApplicationStatus)}>
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent>{APPLICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="jobId">Job ID</Label><Input id="jobId" name="jobId" maxLength={80} defaultValue={application?.jobId ?? ""} /></div>
            <div className="grid gap-1.5"><Label htmlFor="source">Source</Label><Input id="source" name="source" maxLength={60} placeholder="LinkedIn, referral..." defaultValue={application?.source ?? ""} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" rows={3} maxLength={4000} defaultValue={application?.notes ?? ""} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
