import type { EmailClassification } from "./constants";

export type PrefilterInput = {
  fromEmail: string;
  fromName?: string | null;
  subject: string;
  snippet: string;
  labelIds?: string[];
};

export type PrefilterResult =
  | { verdict: "irrelevant"; reason: string }
  | { verdict: "candidate"; reason: string }
  | { verdict: "job_alert"; reason: string; classification: EmailClassification; confidence: number };

const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "workday.com", "myworkdayjobs.com", "icims.com", "smartrecruiters.com",
  "ashbyhq.com", "jobvite.com", "taleo.net", "successfactors", "bamboohr.com", "workable.com", "breezy.hr",
  "recruitee.com", "teamtailor.com", "applytojob.com", "hire.lever.co", "eightfold.ai", "paylocity.com",
  "oraclecloud.com", "adp.com", "rippling.com", "gusto.com", "jazzhr.com", "pinpointhq.com", "dayforce.com",
];

const ALERT_SENDERS = [
  "jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com", "jobs-listings@linkedin.com",
  "alert@indeed.com", "noreply@indeed.com", "jobalert@glassdoor.com", "noreply@glassdoor.com",
  "alerts@ziprecruiter.com", "alert@ziprecruiter.com", "jobs@wellfound.com", "no-reply@dice.com",
  "jobalerts@monster.com", "noreply@jobleads.com",
];

const ALERT_SUBJECT = /\b(job alerts?|new jobs? (for|matching)|jobs? (you may|might) (like|be interested)|recommended jobs?|jobs? picked for you|\d+\+? new .{0,40}jobs?)\b/i;

const JOB_KEYWORDS = new RegExp(
  [
    "applic(ation|ied|ant)", "apply", "candidate", "candidacy", "interview", "recruit", "hiring", "position",
    "role\\b", "job", "career", "offer", "assessment", "coding challenge", "take-?home", "screening",
    "next steps", "unfortunately", "move forward", "moving forward", "your resume", "talent", "opportunity",
    "phone screen", "onsite", "on-site", "requisition", "thank you for (your )?interest",
  ].join("|"),
  "i",
);

const OBVIOUS_NOISE_SENDER = /(@(mail\.)?(medium|substack|quora|pinterest|facebookmail|twitter|x|instagram|spotify|netflix|uber|doordash|amazon|paypal|stripe|github|notion|slack|zoom|dropbox)\.com)$/i;

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Deterministic first pass. It never decides between rejection and interview, that is the
 * Classification Agent's job. It only (a) drops mail that cannot be job related, (b) short-circuits
 * well known job-alert senders.
 */
export function prefilter(m: PrefilterInput): PrefilterResult {
  const from = m.fromEmail.toLowerCase();
  const domain = domainOf(from);
  const text = `${m.subject} ${m.snippet}`;

  if (ALERT_SENDERS.includes(from) || (ALERT_SUBJECT.test(m.subject) && /(linkedin|indeed|glassdoor|ziprecruiter|wellfound|dice|monster|jobleads|jooble|simplyhired|builtin|otta|handshake)/i.test(domain + " " + (m.fromName ?? "")))) {
    return { verdict: "job_alert", reason: "known job alert sender", classification: "job_alert", confidence: 0.95 };
  }

  if (ATS_DOMAINS.some((d) => domain === d || domain.endsWith("." + d) || domain.includes(d))) {
    return { verdict: "candidate", reason: "applicant tracking system sender" };
  }

  if (m.labelIds?.includes("SPAM") || m.labelIds?.includes("TRASH")) {
    return { verdict: "irrelevant", reason: "spam or trash" };
  }

  if (OBVIOUS_NOISE_SENDER.test(from) && !/interview|application|applied|offer letter/i.test(m.subject)) {
    return { verdict: "irrelevant", reason: "known non-career sender" };
  }

  if (ALERT_SUBJECT.test(m.subject)) {
    return { verdict: "candidate", reason: "alert-like subject from unknown sender" };
  }

  if (JOB_KEYWORDS.test(text)) return { verdict: "candidate", reason: "career keywords" };

  return { verdict: "irrelevant", reason: "no career signals" };
}

/**
 * Gmail search query used for backfills so we do not download an entire mailbox. Broad on purpose,
 * the prefilter and the agents are the precise stages.
 */
export function buildGmailQuery(opts: { after?: string | null; before?: string | null }): string {
  const terms = [
    "application", "applied", "applying", "interview", "candidate", "recruiter", "recruiting", "hiring",
    "position", "career", "careers", "job", "jobs", "offer", "assessment", "\"next steps\"", "unfortunately",
    "\"thank you for your interest\"", "opportunity", "resume",
  ];
  const parts = ["-in:spam", "-in:trash", `(${terms.join(" OR ")})`];
  if (opts.after) parts.push(`after:${opts.after}`);
  if (opts.before) parts.push(`before:${opts.before}`);
  return parts.join(" ");
}
