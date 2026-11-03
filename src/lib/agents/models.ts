import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { openaiEnv } from "@/env";

export type AgentModels = {
  /** Orchestration and tool routing. */
  supervisor: BaseChatModel;
  /** High volume extraction and classification. */
  fast: BaseChatModel;
  /** Narrative summary. */
  summary: BaseChatModel;
  /** Model names for audit/display. */
  names: { supervisor: string; fast: string; summary: string };
};

export function createModels(): AgentModels {
  const env = openaiEnv();
  const make = (model: string, maxTokens: number) =>
    new ChatOpenAI({ apiKey: env.OPENAI_API_KEY, model, maxTokens, maxRetries: 3 });
  const summaryName = env.OPENAI_MODEL_SUMMARY || env.OPENAI_MODEL_FAST;
  return {
    supervisor: make(env.OPENAI_MODEL_SUPERVISOR, 1024),
    fast: make(env.OPENAI_MODEL_FAST, 1024),
    summary: make(summaryName, 1024),
    names: { supervisor: env.OPENAI_MODEL_SUPERVISOR, fast: env.OPENAI_MODEL_FAST, summary: summaryName },
  };
}

/**
 * HTTP-level failures from the model provider (auth, quota, overload, network). They are not the
 * email's fault, so they must never push mail into Needs Review. The step is retried instead.
 */
export function isInfrastructureError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; name?: string; message?: string } | null;
  if (!e) return false;
  if (typeof e.status === "number") return true;
  if (e.code && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR)/.test(e.code)) return true;
  return /fetch failed|overloaded|rate limit|timeout|APIConnection/i.test(`${e.name ?? ""} ${e.message ?? ""}`);
}
