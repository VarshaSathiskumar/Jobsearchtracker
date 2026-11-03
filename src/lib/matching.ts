import { companiesMatch, normalizeJobId, titleSimilarity } from "./normalize";

export type CandidateApplication = {
  id: string;
  company: string;
  position: string;
  jobId: string | null;
  threadIds: string[]; // threads of all emails already linked to the application
};

export type MatchQuery = {
  company: string | null;
  position: string | null;
  jobId: string | null;
  threadId: string;
};

export type MatchResult =
  | { kind: "matched"; applicationId: string; score: number; reasons: string[] }
  | { kind: "ambiguous"; candidateIds: string[]; reasons: string[] }
  | { kind: "none"; reasons: string[] };

const TITLE_MATCH = 0.6;
const TITLE_MARGIN = 0.2;
const TITLE_CONFLICT = 0.35;

type Scored = { app: CandidateApplication; threadMatch: boolean; title: number | null };

/**
 * Deterministic application matching. A company match alone is only sufficient when the company has
 * exactly one application and the email does not contradict its title. This guarantees a rejection
 * for one role cannot be applied to another role at the same company.
 */
export function matchApplication(query: MatchQuery, apps: CandidateApplication[]): MatchResult {
  const qJob = normalizeJobId(query.jobId);

  // 1. A job id is the strongest identifier, even when the company string differs.
  if (qJob) {
    const byJob = apps.filter((a) => normalizeJobId(a.jobId) === qJob);
    if (byJob.length === 1) return { kind: "matched", applicationId: byJob[0].id, score: 1, reasons: ["job id match"] };
    if (byJob.length > 1) {
      const sameCompany = query.company ? byJob.filter((a) => companiesMatch(a.company, query.company!)) : [];
      if (sameCompany.length === 1)
        return { kind: "matched", applicationId: sameCompany[0].id, score: 0.98, reasons: ["job id and company match"] };
      return { kind: "ambiguous", candidateIds: byJob.map((a) => a.id), reasons: ["multiple applications share this job id"] };
    }
  }

  // 2. Everything else is restricted to applications at the same company.
  const sameCompany = query.company ? apps.filter((a) => companiesMatch(a.company, query.company!)) : [];
  const scored: Scored[] = sameCompany.map((app) => ({
    app,
    threadMatch: app.threadIds.includes(query.threadId),
    title: query.position ? titleSimilarity(query.position, app.position) : null,
  }));

  if (scored.length === 0) {
    // A reply in a known thread is still strong evidence when the company could not be extracted.
    const byThread = apps.filter((a) => a.threadIds.includes(query.threadId));
    if (!query.company && byThread.length === 1)
      return { kind: "matched", applicationId: byThread[0].id, score: 0.85, reasons: ["email thread match"] };
    return { kind: "none", reasons: [query.company ? "no application at this company" : "no company extracted"] };
  }

  // 3. Thread continuity within the company.
  const threadHits = scored.filter((s) => s.threadMatch);
  if (threadHits.length === 1) {
    const t = threadHits[0];
    if (t.title === null || t.title >= TITLE_CONFLICT)
      return { kind: "matched", applicationId: t.app.id, score: 0.95, reasons: ["email thread and company match"] };
  }

  // 4. Title similarity with a clear margin over the runner-up.
  if (query.position) {
    const ranked = [...scored].sort((a, b) => (b.title ?? 0) - (a.title ?? 0));
    const best = ranked[0];
    const second = ranked[1];
    if ((best.title ?? 0) >= TITLE_MATCH && (!second || (best.title ?? 0) - (second.title ?? 0) >= TITLE_MARGIN)) {
      return {
        kind: "matched",
        applicationId: best.app.id,
        score: Math.min(0.95, 0.6 + (best.title ?? 0) * 0.35),
        reasons: ["company and title match"],
      };
    }
    if (scored.length === 1 && (best.title ?? 0) < TITLE_CONFLICT) {
      return { kind: "none", reasons: ["email title conflicts with the only application at this company"] };
    }
    const plausible = ranked.filter((r) => (r.title ?? 0) >= TITLE_CONFLICT);
    if (scored.length === 1 && plausible.length === 1)
      return { kind: "matched", applicationId: best.app.id, score: 0.75, reasons: ["only application at company, title similar"] };
    return {
      kind: "ambiguous",
      candidateIds: (plausible.length ? plausible : ranked).map((r) => r.app.id),
      reasons: ["title does not uniquely identify an application"],
    };
  }

  // 5. No title in the email: only safe when the company has a single application.
  if (scored.length === 1)
    return { kind: "matched", applicationId: scored[0].app.id, score: 0.7, reasons: ["only application at company"] };
  return {
    kind: "ambiguous",
    candidateIds: scored.map((s) => s.app.id),
    reasons: ["multiple applications at this company and the email names no role"],
  };
}

export type LlmMatchProposal = { applicationId: string | null; confidence: number; evidence?: string | null };

/**
 * Combines the deterministic matcher with an LLM proposal. The model may only choose among the
 * candidate applications supplied by code, and only when there is corroborating hard evidence.
 */
export function resolveMatch(
  deterministic: MatchResult,
  proposal: LlmMatchProposal | null,
  query: MatchQuery,
  apps: CandidateApplication[],
): MatchResult {
  if (deterministic.kind === "matched") return deterministic;
  if (!proposal?.applicationId || proposal.confidence < 0.8) return deterministic;

  const app = apps.find((a) => a.id === proposal.applicationId);
  if (!app) return deterministic;
  if (!query.company || !companiesMatch(app.company, query.company)) return deterministic;

  const sameCompany = apps.filter((a) => companiesMatch(a.company, query.company!));
  const jobEvidence = !!normalizeJobId(query.jobId) && normalizeJobId(app.jobId) === normalizeJobId(query.jobId);
  const threadEvidence = app.threadIds.includes(query.threadId);
  const titleEvidence = !!query.position && titleSimilarity(query.position, app.position) >= 0.4;
  const rivalWithEvidence = sameCompany.some(
    (a) => a.id !== app.id && !!query.position && titleSimilarity(query.position, a.position) >= titleSimilarity(query.position, app.position),
  );

  if ((jobEvidence || threadEvidence || titleEvidence) && !rivalWithEvidence) {
    return { kind: "matched", applicationId: app.id, score: proposal.confidence * 0.9, reasons: ["agent proposal corroborated by evidence"] };
  }
  return deterministic;
}
