import { ApplicationsPage } from "@/components/applications/applications-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interview Scheduled" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ApplicationsPage
      searchParams={await searchParams}
      preset="interviews"
      title="Interview Scheduled"
      description="Applications with a scheduled interview."
      emptyTitle="No interviews scheduled"
      emptyDescription="Interview invitations and confirmations will appear here."
    />
  );
}
