import Link from "next/link";
import { Bell, Briefcase, CalendarCheck, CircleX, Cloud, FlaskConical, PhoneCall, Sparkles } from "lucide-react";
import { getDb } from "@/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusDistributionChart, TrendChart } from "@/components/dashboard/charts-lazy";
import { SampleDataBanner } from "@/components/dashboard/sample-banner";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_LABELS } from "@/lib/constants";
import { getShellData } from "@/lib/queries/shell";
import { EMPTY_NEW, getLastFinishedRun, getLatestSummary, getNewCounts, getRecentActivity, getStatusDistribution, getTotals, getTrend, hasSampleData } from "@/lib/queries/stats";
import { requireUser } from "@/lib/session";
import { SampleBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await requireUser();
  const db = getDb();
  const lastRunP = getLastFinishedRun(db, user.id);
  const [lastRun, totals, newCounts, distribution, trend, activity, summary, sample, shell] = await Promise.all([
    lastRunP,
    getTotals(db, user.id),
    lastRunP.then((run) => (run ? getNewCounts(db, user.id, run.id) : EMPTY_NEW)),
    getStatusDistribution(db, user.id),
    getTrend(db, user.id, 12),
    getRecentActivity(db, user.id, 8),
    getLatestSummary(db, user.id),
    hasSampleData(db, user.id),
    getShellData(db, user.id),
  ]);

  const conn = shell.connection;
  const connected = conn.status === "connected";
  const empty = totals.applications === 0 && totals.jobAlerts === 0;

  return (
    <>
      <PageHeader title="Overview" description="Everything below is calculated from your synchronized Gmail records." />
      {sample && <SampleDataBanner />}

      {!connected && (
        <Card className="mb-6 border-indigo-200 bg-gradient-to-r from-indigo-50 to-teal-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <Cloud className="size-6 text-indigo-600" aria-hidden />
              <div>
                <p className="font-semibold">{conn.status === "needs_reauth" ? "Gmail authorization expired" : "Connect Gmail to start tracking"}</p>
                <p className="text-sm text-muted-foreground">Read-only access. Nothing is ever sent, changed or deleted in your mailbox.</p>
              </div>
            </div>
            <Button asChild><Link href="/settings">{conn.status === "needs_reauth" ? "Reconnect Gmail" : "Connect Gmail"}</Link></Button>
          </CardContent>
        </Card>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard title="Total Applied Jobs" value={totals.applications} delta={newCounts.applications} href="/applications" icon={Briefcase} tone="blue" />
        <KpiCard title="Rejections" value={totals.rejections} delta={newCounts.rejections} href="/rejections" icon={CircleX} tone="rose" />
        <KpiCard title="Interview Callbacks" value={totals.callbacks} delta={newCounts.callbacks} href="/callbacks" icon={PhoneCall} tone="violet" />
        <KpiCard title="Interviews Scheduled" value={totals.interviews} delta={newCounts.interviews} href="/interviews" icon={CalendarCheck} tone="teal" />
        <KpiCard title="Job Alerts" value={totals.jobAlerts} delta={newCounts.jobAlerts} href="/job-alerts" icon={Bell} tone="amber" />
      </section>
      <p className="mt-2 text-xs text-muted-foreground">
        Cards show current totals. &quot;New&quot; counts items detected in the most recent completed sync
        {lastRun?.finishedAt && (
          <>
            {" "}(<Time value={lastRun.finishedAt} mode="datetime" />)
          </>
        )}
        .
      </p>

      <Card className="mt-6 border-violet-200/70 bg-gradient-to-br from-white to-violet-50/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-violet-600" aria-hidden /> What&apos;s new
          </CardTitle>
          <CardDescription>
            AI-written digest of the latest sync. Numbers come from database queries, the AI only writes the wording.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed">{summary.narrative}</p>
              {summary.highlights.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {summary.highlights.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Generated <Time value={summary.createdAt} mode="relative" />
                {summary.model ? ` by ${summary.model}` : " from verified counts"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No summary yet. Click Refresh Now to sync Gmail and generate one.</p>
          )}
        </CardContent>
      </Card>

      {empty ? (
        <EmptyState
          className="mt-6"
          icon={FlaskConical}
          title="No applications yet"
          description={connected ? "Click Refresh Now to read your Gmail. The first run backfills your history in resumable batches." : "Connect Gmail in Settings, or load sample data to explore the dashboard."}
          action={<Button asChild variant="outline"><Link href="/settings">Open Settings</Link></Button>}
        />
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Status distribution</CardTitle><CardDescription>Where every application stands today.</CardDescription></CardHeader>
              <CardContent><StatusDistributionChart data={distribution} /></CardContent>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader><CardTitle className="text-base">Application trends</CardTitle><CardDescription>Last 12 weeks, by week.</CardDescription></CardHeader>
              <CardContent><TrendChart data={trend} /></CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>Latest status changes across your applications.</CardDescription>
              </div>
              {totals.needsReview > 0 && (
                <Button asChild size="sm" variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100">
                  <Link href="/needs-review">{totals.needsReview} need review</Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="divide-y">
                  {activity.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <Link href={`/applications/${a.applicationId}`} className="font-medium hover:text-primary hover:underline">
                          {a.company}
                        </Link>
                        <span className="text-muted-foreground"> · {a.position}</span>
                        <p className="text-sm text-muted-foreground">{EVENT_LABELS[a.eventType]}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {a.isSample && <SampleBadge />}
                        <Time value={a.occurredAt} mode="date" />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
