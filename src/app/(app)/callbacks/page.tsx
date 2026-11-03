import { ApplicationsPage } from "@/components/applications/applications-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interview Callbacks" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ApplicationsPage
      searchParams={await searchParams}
      preset="callbacks"
      title="Interview Callbacks"
      description="Recruiter callbacks and assessments that have not yet reached a scheduled interview."
      emptyTitle="No callbacks yet"
      emptyDescription="When a recruiter replies or sends an assessment, the application shows up here."
    />
  );
}
