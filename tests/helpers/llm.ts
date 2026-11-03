import { fakeModel } from "langchain";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentModels } from "@/lib/agents/models";

/**
 * Scripted chat models that follow the real prompts' contracts. They are used with the REAL LangChain
 * supervisor, tool wiring, structured output and persistence code. Only the LLM itself is replaced.
 */

const text = (m: BaseMessage) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
const toolCalls = (calls: { name: string; args: Record<string, unknown> }[]) =>
  new AIMessage({ content: "", tool_calls: calls.map((c, i) => ({ ...c, id: `call_${Math.random().toString(36).slice(2)}_${i}`, type: "tool_call" as const })) });

/** fakeModel consumes one queued response per call, so the same factory is queued many times. */
function scripted(factory: (messages: BaseMessage[], structuredToolName: string) => BaseMessage | Error) {
  const m = fakeModel();
  // The agent names its structured-output tool "extract-N" with a global counter, so read the bound name.
  let bound: any[] = [];
  const original = m.bindTools.bind(m);
  (m as any).bindTools = (tools: any[]) => {
    bound = tools;
    return original(tools);
  };
  const toolName = () => bound.map((t) => t.name ?? t.function?.name).find((n: string) => n?.startsWith("extract-")) ?? "extract-1";
  for (let i = 0; i < 3000; i++) m.respond((messages) => factory(messages, toolName()));
  return m;
}

export function supervisorModel() {
  return scripted((messages) => {
    const human = messages.find((m) => m.getType() === "human");
    const ids = [...text(human!).matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]);
    const calls = new Map<string, { name: string; messageId: string }>();
    const results = new Map<string, { name: string; content: string }[]>();
    for (const m of messages) {
      if (m.getType() === "ai") for (const c of (m as AIMessage).tool_calls ?? []) calls.set(c.id!, { name: c.name, messageId: c.args.messageId });
      if (m.getType() === "tool") {
        const c = calls.get((m as any).tool_call_id);
        if (c) results.set(c.messageId, [...(results.get(c.messageId) ?? []), { name: c.name, content: text(m) }]);
      }
    }
    for (const id of ids) {
      const r = results.get(id) ?? [];
      const cls = r.find((x) => x.name === "classification_agent");
      if (!cls) return toolCalls([{ name: "classification_agent", args: { messageId: id } }]);
      let next = "none";
      try {
        next = JSON.parse(cls.content).next ?? "none";
      } catch {
        /* error string */
      }
      if (next !== "none" && !r.some((x) => x.name === next)) return toolCalls([{ name: next, args: { messageId: id } }]);
    }
    return new AIMessage("All messages handled.");
  });
}

const field = (body: string, name: string) => body.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;

function classify(email: string) {
  const l = email.toLowerCase();
  if (/job alert|new jobs/.test(l)) return { classification: "job_alert", confidence: 0.95 };
  if (/unfortunately|not moving forward|other candidates/.test(l)) return { classification: "rejection", confidence: 0.96 };
  if (/schedule your interview|interview is confirmed|interview invitation/.test(l)) return { classification: "interview_scheduling", confidence: 0.93 };
  if (/would like to speak|call you|recruiter screen/.test(l)) return { classification: "recruiter_callback", confidence: 0.9 };
  if (/received your application|thank you for applying/.test(l)) return { classification: "application_confirmation", confidence: 0.95 };
  if (/not sure what this is/.test(l)) return { classification: "other_career", confidence: 0.4 };
  if (/newsletter|career fair/.test(l)) return { classification: "other_career", confidence: 0.9 };
  return { classification: "irrelevant", confidence: 0.9 };
}

export function fastModel(opts: { naiveMatcher?: boolean; failWith?: Error } = {}) {
  return scripted((messages, structuredName) => {
    if (opts.failWith) return opts.failWith;
    const system = text(messages[0]);
    const email = text(messages.filter((m) => m.getType() === "human").at(-1)!);
    const structured = (args: Record<string, unknown>) => toolCalls([{ name: structuredName, args }]);

    if (system.includes("Classification Agent")) {
      return structured({ ...classify(email), reasoning: "scripted" });
    }
    if (system.includes("Application Agent")) {
      return structured({
        isApplicationConfirmation: true, company: field(email, "Company"), jobTitle: field(email, "Role"),
        applicationDate: null, jobId: field(email, "Job ID"), source: field(email, "Via"), confidence: 0.94,
      });
    }
    if (system.includes("Response Agent")) {
      const company = field(email, "Company");
      const role = field(email, "Role");
      const toolMsg = messages.find((m) => m.getType() === "tool");
      if (!toolMsg && company) return toolCalls([{ name: "find_candidate_applications", args: { company, jobTitle: role } }]);
      const l = email.toLowerCase();
      const outcome = /unfortunately|other candidates/.test(l) ? "rejection" : /interview/.test(l) ? "interview_invitation" : "recruiter_callback";
      let matched: string | null = null;
      if (toolMsg) {
        const cands = (JSON.parse(text(toolMsg)).candidates ?? []) as { id: string; position: string }[];
        // A careless model grabs the first candidate even when the email names no role.
        matched = opts.naiveMatcher ? cands[0]?.id ?? null : role ? cands.find((c) => c.position.toLowerCase() === role.toLowerCase())?.id ?? null : null;
      }
      return structured({
        outcome, company, jobTitle: role, jobId: field(email, "Job ID"), interviewDetails: outcome === "interview_invitation" ? "Tuesday 10:00" : null,
        summary: `Scripted ${outcome}`, confidence: 0.93, matchedApplicationId: matched, matchConfidence: matched ? 0.92 : 0, matchEvidence: matched ? "scripted" : null,
      });
    }
    if (system.includes("Job Alerts Agent")) {
      const links = [...email.matchAll(/^(.*) \| (https?:\/\/\S+)$/gim)].map((m) => ({ text: m[1], url: m[2] }));
      const items: { company: string; title: string; location: string | null; url: string }[] = links.map((l, i) => ({ company: `Company ${i + 1}`, title: l.text, location: "Remote", url: l.url }));
      items.push({ company: "Ghost Corp", title: "Hallucinated Role", location: null, url: "https://evil.example/not-in-email" });
      return structured({ alertSource: "LinkedIn", items });
    }
    if (system.includes("Summary Agent")) {
      const facts = JSON.parse(email.match(/<verified_facts>\s*([\s\S]*?)\s*<\/verified_facts>/)![1]);
      return structured({
        narrative: `This sync found ${facts.newInThisSync.applications} new applications and ${facts.newInThisSync.rejections} rejections.`,
        highlights: [],
      });
    }
    return new AIMessage("unrecognized agent");
  });
}

export function fakeModels(opts: Parameters<typeof fastModel>[0] = {}): AgentModels {
  const fast = fastModel(opts);
  return {
    supervisor: supervisorModel() as any,
    fast: fast as any,
    summary: fast as any,
    names: { supervisor: "fake-supervisor", fast: "fake-fast", summary: "fake-fast" },
  };
}
