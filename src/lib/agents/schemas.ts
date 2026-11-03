import { z } from "zod";
import { EMAIL_CLASSIFICATIONS } from "@/lib/constants";

const confidence = z.number().min(0).max(1);
const shortText = (max: number) => z.string().max(max);

export const ClassificationSchema = z.object({
  classification: z.enum(EMAIL_CLASSIFICATIONS).describe("The single best category for this email."),
  confidence: confidence.describe("Probability between 0 and 1 that the category is correct."),
  reasoning: shortText(240).describe("One short sentence explaining the decision. Do not quote private details."),
});
export type ClassificationOutput = z.infer<typeof ClassificationSchema>;

export const ApplicationExtractionSchema = z.object({
  isApplicationConfirmation: z.boolean().describe("True only if the email confirms that the user submitted an application."),
  company: z.string().max(120).nullable().describe("Hiring company name, not the ATS vendor (Greenhouse, Workday, ...)."),
  jobTitle: z.string().max(160).nullable().describe("Exact job title as written in the email."),
  applicationDate: z.string().max(40).nullable().describe("ISO date (YYYY-MM-DD) the application was submitted, if stated. Otherwise null."),
  jobId: z.string().max(80).nullable().describe("Requisition or job id if present, else null."),
  source: z.string().max(60).nullable().describe("Where the user applied, e.g. LinkedIn, Indeed, company website, Greenhouse. Null if unknown."),
  confidence,
});
export type ApplicationExtraction = z.infer<typeof ApplicationExtractionSchema>;

export const RESPONSE_OUTCOMES = [
  "rejection",
  "recruiter_callback",
  "assessment",
  "interview_invitation",
  "interview_rescheduled",
  "offer",
  "withdrawn",
  "other_update",
] as const;
export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];

export const ResponseExtractionSchema = z.object({
  outcome: z.enum(RESPONSE_OUTCOMES),
  company: z.string().max(120).nullable(),
  jobTitle: z.string().max(160).nullable().describe("The specific role the email refers to, or null if it names none."),
  jobId: z.string().max(80).nullable(),
  interviewDetails: shortText(160).nullable().describe("Date/time/format for interview related outcomes, otherwise null."),
  summary: shortText(200).describe("One neutral sentence describing the outcome for a timeline."),
  confidence: confidence.describe("Confidence in the outcome extraction."),
  matchedApplicationId: z
    .string()
    .nullable()
    .describe("id of one candidate returned by find_candidate_applications that this email is about, or null when unsure."),
  matchConfidence: confidence.describe("Confidence in matchedApplicationId. 0 when null."),
  matchEvidence: shortText(200).nullable().describe("Which facts support the match (job id, title, thread)."),
});
export type ResponseExtraction = z.infer<typeof ResponseExtractionSchema>;

export const JobAlertExtractionSchema = z.object({
  alertSource: z.string().max(60).nullable().describe("Service that sent the alert, e.g. LinkedIn, Indeed."),
  items: z
    .array(
      z.object({
        company: z.string().max(120).nullable(),
        title: z.string().max(160),
        location: z.string().max(120).nullable(),
        url: z.string().max(2000).nullable().describe("Must be copied exactly from the provided links list, else null."),
      }),
    )
    .max(30),
});
export type JobAlertExtraction = z.infer<typeof JobAlertExtractionSchema>;

export const SummarySchema = z.object({
  narrative: shortText(900).describe("Two to four sentences summarizing what changed."),
  highlights: z.array(shortText(160)).max(5),
});
export type SummaryOutput = z.infer<typeof SummarySchema>;
