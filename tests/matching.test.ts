import { describe, expect, it } from "vitest";
import { matchApplication, resolveMatch, type CandidateApplication, type MatchQuery } from "@/lib/matching";

const app = (id: string, company: string, position: string, jobId: string | null = null, threadIds: string[] = []): CandidateApplication => ({ id, company, position, jobId, threadIds });
const q = (p: Partial<MatchQuery>): MatchQuery => ({ company: null, position: null, jobId: null, threadId: "t-new", ...p });

const contoso = [app("platform", "Contoso Cloud", "Platform Engineer", "R-100", ["t-1"]), app("sre", "Contoso Cloud", "Site Reliability Engineer", "R-200", ["t-2"])];

describe("application matching", () => {
  it("matches by job id first", () => {
    const r = matchApplication(q({ company: "Contoso", jobId: "R200" }), contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "sre" });
  });

  it("matches by title within the company", () => {
    const r = matchApplication(q({ company: "Contoso Cloud", position: "Platform Engineer" }), contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "platform" });
  });

  it("matches a reply in the same email thread", () => {
    const r = matchApplication(q({ company: "Contoso Cloud", threadId: "t-2" }), contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "sre" });
  });

  it("ACCEPTANCE 5: a rejection naming no role is NOT applied to either role at the same company", () => {
    const r = matchApplication(q({ company: "Contoso Cloud", position: null }), contoso);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidateIds.sort()).toEqual(["platform", "sre"]);
  });

  it("ACCEPTANCE 5: a rejection for one title only matches that title", () => {
    const r = matchApplication(q({ company: "Contoso Cloud", position: "Site Reliability Engineer" }), contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "sre" });
  });

  it("does not match a role that conflicts with the only application at the company", () => {
    const r = matchApplication(q({ company: "Initech", position: "Marketing Director" }), [app("x", "Initech", "Backend Engineer")]);
    expect(r.kind).toBe("none");
  });

  it("allows a company-only match when exactly one application exists", () => {
    const r = matchApplication(q({ company: "Initech" }), [app("x", "Initech", "Backend Engineer")]);
    expect(r).toMatchObject({ kind: "matched", applicationId: "x" });
  });

  it("returns none when the company has no applications", () => {
    expect(matchApplication(q({ company: "Hooli" }), contoso).kind).toBe("none");
  });

  it("is ambiguous when two roles are equally similar", () => {
    const apps = [app("a", "Acme", "Software Engineer"), app("b", "Acme", "Software Engineer, Platform")];
    const r = matchApplication(q({ company: "Acme", position: "Software Engineer" }), apps);
    expect(["ambiguous", "matched"]).toContain(r.kind);
    if (r.kind === "matched") expect(r.applicationId).toBe("a");
  });

  it("handles duplicate job ids by falling back to company", () => {
    const apps = [app("a", "Acme", "Engineer", "R1"), app("b", "Other Co", "Engineer", "R1")];
    const r = matchApplication(q({ company: "Acme", jobId: "R1" }), apps);
    expect(r).toMatchObject({ kind: "matched", applicationId: "a" });
  });
});

describe("resolving LLM proposals against deterministic matching", () => {
  const query = q({ company: "Contoso Cloud", position: null });
  const det = matchApplication(query, contoso);

  it("ignores a proposal without corroborating evidence", () => {
    const r = resolveMatch(det, { applicationId: "platform", confidence: 0.95 }, query, contoso);
    expect(r.kind).toBe("ambiguous");
  });

  it("ignores low-confidence proposals", () => {
    const query2 = q({ company: "Contoso Cloud", position: "Platform Engineering" });
    const r = resolveMatch({ kind: "ambiguous", candidateIds: ["platform", "sre"], reasons: [] }, { applicationId: "platform", confidence: 0.5 }, query2, contoso);
    expect(r.kind).toBe("ambiguous");
  });

  it("rejects ids that were not candidates", () => {
    const r = resolveMatch(det, { applicationId: "does-not-exist", confidence: 0.99 }, query, contoso);
    expect(r.kind).toBe("ambiguous");
  });

  it("rejects a proposal at a different company", () => {
    const apps = [...contoso, app("other", "Initech", "Platform Engineer")];
    const r = resolveMatch(det, { applicationId: "other", confidence: 0.99 }, query, apps);
    expect(r.kind).toBe("ambiguous");
  });

  it("accepts a corroborated proposal when the deterministic matcher is unsure", () => {
    const query3 = q({ company: "Contoso Cloud", position: "Platform Eng, Infrastructure" });
    const base = { kind: "ambiguous" as const, candidateIds: ["platform", "sre"], reasons: [] };
    const r = resolveMatch(base, { applicationId: "platform", confidence: 0.9, evidence: "title" }, query3, contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "platform" });
  });

  it("never overrides a deterministic match", () => {
    const query4 = q({ company: "Contoso Cloud", position: "Platform Engineer" });
    const m = matchApplication(query4, contoso);
    const r = resolveMatch(m, { applicationId: "sre", confidence: 0.99 }, query4, contoso);
    expect(r).toMatchObject({ kind: "matched", applicationId: "platform" });
  });
});
