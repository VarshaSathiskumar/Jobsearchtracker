import { getDb } from "@/db";
import { PageHeader } from "@/components/page-header";
import { ApplicationFormDialog } from "./application-form-dialog";
import { ApplicationsTable } from "./applications-table";
import { FiltersBar } from "./filters-bar";
import { getConnection } from "@/lib/gmail/connection";
import { listApplications, listSources, parseFilters, type Preset } from "@/lib/queries/applications";
import { requireUser } from "@/lib/session";

type SP = Record<string, string | string[] | undefined>;

/** Shared server component behind All Applications, Rejections, Interview Callbacks and Interview Scheduled. */
export async function ApplicationsPage({
  searchParams, preset, title, description, emptyTitle, emptyDescription,
}: {
  searchParams: SP;
  preset: Preset;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const user = await requireUser();
  const db = getDb();
  const filters = parseFilters(searchParams, preset);
  const [{ rows, total, pages }, sources, conn] = await Promise.all([
    listApplications(db, user.id, filters),
    listSources(db, user.id),
    getConnection(db, user.id),
  ]);

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) params[k] = s;
  }

  return (
    <>
      <PageHeader title={title} description={description} actions={<ApplicationFormDialog />} />
      <FiltersBar sources={sources} showStatus={preset === "all"} exportPreset={preset} />
      <ApplicationsTable
        rows={rows} total={total} pages={pages} filters={filters} params={params}
        accountEmail={conn?.googleEmail ?? null} emptyTitle={emptyTitle} emptyDescription={emptyDescription}
      />
    </>
  );
}
