const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc",
  "lp", "llp", "sa", "ag", "bv", "pty", "the", "group", "holdings",
]);

const TITLE_NOISE = new Set(["the", "a", "an", "of", "and", "for", "in", "at", "to", "with", "-", "|"]);

const TITLE_SYNONYMS: Record<string, string> = {
  sr: "senior",
  jr: "junior",
  swe: "software",
  eng: "engineer",
  engr: "engineer",
  engineering: "engineer",
  developer: "engineer",
  dev: "engineer",
  mgr: "manager",
  ii: "2",
  iii: "3",
  iv: "4",
  i: "1",
};

export function normalizeCompany(input: string): string {
  const tokens = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !COMPANY_SUFFIXES.has(t));
  return tokens.join("");
}

export function titleTokens(input: string): string[] {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s+#]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLE_NOISE.has(t))
    .map((t) => TITLE_SYNONYMS[t] ?? t);
}

export function normalizeTitle(input: string): string {
  return titleTokens(input).join(" ");
}

/** Normalizes a requisition or job id so formatting differences do not hide a match. */
export function normalizeJobId(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  // Strip labels such as "Req ID:", "Job #", "Requisition number".
  for (let i = 0; i < 3; i++) v = v.replace(/^(req(uisition)?|job|id|no|number|ref(erence)?|#)[\s:#.-]*/i, "");
  v = v.replace(/[^a-z0-9]/g, "");
  return v.length >= 3 ? v : null;
}

export function dedupeKey(args: { company: string; position: string; jobId?: string | null }): string {
  const c = normalizeCompany(args.company);
  const j = normalizeJobId(args.jobId);
  return j ? `${c}|job:${j}` : `${c}|pos:${normalizeTitle(args.position)}`;
}

/** Sorensen-style token overlap in [0, 1]. Containment of the shorter title scores high. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = (2 * inter) / (ta.size + tb.size);
  const containment = inter / Math.min(ta.size, tb.size);
  return Math.max(dice, containment * 0.85);
}

export function companiesMatch(a: string, b: string): boolean {
  const ka = normalizeCompany(a);
  const kb = normalizeCompany(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Allow "Acme" vs "Acme Labs" style differences only when one is a prefix of the other and long enough.
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 4 && long.startsWith(short);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + "...";
}
