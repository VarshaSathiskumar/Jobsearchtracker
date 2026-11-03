import { describe, expect, it } from "vitest";
import { buildGmailQuery, prefilter } from "@/lib/prefilter";
import { ClassificationSchema, JobAlertExtractionSchema, ResponseExtractionSchema } from "@/lib/agents/schemas";
import { REVIEW_CONFIDENCE_THRESHOLD } from "@/lib/constants";

const m = (fromEmail: string, subject: string, snippet = "", fromName: string | null = null) => ({ fromEmail, subject, snippet, fromName });

describe("deterministic classification shortcuts", () => {
  it("short-circuits known job alert senders", () => {
    const r = prefilter(m("jobalerts-noreply@linkedin.com", "5 new jobs for you", "Software Engineer at Acme"));
    expect(r).toMatchObject({ verdict: "job_alert", classification: "job_alert" });
  });

  it("short-circuits alert-style subjects from job boards", () => {
    const r = prefilter(m("noreply@indeed.com", "New jobs matching your search"));
    expect(r.verdict).toBe("job_alert");
  });

  it("does not shortcut a rejection, it needs the model", () => {
    const r = prefilter(m("no-reply@greenhouse.io", "Update on your application", "Unfortunately we are moving forward with other candidates"));
    expect(r.verdict).toBe("candidate");
  });

  it("treats applicant tracking systems as candidates", () => {
    expect(prefilter(m("no-reply@us.greenhouse-mail.io", "hello")).verdict).toBe("irrelevant"); // unknown domain without keywords
    expect(prefilter(m("jobs@myworkdayjobs.com", "Thank you")).verdict).toBe("candidate");
  });

  it("drops mail without career signals", () => {
    expect(prefilter(m("deals@shop.example.com", "Your weekend lunch special", "50% off")).verdict).toBe("irrelevant");
  });

  it("drops spam and known non-career senders", () => {
    expect(prefilter({ ...m("x@y.com", "interview offer!!!"), labelIds: ["SPAM"] }).verdict).toBe("irrelevant");
    expect(prefilter(m("news@medium.com", "Top stories about careers")).verdict).toBe("irrelevant");
  });

  it("keeps recruiter mail with career keywords", () => {
    expect(prefilter(m("jane@acme.com", "Quick chat about your application", "")).verdict).toBe("candidate");
    expect(prefilter(m("jane@acme.com", "Interview invitation: Software Engineer")).verdict).toBe("candidate");
  });

  it("builds a Gmail query with date bounds and excludes spam", () => {
    const q = buildGmailQuery({ after: "2026/01/01", before: "2026/03/01" });
    expect(q).toContain("-in:spam");
    expect(q).toContain("after:2026/01/01");
    expect(q).toContain("before:2026/03/01");
  });
});

describe("structured output validation", () => {
  it("accepts a valid classification and rejects unknown categories or bad confidence", () => {
    expect(ClassificationSchema.safeParse({ classification: "rejection", confidence: 0.9, reasoning: "x" }).success).toBe(true);
    expect(ClassificationSchema.safeParse({ classification: "spam", confidence: 0.9, reasoning: "x" }).success).toBe(false);
    expect(ClassificationSchema.safeParse({ classification: "rejection", confidence: 1.4, reasoning: "x" }).success).toBe(false);
  });

  it("validates response extraction", () => {
    const ok = ResponseExtractionSchema.safeParse({
      outcome: "rejection", company: "A", jobTitle: null, jobId: null, interviewDetails: null, summary: "s", confidence: 0.9,
      matchedApplicationId: null, matchConfidence: 0, matchEvidence: null,
    });
    expect(ok.success).toBe(true);
    expect(ResponseExtractionSchema.safeParse({ outcome: "hired", company: null }).success).toBe(false);
  });

  it("caps job alert items", () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ company: "A", title: `T${i}`, location: null, url: null }));
    expect(JobAlertExtractionSchema.safeParse({ alertSource: null, items }).success).toBe(false);
  });

  it("uses a sensible review threshold", () => {
    expect(REVIEW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.5);
    expect(REVIEW_CONFIDENCE_THRESHOLD).toBeLessThan(0.9);
  });
});
