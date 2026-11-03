import { desc, eq, and } from "drizzle-orm";
import { CheckCheck } from "lucide-react";
import { getDb } from "@/db";
import { applications, gmailMessages, reviewItems } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReviewCard, type ReviewCardItem } from "@/components/review/review-card";
import { getConnection } from "@/lib/gmail/connection";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Needs Review" };

export default async function NeedsReviewPage() {
  const user = await requireUser();
  const db = getDb();
  const [items, apps, conn] = await Promise.all([
    db
      .select({ item: reviewItems, msg: gmailMessages })
      .from(reviewItems)
      .innerJoin(gmailMessages, eq(gmailMessages.id, reviewItems.gmailMessageId))
      .where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open")))
      .orderBy(desc(gmailMessages.internalDate))
      .limit(100),
    db
      .select({ id: applications.id, company: applications.company, position: applications.position })
      .from(applications)
      .where(eq(applications.userId, user.id))
      .orderBy(applications.company, applications.position)
      .limit(1000),
    getConnection(db, user.id),
  ]);

  const cards: ReviewCardItem[] = items.map(({ item, msg }) => {
    const p = (item.proposedPayload ?? {}) as Record<string, unknown>;
    return {
      id: item.id,
      reason: item.reason,
      note: item.note,
      proposedClassification: item.proposedClassification,
      candidateIds: item.candidateApplicationIds,
      outcome: typeof p.outcome === "string" ? p.outcome : null,
      company: typeof p.company === "string" ? p.company : null,
      jobTitle: typeof p.jobTitle === "string" ? p.jobTitle : null,
      jobId: typeof p.jobId === "string" ? p.jobId : null,
      subject: msg.subject,
      from: msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail,
      snippet: msg.snippet,
      receivedAt: msg.internalDate.toISOString(),
      gmailMessageId: msg.gmailMessageId,
    };
  });

  return (
    <>
      <PageHeader title="Needs Review" description="Emails the AI was not sure about, or could not match to exactly one application. Nothing here has changed any application yet." />
      {cards.length === 0 ? (
        <EmptyState icon={CheckCheck} title="All caught up" description="Uncertain classifications and unmatched emails will be queued here for your decision." />
      ) : (
        <div className="grid gap-4">
          {cards.map((c) => (
            <ReviewCard key={c.id} item={c} applications={apps} accountEmail={conn?.googleEmail ?? null} />
          ))}
        </div>
      )}
    </>
  );
}
