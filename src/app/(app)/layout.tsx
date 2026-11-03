import { getDb } from "@/db";
import { SyncProgress } from "@/components/dashboard/sync-progress";
import { SyncProvider } from "@/components/dashboard/sync-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getShellData } from "@/lib/queries/shell";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const shell = await getShellData(getDb(), user.id);
  const counts = { needsReview: shell.needsReview };

  return (
    <SyncProvider initialRun={shell.run ? JSON.parse(JSON.stringify(shell.run)) : null} connection={JSON.parse(JSON.stringify(shell.connection))}>
      <Sidebar counts={counts} />
      <div className="lg:pl-64">
        <Topbar counts={counts} />
        <SyncProgress />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </SyncProvider>
  );
}
