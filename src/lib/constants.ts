// Shared enumerations used by the database schema, agents and UI.

export const APPLICATION_STATUSES = [
  "applied",
  "callback",
  "assessment",
  "interview_scheduled",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const EVENT_TYPES = [
  "applied",
  "rejected",
  "callback",
  "assessment",
  "interview_scheduled",
  "interview_rescheduled",
  "offer",
  "withdrawn",
  "update",
  "manual_edit",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EMAIL_CLASSIFICATIONS = [
  "application_confirmation",
  "rejection",
  "recruiter_callback",
  "interview_scheduling",
  "job_alert",
  "other_career",
  "irrelevant",
] as const;
export type EmailClassification = (typeof EMAIL_CLASSIFICATIONS)[number];

export const MESSAGE_PROCESSING_STATUSES = ["pending", "processed", "skipped", "review", "failed"] as const;
export type MessageProcessingStatus = (typeof MESSAGE_PROCESSING_STATUSES)[number];

export const SYNC_STATUSES = ["queued", "running", "completed", "failed", "partial"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_KINDS = ["incremental", "backfill", "rescan"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const REVIEW_REASONS = [
  "low_confidence",
  "unmatched",
  "ambiguous_match",
  "extraction_failed",
  "agent_error",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const CONNECTION_STATUSES = ["connected", "needs_reauth", "disconnected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  callback: "Callback",
  assessment: "Assessment",
  interview_scheduled: "Interview scheduled",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const CLASSIFICATION_LABELS: Record<EmailClassification, string> = {
  application_confirmation: "Application confirmation",
  rejection: "Rejection",
  recruiter_callback: "Recruiter callback",
  interview_scheduling: "Interview scheduling",
  job_alert: "Job alert",
  other_career: "Other career-related",
  irrelevant: "Irrelevant",
};

export const EVENT_LABELS: Record<EventType, string> = {
  applied: "Application submitted",
  rejected: "Rejection received",
  callback: "Recruiter callback",
  assessment: "Assessment requested",
  interview_scheduled: "Interview scheduled",
  interview_rescheduled: "Interview rescheduled",
  offer: "Offer received",
  withdrawn: "Application withdrawn",
  update: "Update received",
  manual_edit: "Edited manually",
};

/** Statuses grouped under the "Interview Callbacks" page and KPI card. */
export const CALLBACK_STATUSES: ApplicationStatus[] = ["callback", "assessment"];

/** Confidence below this value sends a classification or match to Needs Review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;
