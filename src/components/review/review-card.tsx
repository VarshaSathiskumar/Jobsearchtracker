"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Time } from "@/components/time";
import { CLASSIFICATION_LABELS, EVENT_LABELS, type EmailClassification, type EventType, type ReviewReason } from "@/lib/constants";
import { gmailMessageUrl } from "@/lib/gmail/client";
import { CLASSIFICATION_STYLES } from "@/lib/ui";

export type ReviewCardItem = {
  id: string;
  reason: ReviewReason;
  note: string | null;
  proposedClassification: EmailClassification | null;
  candidateIds: string[];
  outcome: string | null;
  company: string | null;
  jobTitle: string | null;
  jobId: string | null;
  subject: string;
  from: string;
  snippet: string;
  receivedAt: string;
  gmailMessageId: string;
};

const REASONS: Record<ReviewReason, string> = {
  low_confidence: "Low confidence",
  unmatched: "No matching application",
  ambiguous_match: "Several possible applications",
  extraction_failed: "Details could not be extracted",
  agent_error: "Automatic processing failed",
};

const ASSIGN_EVENTS: EventType[] = ["rejected", "callback", "assessment", "interview_scheduled", "interview_rescheduled", "offer", "withdrawn", "update"];

const OUTCOME_TO_EVENT: Record<string, EventType> = {
  rejection: "rejected", recruiter_callback: "callback", assessment: "assessment", interview_invitation: "interview_scheduled",
  interview_rescheduled: "interview_rescheduled", offer: "offer", withdrawn: "withdrawn", other_update: "update",
};

export function ReviewCard({ item, applications, accountEmail }: { item: ReviewCardItem; applications: { id: string; company: string; position: string }[]; accountEmail: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "assign" | "create">("idle");
  const [busy, setBusy] = useState(false);
  const initialEvent: EventType =
    (item.outcome && OUTCOME_TO_EVENT[item.outcome]) ||
    ({ rejection: "rejected", recruiter_callback: "callback", interview_scheduling: "interview_scheduled" } as Partial<Record<EmailClassification, EventType>>)[item.proposedClassification ?? "irrelevant"] ||
    "update";
  const [eventType, setEventType] = useState<EventType>(initialEvent);
  const candidates = applications.filter((a) => item.candidateIds.includes(a.id));
  const [applicationId, setApplicationId] = useState<string>(candidates[0]?.id ?? "");

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/review/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(out.error ?? "Could not save your decision");
      toast.success(success);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-900">{REASONS[item.reason]}</Badge>
              {item.proposedClassification && <Badge variant="outline" className={`rounded-full ${CLASSIFICATION_STYLES[item.proposedClassification]}`}>AI guess: {CLASSIFICATION_LABELS[item.proposedClassification]}</Badge>}
            </div>
            <p className="truncate text-base font-semibold">{item.subject || "(no subject)"}</p>
            <p className="truncate text-sm text-muted-foreground">{item.from} · <Time value={item.receivedAt} mode="datetime" /></p>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={gmailMessageUrl(accountEmail, item.gmailMessageId)} target="_blank" rel="noopener noreferrer"><Mail className="size-4" aria-hidden /> Open in Gmail <ExternalLink className="size-3" aria-hidden /></a>
          </Button>
        </div>

        {item.snippet && <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{item.snippet}</p>}

        {(item.company || item.jobTitle || item.outcome) && (
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {item.company && <div><dt className="text-xs text-muted-foreground">Company (extracted)</dt><dd className="font-medium">{item.company}</dd></div>}
            {item.jobTitle && <div><dt className="text-xs text-muted-foreground">Role (extracted)</dt><dd className="font-medium">{item.jobTitle}</dd></div>}
            {item.jobId && <div><dt className="text-xs text-muted-foreground">Job ID</dt><dd className="font-mono text-xs">{item.jobId}</dd></div>}
            {item.outcome && <div><dt className="text-xs text-muted-foreground">Outcome (extracted)</dt><dd className="font-medium">{EVENT_LABELS[initialEvent]}</dd></div>}
          </dl>
        )}
        {item.note && <p className="text-xs text-muted-foreground">Why it is here: {item.note}</p>}

        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setMode("assign")}>Assign to an application</Button>
            <Button size="sm" variant="outline" onClick={() => setMode("create")}>Create application</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: "other" }, "Filed under Other Emails")}>File as other</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: "dismiss" }, "Dismissed")}>Dismiss</Button>
          </div>
        )}

        {mode === "assign" && (
          <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Application</Label>
              <Select value={applicationId} onValueChange={setApplicationId}>
                <SelectTrigger aria-label="Application"><SelectValue placeholder="Choose an application" /></SelectTrigger>
                <SelectContent>
                  {candidates.length > 0 && (
                    <>
                      {candidates.map((a) => <SelectItem key={a.id} value={a.id}>{a.company} · {a.position} (suggested)</SelectItem>)}
                    </>
                  )}
                  {applications.filter((a) => !item.candidateIds.includes(a.id)).map((a) => <SelectItem key={a.id} value={a.id}>{a.company} · {a.position}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>What happened</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
                <SelectTrigger aria-label="What happened"><SelectValue /></SelectTrigger>
                <SelectContent>{ASSIGN_EVENTS.map((e) => <SelectItem key={e} value={e}>{EVENT_LABELS[e]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={busy || !applicationId} onClick={() => act({ action: "assign", applicationId, eventType }, "Assigned")}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
            </div>
          </div>
        )}

        {mode === "create" && (
          <form
            className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act({ action: "create", company: String(f.get("company")), position: String(f.get("position")), jobId: String(f.get("jobId") ?? "") || null, eventType }, "Application created");
            }}
          >
            <div className="grid gap-1.5"><Label htmlFor={`c-${item.id}`}>Company</Label><Input id={`c-${item.id}`} name="company" required defaultValue={item.company ?? ""} /></div>
            <div className="grid gap-1.5"><Label htmlFor={`p-${item.id}`}>Position</Label><Input id={`p-${item.id}`} name="position" required defaultValue={item.jobTitle ?? ""} /></div>
            <div className="grid gap-1.5"><Label htmlFor={`j-${item.id}`}>Job ID (optional)</Label><Input id={`j-${item.id}`} name="jobId" defaultValue={item.jobId ?? ""} /></div>
            <div className="grid gap-1.5">
              <Label>Record this email as</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
                <SelectTrigger aria-label="Record this email as"><SelectValue /></SelectTrigger>
                <SelectContent>{(["applied", ...ASSIGN_EVENTS] as EventType[]).map((e) => <SelectItem key={e} value={e}>{EVENT_LABELS[e]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" type="submit" disabled={busy}>Create</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
