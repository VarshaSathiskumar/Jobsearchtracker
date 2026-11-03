import { ApplicationsPage } from "@/components/applications/applications-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rejections" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ApplicationsPage
      searchParams={await searchParams}
      preset="rejections"
      title="Rejections"
      description="Applications whose latest status is a rejection."
      emptyTitle="No rejections"
      emptyDescription="Rejection emails will appear here after a sync. Each rejection only affects the role it names."
    />
  );
}
