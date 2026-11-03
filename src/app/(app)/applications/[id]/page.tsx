import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, ExternalLink, Mail, UserRound } from "lucide-react";
import { getDb } from "@/db";
import { ApplicationFormDialog } from "@/components/applications/application-form-dialog";
import { DeleteApplicationButton } from "@/components/applications/delete-application-button";
import { SampleBadge, StatusBadge } from "@/components/status-badge";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_LABELS } from "@/lib/constants";
import { getConnection } from "@/lib/gmail/connection";
import { gmailMessageUrl } from "@/lib/gmail/client";
import { getApplicationDetail } from "@/lib/queries/applications";
import { requireUser } from "@/lib/session";
import { STATUS_STYLES } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Application" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [detail, conn] = await Promise.all([getApplicationDetail(db, user.id, id), getConnection(db, user.id)]);
  if (!detail) notFound();
  const { app, events } = detail;
  const account = conn?.googleEmail ?? null;
  const emails = events.filter((e) => e.gmailMessageId);
  const seen = new Set<string>();
  const uniqueEmails = emails.filter((e) => (seen.has(e.gmailMessageId!) ? false : (seen.add(e.gmailMessageId!), true)));

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 gap-1.5 text-muted-foreground">
        <Link href="/applications"><ArrowLeft className="size-4" aria-hidden /> All applications</Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{app.company}</h1>
            <StatusBadge status={app.status} />
            {app.isSample && <SampleBadge />}
          </div>
          <p className="mt-1 text-lg text-muted-foreground">{app.position}</p>
        </div>
        <div className="flex items-center gap-2">
          <ApplicationFormDialog application={{ id: app.id, company: app.company, position: app.position, jobId: app.jobId, source: app.source, appliedAt: app.appliedAt.toISOString(), status: app.status, notes: app.notes }} />
          <DeleteApplicationButton id={app.id} company={app.company} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Applied"><Time value={app.appliedAt} /></Field>
              <Field label="Last update"><Time value={app.lastActivityAt} /></Field>
              <Field label="Source">{app.source ?? "-"}</Field>
              <Field label="Job ID"><span className="font-mono text-xs">{app.jobId ?? "-"}</span></Field>
            </dl>
            {app.notes && (
              <div className="mt-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{app.notes}</p>
              </div>
            )}
            {app.manuallyEdited && <p className="mt-5 text-xs text-muted-foreground">Includes manual edits.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Status history</CardTitle>
            <CardDescription>Chronological record of every update, with the email that caused it.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-6 border-l pl-6" aria-label="Status history">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[31px] top-1.5 size-3 rounded-full ring-4 ring-card ${e.resultingStatus ? STATUS_STYLES[e.resultingStatus].dot : "bg-slate-300"}`} aria-hidden />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-medium">{EVENT_LABELS[e.eventType]}</p>
                    {e.resultingStatus && <StatusBadge status={e.resultingStatus} className="text-xs" />}
                    <span className="text-xs text-muted-foreground"><Time value={e.occurredAt} mode="datetime" /></span>
                  </div>
                  {e.summary && <p className="mt-1 text-sm text-muted-foreground">{e.summary}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {e.actor === "agent" ? <Bot className="size-3.5" aria-hidden /> : <UserRound className="size-3.5" aria-hidden />}
                      {e.actor === "agent" ? `AI${e.confidence != null ? ` · ${Math.round(e.confidence * 100)}% confidence` : ""}` : e.actor === "user" ? "You" : "Sample"}
                    </span>
                    {e.gmailMessageId && (
                      <a href={gmailMessageUrl(account, e.gmailMessageId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        <Mail className="size-3.5" aria-hidden /> Open in Gmail <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Linked emails</CardTitle>
          <CardDescription>Only references are stored. Open an email to read it in Gmail.</CardDescription>
        </CardHeader>
        <CardContent>
          {uniqueEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">{app.isSample ? "Sample data has no emails." : "No emails are linked to this application."}</p>
          ) : (
            <ul className="divide-y">
              {uniqueEmails.map((e) => (
                <li key={e.gmailMessageId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.subject || "(no subject)"}</p>
                    <p className="truncate text-xs text-muted-foreground">{e.fromName ? `${e.fromName} · ` : ""}{e.fromEmail} · <Time value={e.occurredAt} /></p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={gmailMessageUrl(account, e.gmailMessageId!)} target="_blank" rel="noopener noreferrer"><Mail className="size-4" aria-hidden /> Open in Gmail</a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
