import { createAgent, tool } from "langchain";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { gmailMessages, type GmailMessage } from "@/db/schema";
import { syncTuning } from "@/env";
import { log, redact } from "@/lib/log";
import { prefilter } from "@/lib/prefilter";
import { getMessage, bumpAttempt, createReviewItem } from "@/lib/store/messages";
import { bumpRun } from "@/lib/store/messages";
import {
  handleApplicationExtraction,
  handleClassification,
  nextAgentFor,
  handleJobAlertExtraction,
  handleResponseExtraction,
} from "@/lib/pipeline/handlers";
import type { AgentContext } from "./context";
import { isInfrastructureError } from "./models";
import { SUPERVISOR_PROMPT } from "./prompts";
import { runApplicationAgent, runClassificationAgent, runJobAlertsAgent, runResponseAgent } from "./subagents";

const messageIdSchema = z.object({ messageId: z.string().uuid().describe("Opaque id of the message, exactly as provided.") });

/**
 * Wraps a specialist invocation so that:
 *  - the message must belong to this user and still be pending,
 *  - provider outages abort the batch (and are retried) instead of poisoning the mail,
 *  - content problems (schema failures) are reported back to the supervisor as an error string.
 */
async function guarded(ctx: AgentContext, messageId: string, fn: (msg: GmailMessage) => Promise<string>): Promise<string> {
  if (ctx.infraError) return "error: temporarily unavailable";
  const msg = await getMessage(ctx.db, ctx.userId, messageId);
  if (!msg) return "error: unknown message id";
  if (msg.processingStatus !== "pending") return `already ${msg.processingStatus}`;
  try {
    return await fn(msg);
  } catch (err) {
    if (isInfrastructureError(err)) {
      ctx.infraError = err;
      log.warn("agent.infrastructure_error", { runId: ctx.runId }, err);
      return "error: temporarily unavailable";
    }
    log.warn("agent.content_error", { runId: ctx.runId }, err);
    return `error: ${redact(err).slice(0, 160)}`;
  }
}

export function buildSupervisorTools(ctx: AgentContext) {
  const classification_agent = tool(
    async ({ messageId }: { messageId: string }) =>
      guarded(ctx, messageId, async (msg) => {
        // Deterministic shortcut: well known job alert senders skip the model entirely.
        // A previous attempt already produced a stored classification, so the model is not called again.
        if (msg.classification && msg.classificationConfidence != null) {
          return JSON.stringify({ classification: msg.classification, confidence: Number(msg.classificationConfidence.toFixed(2)), status: "classified", next: nextAgentFor(msg.classification) });
        }
        const pre = prefilter({ fromEmail: msg.fromEmail, fromName: msg.fromName, subject: msg.subject, snippet: msg.snippet, labelIds: msg.labelIds });
        let out;
        let source: "agent" | "shortcut" = "agent";
        if (pre.verdict === "job_alert") {
          out = { classification: pre.classification, confidence: pre.confidence, reasoning: pre.reason };
          source = "shortcut";
        } else {
          out = await runClassificationAgent(ctx, msg, pre.reason);
        }
        const r = await handleClassification(ctx, msg, out, source);
        return JSON.stringify({ classification: out.classification, confidence: Number(out.confidence.toFixed(2)), status: r.status, next: r.next });
      }),
    {
      name: "classification_agent",
      description:
        "Classifies one email (application confirmation, rejection, recruiter callback, interview scheduling, job alert, other career, irrelevant). Returns JSON with the category and which agent to call next.",
      schema: messageIdSchema,
    },
  );

  const application_agent = tool(
    async ({ messageId }: { messageId: string }) =>
      guarded(ctx, messageId, async (msg) => handleApplicationExtraction(ctx, msg, await runApplicationAgent(ctx, msg))),
    {
      name: "application_agent",
      description:
        "Use ONLY after classification_agent returned next=application_agent. Extracts company, title, date, job id and source from an application confirmation and creates or updates the application record without duplicates.",
      schema: messageIdSchema,
    },
  );

  const response_agent = tool(
    async ({ messageId }: { messageId: string }) =>
      guarded(ctx, messageId, async (msg) => handleResponseExtraction(ctx, msg, await runResponseAgent(ctx, msg))),
    {
      name: "response_agent",
      description:
        "Use ONLY after classification_agent returned next=response_agent. Extracts the outcome of a rejection, callback, assessment, interview or offer email, resolves it to the correct application and records it in the status history. Ambiguous emails are sent to Needs Review.",
      schema: messageIdSchema,
    },
  );

  const job_alerts_agent = tool(
    async ({ messageId }: { messageId: string }) =>
      guarded(ctx, messageId, async (msg) => handleJobAlertExtraction(ctx, msg, await runJobAlertsAgent(ctx, msg))),
    {
      name: "job_alerts_agent",
      description:
        "Use ONLY after classification_agent returned next=job_alerts_agent. Extracts advertised roles and links from a job alert email and stores them separately from applications.",
      schema: messageIdSchema,
    },
  );

  return [classification_agent, application_agent, response_agent, job_alerts_agent];
}

/**
 * Runs the LangChain supervisor over one bounded batch of pending messages. Messages the agents did
 * not finish stay pending and are retried by a later step or sync, up to MAX_MESSAGE_ATTEMPTS.
 */
export async function processBatchWithSupervisor(ctx: AgentContext, rows: GmailMessage[]): Promise<void> {
  if (rows.length === 0) return;
  const supervisor = createAgent({
    name: "supervisor",
    model: ctx.models.supervisor,
    tools: buildSupervisorTools(ctx),
    systemPrompt: SUPERVISOR_PROMPT,
  });

  const ordered = [...rows].sort((a, b) => a.internalDate.getTime() - b.internalDate.getTime());
  try {
    await supervisor.invoke(
      { messages: [{ role: "user", content: `Process these message ids, oldest first:\n${ordered.map((r) => r.id).join("\n")}` }] },
      { recursionLimit: 12 + ordered.length * 6 },
    );
  } catch (err) {
    if (isInfrastructureError(err)) ctx.infraError = err;
    else {
      log.warn("supervisor.failed", { runId: ctx.runId }, err);
    }
  }

  // Infrastructure problems are retried by the workflow step, without consuming message attempts.
  if (ctx.infraError) throw ctx.infraError instanceof Error ? ctx.infraError : new Error("Model provider unavailable");

  const { maxMessageAttempts } = syncTuning();
  const after = await ctx.db
    .select()
    .from(gmailMessages)
    .where(and(eq(gmailMessages.userId, ctx.userId), inArray(gmailMessages.id, ordered.map((r) => r.id))));
  for (const m of after) {
    if (m.processingStatus !== "pending") continue;
    const attempts = await bumpAttempt(ctx.db, m.id, "Agents did not complete this message");
    if (attempts >= maxMessageAttempts) {
      const added = await createReviewItem(ctx.db, {
        userId: ctx.userId,
        messageRowId: m.id,
        reason: "agent_error",
        proposedClassification: m.classification,
        note: "Automatic processing failed repeatedly",
        runId: ctx.runId,
      });
      await bumpRun(ctx.db, ctx.runId, { reviewAdded: added ? 1 : 0, errorsCount: 1 });
    }
  }
}
