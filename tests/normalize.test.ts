import { describe, expect, it } from "vitest";
import { companiesMatch, dedupeKey, normalizeCompany, normalizeJobId, normalizeTitle, titleSimilarity } from "@/lib/normalize";

describe("normalization and deduplication keys", () => {
  it("normalizes company suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("ACME Corporation")).toBe("acme");
    expect(normalizeCompany("Johnson & Johnson LLC")).toBe("johnsonandjohnson");
  });

  it("matches company variants but not unrelated short names", () => {
    expect(companiesMatch("Acme Inc", "ACME")).toBe(true);
    expect(companiesMatch("Acme", "Acme Labs")).toBe(true);
    expect(companiesMatch("Ace", "Acme")).toBe(false);
    expect(companiesMatch("Meta", "Metabase")).toBe(true); // prefix rule, documented limitation
    expect(companiesMatch("", "Acme")).toBe(false);
  });

  it("normalizes job ids", () => {
    expect(normalizeJobId("Req ID: R-12345")).toBe("r12345");
    expect(normalizeJobId("#4471")).toBe("4471");
    expect(normalizeJobId("ab")).toBeNull();
    expect(normalizeJobId(null)).toBeNull();
  });

  it("produces the same dedupe key for formatting differences", () => {
    const a = dedupeKey({ company: "Contoso Cloud, Inc.", position: "Sr. Platform Engineer" });
    const b = dedupeKey({ company: "contoso cloud", position: "Senior Platform Engineer" });
    expect(a).toBe(b);
  });

  it("prefers the job id in the dedupe key", () => {
    const a = dedupeKey({ company: "Acme", position: "Engineer", jobId: "REQ-1001" });
    const b = dedupeKey({ company: "Acme", position: "Software Engineer", jobId: "req1001" });
    expect(a).toBe(b);
  });

  it("distinguishes different roles at one company", () => {
    expect(dedupeKey({ company: "Acme", position: "Data Analyst" })).not.toBe(dedupeKey({ company: "Acme", position: "Platform Engineer" }));
  });

  it("scores title similarity", () => {
    expect(titleSimilarity("Software Engineer II", "Software Engineer 2")).toBeGreaterThan(0.9);
    expect(titleSimilarity("Platform Engineer", "Site Reliability Engineer")).toBeLessThan(0.6);
    expect(titleSimilarity("Data Analyst", "Senior Data Analyst")).toBeGreaterThan(0.6);
    expect(normalizeTitle("Sr. SWE (Remote)")).toBe("senior software");
  });
});
