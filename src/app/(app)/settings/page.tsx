import { desc, eq } from "drizzle-orm";
import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { getDb } from "@/db";
import { syncRuns } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { GmailPanel } from "@/components/settings/gmail-panel";
import { SamplePanel } from "@/components/settings/sample-panel";
import { Time } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConnection } from "@/lib/gmail/connection";
import { hasSampleData } from "@/lib/queries/stats";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const STATUS_TONE: Record<string, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  running: "border-indigo-200 bg-indigo-50 text-indigo-800",
  queued: "border-slate-200 bg-slate-50 text-slate-700",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await requireUser();
  const { gmail } = await searchParams;
  const db = getDb();
  const [conn, sample, runs] = await Promise.all([
    getConnection(db, user.id),
    hasSampleData(db, user.id),
    db.select().from(syncRuns).where(eq(syncRuns.userId, user.id)).orderBy(desc(syncRuns.createdAt)).limit(8),
  ]);
  const banner = {
    connected: ["border-emerald-200 bg-emerald-50 text-emerald-900", "Gmail connected with read-only access. Click Refresh Now to start the first sync."],
    denied: ["border-amber-200 bg-amber-50 text-amber-900", "Gmail access was not granted. You can try again at any time."],
    error: ["border-rose-200 bg-rose-50 text-rose-900", "Connecting Gmail failed. Please try again."],
  }[gmail ?? ""];

  return (
    <>
      <PageHeader title="Settings" description="Gmail connection, historical backfill, sample data and sync history." />
      {banner && <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${banner[0]}`}>{banner[1]}</p>}

      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Gmail</CardTitle><CardDescription>Separate from sign-in. The app requests only read access and stores the refresh token encrypted, server-side.</CardDescription></CardHeader>
          <CardContent>
            <GmailPanel backfill={conn?.backfillState ? { done: conn.backfillState.done, scanned: conn.backfillState.scanned, after: conn.backfillState.after, before: conn.backfillState.before } : null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm">Signed in as <strong>{user.email}</strong></p>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <Button type="submit" variant="outline" className="gap-2"><LogOut className="size-4" aria-hidden /> Sign out</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Sample data</CardTitle></CardHeader>
          <CardContent><SamplePanel hasSample={sample} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent syncs</CardTitle><CardDescription>Every run is recorded, including partial and failed ones.</CardDescription></CardHeader>
          <CardContent>
            {runs.length === 0 ? <p className="text-sm text-muted-foreground">No syncs yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Scanned</TableHead><TableHead className="text-right">Added</TableHead><TableHead className="hidden text-right sm:table-cell">Review</TableHead></TableRow></TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap"><Time value={r.startedAt ?? r.createdAt} mode="datetime" /></TableCell>
                      <TableCell className="capitalize">{r.kind}</TableCell>
                      <TableCell><Badge variant="outline" className={`rounded-full capitalize ${STATUS_TONE[r.status]}`} title={r.error ?? undefined}>{r.status}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{r.messagesScanned}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.applicationsAdded + r.alertsAdded}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.reviewAdded}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
