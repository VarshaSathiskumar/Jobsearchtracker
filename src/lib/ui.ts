import type { ApplicationStatus, EmailClassification } from "./constants";

/** Accessible badge palettes (AA contrast on the tinted background). Each status also has a distinct shape cue. */
export const STATUS_STYLES: Record<ApplicationStatus, { badge: string; dot: string; chart: string }> = {
  applied: { badge: "bg-blue-50 text-blue-800 border-blue-200", dot: "bg-blue-500", chart: "#3b82f6" },
  callback: { badge: "bg-violet-50 text-violet-800 border-violet-200", dot: "bg-violet-500", chart: "#8b5cf6" },
  assessment: { badge: "bg-indigo-50 text-indigo-800 border-indigo-200", dot: "bg-indigo-500", chart: "#6366f1" },
  interview_scheduled: { badge: "bg-teal-50 text-teal-800 border-teal-200", dot: "bg-teal-500", chart: "#14b8a6" },
  offer: { badge: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", chart: "#10b981" },
  rejected: { badge: "bg-rose-50 text-rose-800 border-rose-200", dot: "bg-rose-500", chart: "#f43f5e" },
  withdrawn: { badge: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-400", chart: "#94a3b8" },
};

export const CLASSIFICATION_STYLES: Record<EmailClassification, string> = {
  application_confirmation: "bg-blue-50 text-blue-800 border-blue-200",
  rejection: "bg-rose-50 text-rose-800 border-rose-200",
  recruiter_callback: "bg-violet-50 text-violet-800 border-violet-200",
  interview_scheduling: "bg-teal-50 text-teal-800 border-teal-200",
  job_alert: "bg-amber-50 text-amber-900 border-amber-200",
  other_career: "bg-slate-100 text-slate-700 border-slate-300",
  irrelevant: "bg-slate-100 text-slate-600 border-slate-200",
};
