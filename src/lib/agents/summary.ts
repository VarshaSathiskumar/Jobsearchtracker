import { createAgent, toolStrategy } from "langchain";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { applicationEvents, applications, dashboardSummaries, type DashboardSummary } from "@/db/schema";
import { log } from "@/lib/log";
import { getNewCounts, getTotals, type NewCounts, type Totals } from "@/lib/queries/stats";
import type { AgentModels } from "./models";
import { SUMMARY_PROMPT } from "./prompts";
import { SummarySchema, type SummaryOutput } from "./schemas";

export type RunRecord = { company: string; position: string; event: string; status: string };

async function loadRunRecords(db: Db, userId: string, runId: string): Promise<RunRecord[]> {
  const rows = await db
    .select({ company: applications.company, position: applications.position, event: applicationEvents.eventType, status: applications.status })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.syncRunId, runId)))
    .orderBy(desc(applicationEvents.occurredAt))
    .limit(25);
  return rows;
}

export function templateNarrative(nc: NewCounts): SummaryOutput {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(nc.applications, "new application", "new applications");
  add(nc.rejections, "rejection", "rejections");
  add(nc.callbacks, "recruiter callback or assessment", "recruiter callbacks or assessments");
  add(nc.interviews, "interview update", "interview updates");
  add(nc.offers, "offer", "offers");
  add(nc.jobAlerts, "job alert", "job alerts");
  add(nc.needsReview, "email needing review", "emails needing review");
  if (parts.length === 0) return { narrative: "No new job-related updates were found in this sync.", highlights: [] };
  return { narrative: `This sync detected ${parts.join(", ")}.`, highlights: parts.slice(0, 5) };
}

/** Rejects narratives that contain numbers the database did not produce. */
export function narrativeIsGrounded(text: string, allowed: Set<number>): boolean {
  const nums = text.match(/\d+/g) ?? [];
  return nums.every((s) => allowed.has(Number(s)));
}

function allowedNumbers(totals: Totals, nc: NewCounts, recordCount: number): Set<number> {
  const s = new Set<number>([0, 1, recordCount]);
  for (const v of [...Object.values(totals), ...Object.values(nc)]) s.add(v);
  return s;
}

/**
 * Summary Agent. Counts are computed by SQL. The model only writes prose over verified records, and its
 * output is rejected in favour of a deterministic template if it cites numbers the database did not produce.
 */
export async function generateRunSummary(
  db: Db,
  models: AgentModels | null,
  userId: string,
  runId: string,
): Promise<DashboardSummary> {
  const totals = await getTotals(db, userId);
  const newCounts = await getNewCounts(db, userId, runId);
  const records = await loadRunRecords(db, userId, runId);
  const hasActivity = Object.values(newCounts).some((v) => v > 0);

  let out: SummaryOutput = templateNarrative(newCounts);
  let modelName: string | null = null;

  if (hasActivity && models) {
    try {
      const agent = createAgent({
        name: "summary_agent",
        model: models.summary,
        tools: [],
        systemPrompt: SUMMARY_PROMPT,
        responseFormat: toolStrategy(SummarySchema),
      });
      const facts = JSON.stringify({ newInThisSync: newCounts, totalsAfterSync: totals, records });
      const res = await agent.invoke({ messages: [{ role: "user", content: `<verified_facts>\n${facts}\n</verified_facts>` }] }, { recursionLimit: 8 });
      const parsed = SummarySchema.parse((res as { structuredResponse?: unknown }).structuredResponse);
      if (narrativeIsGrounded(parsed.narrative + " " + parsed.highlights.join(" "), allowedNumbers(totals, newCounts, records.length))) {
        out = parsed;
        modelName = models.names.summary;
      } else {
        log.warn("summary.ungrounded_narrative_rejected", { runId });
      }
    } catch (err) {
      log.warn("summary.model_failed", { runId }, err);
    }
  }

  const [row] = await db
    .insert(dashboardSummaries)
    .values({ userId, syncRunId: runId, totals, newCounts, narrative: out.narrative, highlights: out.highlights, model: modelName })
    .onConflictDoUpdate({
      target: dashboardSummaries.syncRunId,
      set: { totals, newCounts, narrative: out.narrative, highlights: out.highlights, model: modelName, createdAt: new Date() },
    })
    .returning();
  return row;
}
