import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  APPLICATION_STATUSES,
  CONNECTION_STATUSES,
  EMAIL_CLASSIFICATIONS,
  EVENT_TYPES,
  MESSAGE_PROCESSING_STATUSES,
  REVIEW_REASONS,
  REVIEW_STATUSES,
  SYNC_KINDS,
  SYNC_STATUSES,
} from "@/lib/constants";

export const applicationStatusEnum = pgEnum("application_status", APPLICATION_STATUSES);
export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const emailClassificationEnum = pgEnum("email_classification", EMAIL_CLASSIFICATIONS);
export const messageProcessingEnum = pgEnum("message_processing_status", MESSAGE_PROCESSING_STATUSES);
export const syncStatusEnum = pgEnum("sync_status", SYNC_STATUSES);
export const syncKindEnum = pgEnum("sync_kind", SYNC_KINDS);
export const reviewReasonEnum = pgEnum("review_reason", REVIEW_REASONS);
export const reviewStatusEnum = pgEnum("review_status", REVIEW_STATUSES);
export const connectionStatusEnum = pgEnum("connection_status", CONNECTION_STATUSES);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

export const gmailConnections = pgTable("gmail_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  googleEmail: text("google_email").notNull(),
  /** AES-256-GCM envelope, see lib/crypto.ts. Null once disconnected. */
  encryptedRefreshToken: text("encrypted_refresh_token"),
  scopes: text("scopes").notNull().default(""),
  status: connectionStatusEnum("status").notNull().default("connected"),
  /** Last Gmail history ID whose messages are durably stored. Null until the first backfill completes. */
  historyId: text("history_id"),
  /** Resumable backfill state: { query, after, before, pageToken, anchorHistoryId, done }. */
  backfillState: jsonb("backfill_state").$type<BackfillState | null>(),
  lastError: text("last_error"),
  connectedAt: ts("connected_at").notNull().defaultNow(),
  disconnectedAt: ts("disconnected_at"),
  lastSyncedAt: ts("last_synced_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type BackfillState = {
  after: string | null; // YYYY/MM/DD
  before: string | null;
  pageToken: string | null;
  anchorHistoryId: string | null;
  scanned: number;
  done: boolean;
};

export const gmailMessages = pgTable(
  "gmail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    threadId: text("thread_id").notNull(),
    internalDate: ts("internal_date").notNull(),
    fromEmail: text("from_email").notNull().default(""),
    fromName: text("from_name"),
    subject: text("subject").notNull().default(""),
    /** Short Gmail snippet only. Full bodies are never persisted long term. */
    snippet: text("snippet").notNull().default(""),
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    classification: emailClassificationEnum("classification"),
    classificationConfidence: real("classification_confidence"),
    classificationSource: text("classification_source"),
    processingStatus: messageProcessingEnum("processing_status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Transient working copy for the agents. Cleared as soon as processing completes. */
    bodyExcerpt: text("body_excerpt"),
    links: jsonb("links").$type<{ url: string; text: string }[] | null>(),
    syncRunId: uuid("sync_run_id"),
    processedAt: ts("processed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gmail_messages_user_gmail_id_uq").on(t.userId, t.gmailMessageId),
    index("gmail_messages_user_status_idx").on(t.userId, t.processingStatus),
    index("gmail_messages_user_thread_idx").on(t.userId, t.threadId),
    index("gmail_messages_user_date_idx").on(t.userId, t.internalDate),
    index("gmail_messages_user_class_idx").on(t.userId, t.classification),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    companyKey: text("company_key").notNull(),
    position: text("position").notNull(),
    positionKey: text("position_key").notNull(),
    jobId: text("job_id"),
    source: text("source"),
    appliedAt: ts("applied_at").notNull(),
    status: applicationStatusEnum("status").notNull().default("applied"),
    statusUpdatedAt: ts("status_updated_at").notNull().defaultNow(),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    threadId: text("thread_id"),
    firstMessageId: uuid("first_message_id").references(() => gmailMessages.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** company_key + job id, or company_key + position_key. Prevents duplicate records. */
    dedupeKey: text("dedupe_key").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    /** Sync run that first created this record. Null for manual and sample records. */
    syncRunId: uuid("sync_run_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("applications_user_status_idx").on(t.userId, t.status),
    index("applications_user_company_idx").on(t.userId, t.companyKey),
    index("applications_user_applied_idx").on(t.userId, t.appliedAt),
    index("applications_user_thread_idx").on(t.userId, t.threadId),
    index("applications_user_jobid_idx").on(t.userId, t.jobId),
  ],
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    gmailMessageId: uuid("gmail_message_id").references(() => gmailMessages.id, { onDelete: "set null" }),
    eventType: eventTypeEnum("event_type").notNull(),
    /** Explicit target status for manual edits. Null for agent events. */
    toStatus: applicationStatusEnum("to_status"),
    /** Status the application held right after this event, recomputed deterministically. */
    resultingStatus: applicationStatusEnum("resulting_status"),
    occurredAt: ts("occurred_at").notNull(),
    confidence: real("confidence"),
    summary: text("summary"),
    actor: text("actor").notNull().default("agent"), // agent | user | system
    isSample: boolean("is_sample").notNull().default(false),
    syncRunId: uuid("sync_run_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("application_events_app_message_uq")
      .on(t.applicationId, t.gmailMessageId)
      .where(sql`${t.gmailMessageId} is not null`),
    index("application_events_app_time_idx").on(t.applicationId, t.occurredAt),
    index("application_events_user_created_idx").on(t.userId, t.createdAt),
    index("application_events_run_idx").on(t.syncRunId),
  ],
);

export const jobAlerts = pgTable(
  "job_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailMessageId: uuid("gmail_message_id").references(() => gmailMessages.id, { onDelete: "cascade" }),
    company: text("company"),
    position: text("position").notNull(),
    location: text("location"),
    url: text("url"),
    source: text("source"),
    receivedAt: ts("received_at").notNull(),
    itemKey: text("item_key").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    syncRunId: uuid("sync_run_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_alerts_user_item_uq").on(t.userId, t.gmailMessageId, t.itemKey),
    index("job_alerts_user_received_idx").on(t.userId, t.receivedAt),
  ],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailMessageId: uuid("gmail_message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),
    reason: reviewReasonEnum("reason").notNull(),
    proposedClassification: emailClassificationEnum("proposed_classification"),
    /** Validated extraction output the agents produced, so a human can accept it in one click. */
    proposedPayload: jsonb("proposed_payload").$type<Record<string, unknown> | null>(),
    candidateApplicationIds: jsonb("candidate_application_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    status: reviewStatusEnum("status").notNull().default("open"),
    resolvedApplicationId: uuid("resolved_application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    syncRunId: uuid("sync_run_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    uniqueIndex("review_items_user_message_uq").on(t.userId, t.gmailMessageId),
    index("review_items_user_status_idx").on(t.userId, t.status),
  ],
);

export type SyncCursor = {
  /** Gmail message IDs awaiting metadata fetch within the current ingest phase. */
  historyPageToken?: string | null;
  listPageToken?: string | null;
  startHistoryId?: string | null;
  anchorHistoryId?: string | null;
  query?: string | null;
  stage?: "history" | "list" | "done";
};

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: syncKindEnum("kind").notNull().default("incremental"),
    status: syncStatusEnum("status").notNull().default("queued"),
    phase: text("phase").notNull().default("queued"), // queued | ingest | classify | summarize | done
    trigger: text("trigger").notNull().default("manual"),
    params: jsonb("params").$type<{ after?: string | null; before?: string | null } | null>(),
    cursor: jsonb("cursor").$type<SyncCursor | null>(),
    workflowRunId: text("workflow_run_id"),
    messagesScanned: integer("messages_scanned").notNull().default(0),
    messagesNew: integer("messages_new").notNull().default(0),
    messagesRelevant: integer("messages_relevant").notNull().default(0),
    messagesProcessed: integer("messages_processed").notNull().default(0),
    applicationsAdded: integer("applications_added").notNull().default(0),
    applicationsUpdated: integer("applications_updated").notNull().default(0),
    eventsAdded: integer("events_added").notNull().default(0),
    alertsAdded: integer("alerts_added").notNull().default(0),
    reviewAdded: integer("review_added").notNull().default(0),
    errorsCount: integer("errors_count").notNull().default(0),
    error: text("error"),
    historyIdStart: text("history_id_start"),
    historyIdEnd: text("history_id_end"),
    heartbeatAt: ts("heartbeat_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    // Durable lock: at most one queued/running sync per user.
    uniqueIndex("sync_runs_one_active_per_user")
      .on(t.userId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("sync_runs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const dashboardSummaries = pgTable(
  "dashboard_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    /** Database-computed totals at the end of the run. */
    totals: jsonb("totals").$type<Record<string, number>>().notNull(),
    /** Database-computed counts of items detected during the run. */
    newCounts: jsonb("new_counts").$type<Record<string, number>>().notNull(),
    narrative: text("narrative").notNull(),
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    model: text("model"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dashboard_summaries_run_uq").on(t.syncRunId),
    index("dashboard_summaries_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type GmailConnection = typeof gmailConnections.$inferSelect;
export type GmailMessage = typeof gmailMessages.$inferSelect;
export type NewGmailMessage = typeof gmailMessages.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type JobAlert = typeof jobAlerts.$inferSelect;
export type ReviewItem = typeof reviewItems.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type DashboardSummary = typeof dashboardSummaries.$inferSelect;
