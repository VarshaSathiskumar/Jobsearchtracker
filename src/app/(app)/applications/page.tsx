import { ApplicationsPage } from "@/components/applications/applications-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "All Applications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ApplicationsPage
      searchParams={await searchParams}
      preset="all"
      title="All Applications"
      description="Every job you have applied to, detected from confirmation emails or added by hand."
      emptyTitle="No applications yet"
      emptyDescription="Click Refresh Now to scan Gmail for application confirmations, or add one manually."
    />
  );
}
