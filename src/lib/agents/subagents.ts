import { createAgent, tool, toolStrategy } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import type { GmailMessage } from "@/db/schema";
import { loadCandidates } from "@/lib/store/applications";
import { companiesMatch } from "@/lib/normalize";
import { eq } from "drizzle-orm";
import { applications } from "@/db/schema";
import type { AgentContext } from "./context";
import {
  APPLICATION_PROMPT,
  CLASSIFICATION_PROMPT,
  JOB_ALERT_PROMPT,
  RESPONSE_PROMPT,
  renderEmail,
} from "./prompts";
import {
  ApplicationExtractionSchema,
  ClassificationSchema,
  JobAlertExtractionSchema,
  ResponseExtractionSchema,
  type ApplicationExtraction,
  type ClassificationOutput,
  type JobAlertExtraction,
  type ResponseExtraction,
} from "./schemas";

/**
 * Each specialist is a real LangChain agent (createAgent) with a focused prompt, optional read-only
 * tools and a Zod-validated structured output. They only return proposals. Persistence is done by the
 * deterministic handlers in lib/pipeline.
 */

async function runSpecialist<S extends z.ZodTypeAny>(args: {
  name: string;
  model: BaseChatModel;
  systemPrompt: string;
  schema: S;
  tools?: any[];
  input: string;
}): Promise<z.infer<S>> {
  const agent = createAgent({
    name: args.name,
    model: args.model,
    tools: args.tools ?? [],
    systemPrompt: args.systemPrompt,
    responseFormat: toolStrategy(args.schema as z.ZodType<any>) as any,
  } as any);
  const result = await agent.invoke({ messages: [{ role: "user", content: args.input }] }, { recursionLimit: 12 });
  const structured = (result as { structuredResponse?: unknown }).structuredResponse;
  return args.schema.parse(structured);
}

export function runClassificationAgent(ctx: AgentContext, msg: GmailMessage, hint?: string): Promise<ClassificationOutput> {
  return runSpecialist({
    name: "classification_agent",
    model: ctx.models.fast,
    systemPrompt: CLASSIFICATION_PROMPT,
    schema: ClassificationSchema,
    input: renderEmail(msg) + (hint ? `\n\nAutomated pre-filter hint (may be wrong): ${hint}` : ""),
  });
}

export function runApplicationAgent(ctx: AgentContext, msg: GmailMessage): Promise<ApplicationExtraction> {
  const lookup = tool(
    async ({ company }: { company: string }) => {
      const rows = await ctx.db.select({ company: applications.company, position: applications.position }).from(applications).where(eq(applications.userId, ctx.userId)).limit(2000);
      const matches = rows.filter((r) => companiesMatch(r.company, company)).slice(0, 10);
      return JSON.stringify({ existing: matches });
    },
    {
      name: "lookup_existing_applications",
      description: "Read-only. Returns company spellings and roles already tracked for a company, so spelling can be kept consistent.",
      schema: z.object({ company: z.string().max(120) }),
    },
  );
  return runSpecialist({
    name: "application_agent",
    model: ctx.models.fast,
    systemPrompt: APPLICATION_PROMPT,
    schema: ApplicationExtractionSchema,
    tools: [lookup],
    input: renderEmail(msg),
  });
}

export function runResponseAgent(ctx: AgentContext, msg: GmailMessage): Promise<ResponseExtraction> {
  const find = tool(
    async ({ company, jobTitle, jobId }: { company: string; jobTitle?: string | null; jobId?: string | null }) => {
      const cands = await loadCandidates(ctx.db, ctx.userId, { company, jobId: jobId ?? null, threadId: msg.threadId });
      const rows = await ctx.db.select().from(applications).where(eq(applications.userId, ctx.userId)).limit(5000);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return JSON.stringify({
        candidates: cands.map((c) => {
          const a = byId.get(c.id)!;
          return {
            id: c.id,
            company: c.company,
            position: c.position,
            jobId: c.jobId,
            status: a.status,
            appliedAt: a.appliedAt.toISOString().slice(0, 10),
            sameEmailThread: c.threadIds.includes(msg.threadId),
          };
        }),
        note: jobTitle ? undefined : "No job title was supplied. Do not choose when more than one candidate is returned.",
      });
    },
    {
      name: "find_candidate_applications",
      description:
        "Read-only. Lists the user's tracked applications that could be the subject of this email. Always call this before choosing matchedApplicationId.",
      schema: z.object({
        company: z.string().max(120),
        jobTitle: z.string().max(160).nullish(),
        jobId: z.string().max(80).nullish(),
      }),
    },
  );
  return runSpecialist({
    name: "response_agent",
    model: ctx.models.fast,
    systemPrompt: RESPONSE_PROMPT,
    schema: ResponseExtractionSchema,
    tools: [find],
    input: renderEmail(msg),
  });
}

export function runJobAlertsAgent(ctx: AgentContext, msg: GmailMessage): Promise<JobAlertExtraction> {
  return runSpecialist({
    name: "job_alerts_agent",
    model: ctx.models.fast,
    systemPrompt: JOB_ALERT_PROMPT,
    schema: JobAlertExtractionSchema,
    input: renderEmail(msg, { includeLinks: true }),
  });
}
