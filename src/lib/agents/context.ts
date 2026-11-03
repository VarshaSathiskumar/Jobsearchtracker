import type { Db } from "@/db";
import type { AgentModels } from "./models";

export type AgentContext = {
  db: Db;
  userId: string;
  runId: string;
  models: AgentModels;
  /** Set when a model provider/infrastructure error occurs. The batch is aborted and retried, not reviewed. */
  infraError?: unknown;
};
