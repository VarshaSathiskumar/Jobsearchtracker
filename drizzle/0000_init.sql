CREATE TYPE "public"."application_status" AS ENUM('applied', 'callback', 'assessment', 'interview_scheduled', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."email_classification" AS ENUM('application_confirmation', 'rejection', 'recruiter_callback', 'interview_scheduling', 'job_alert', 'other_career', 'irrelevant');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('applied', 'rejected', 'callback', 'assessment', 'interview_scheduled', 'interview_rescheduled', 'offer', 'withdrawn', 'update', 'manual_edit');--> statement-breakpoint
CREATE TYPE "public"."message_processing_status" AS ENUM('pending', 'processed', 'skipped', 'review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_reason" AS ENUM('low_confidence', 'unmatched', 'ambiguous_match', 'extraction_failed', 'agent_error');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."sync_kind" AS ENUM('incremental', 'backfill', 'rescan');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"gmail_message_id" uuid,
	"event_type" "event_type" NOT NULL,
	"to_status" "application_status",
	"resulting_status" "application_status",
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" real,
	"summary" text,
	"actor" text DEFAULT 'agent' NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company" text NOT NULL,
	"company_key" text NOT NULL,
	"position" text NOT NULL,
	"position_key" text NOT NULL,
	"job_id" text,
	"source" text,
	"applied_at" timestamp with time zone NOT NULL,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" text,
	"first_message_id" uuid,
	"notes" text,
	"dedupe_key" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"manually_edited" boolean DEFAULT false NOT NULL,
	"sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"totals" jsonb NOT NULL,
	"new_counts" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_email" text NOT NULL,
	"encrypted_refresh_token" text,
	"scopes" text DEFAULT '' NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"history_id" text,
	"backfill_state" jsonb,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"internal_date" timestamp with time zone NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"from_name" text,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"label_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"classification" "email_classification",
	"classification_confidence" real,
	"classification_source" text,
	"processing_status" "message_processing_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"body_excerpt" text,
	"links" jsonb,
	"sync_run_id" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_message_id" uuid,
	"company" text,
	"position" text NOT NULL,
	"location" text,
	"url" text,
	"source" text,
	"received_at" timestamp with time zone NOT NULL,
	"item_key" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_message_id" uuid NOT NULL,
	"reason" "review_reason" NOT NULL,
	"proposed_classification" "email_classification",
	"proposed_payload" jsonb,
	"candidate_application_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"resolved_application_id" uuid,
	"sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "sync_kind" DEFAULT 'incremental' NOT NULL,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"params" jsonb,
	"cursor" jsonb,
	"workflow_run_id" text,
	"messages_scanned" integer DEFAULT 0 NOT NULL,
	"messages_new" integer DEFAULT 0 NOT NULL,
	"messages_relevant" integer DEFAULT 0 NOT NULL,
	"messages_processed" integer DEFAULT 0 NOT NULL,
	"applications_added" integer DEFAULT 0 NOT NULL,
	"applications_updated" integer DEFAULT 0 NOT NULL,
	"events_added" integer DEFAULT 0 NOT NULL,
	"alerts_added" integer DEFAULT 0 NOT NULL,
	"review_added" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"history_id_start" text,
	"history_id_end" text,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_gmail_message_id_gmail_messages_id_fk" FOREIGN KEY ("gmail_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_first_message_id_gmail_messages_id_fk" FOREIGN KEY ("first_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_summaries" ADD CONSTRAINT "dashboard_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_summaries" ADD CONSTRAINT "dashboard_summaries_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_messages" ADD CONSTRAINT "gmail_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_alerts" ADD CONSTRAINT "job_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_alerts" ADD CONSTRAINT "job_alerts_gmail_message_id_gmail_messages_id_fk" FOREIGN KEY ("gmail_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_gmail_message_id_gmail_messages_id_fk" FOREIGN KEY ("gmail_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_application_id_applications_id_fk" FOREIGN KEY ("resolved_application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_events_app_message_uq" ON "application_events" USING btree ("application_id","gmail_message_id") WHERE "application_events"."gmail_message_id" is not null;--> statement-breakpoint
CREATE INDEX "application_events_app_time_idx" ON "application_events" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX "application_events_user_created_idx" ON "application_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "application_events_run_idx" ON "application_events" USING btree ("sync_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_dedupe_uq" ON "applications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "applications_user_company_idx" ON "applications" USING btree ("user_id","company_key");--> statement-breakpoint
CREATE INDEX "applications_user_applied_idx" ON "applications" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE INDEX "applications_user_thread_idx" ON "applications" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "applications_user_jobid_idx" ON "applications" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_summaries_run_uq" ON "dashboard_summaries" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "dashboard_summaries_user_created_idx" ON "dashboard_summaries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_messages_user_gmail_id_uq" ON "gmail_messages" USING btree ("user_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "gmail_messages_user_status_idx" ON "gmail_messages" USING btree ("user_id","processing_status");--> statement-breakpoint
CREATE INDEX "gmail_messages_user_thread_idx" ON "gmail_messages" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "gmail_messages_user_date_idx" ON "gmail_messages" USING btree ("user_id","internal_date");--> statement-breakpoint
CREATE INDEX "gmail_messages_user_class_idx" ON "gmail_messages" USING btree ("user_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX "job_alerts_user_item_uq" ON "job_alerts" USING btree ("user_id","gmail_message_id","item_key");--> statement-breakpoint
CREATE INDEX "job_alerts_user_received_idx" ON "job_alerts" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_user_message_uq" ON "review_items" USING btree ("user_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "review_items_user_status_idx" ON "review_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_active_per_user" ON "sync_runs" USING btree ("user_id") WHERE "sync_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "sync_runs_user_created_idx" ON "sync_runs" USING btree ("user_id","created_at");