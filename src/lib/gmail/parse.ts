import type { GmailPart, GmailRawMessage } from "./client";

export type ParsedMessage = {
  gmailMessageId: string;
  threadId: string;
  internalDate: Date;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  labelIds: string[];
  /** Plain text body, whitespace collapsed and truncated. Empty for metadata-only fetches. */
  text: string;
  links: { url: string; text: string }[];
};

export const MAX_BODY_CHARS = 6000;
const MAX_LINKS = 40;

function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export function decodeMimeWords(input: string): string {
  return input.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    try {
      const buf =
        enc.toLowerCase() === "b"
          ? Buffer.from(data, "base64")
          : Buffer.from(
              data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      return new TextDecoder(charset.toLowerCase() === "utf-8" ? "utf-8" : charset).decode(buf);
    } catch {
      return data;
    }
  });
}

export function parseFrom(raw: string): { email: string; name: string | null } {
  const decoded = decodeMimeWords(raw).trim();
  const m = decoded.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "").trim();
    return { email: m[2].trim().toLowerCase(), name: name || null };
  }
  return { email: decoded.toLowerCase(), name: null };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "...", copy: "(c)" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
  } catch {
    return " ";
  }
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractLinks(html: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < MAX_LINKS) {
    const url = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (/unsubscribe|optout|opt-out|preferences|privacy|\/help\b/i.test(url)) continue;
    const text = collapseWhitespace(decodeEntities(m[2].replace(/<[^>]+>/g, " "))).slice(0, 160);
    if (/unsubscribe|manage (your )?(alerts|preferences)/i.test(text)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text });
  }
  return out;
}

function decodeBody(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function walk(part: GmailPart | undefined, acc: { plain: string[]; html: string[] }) {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (part.parts?.length) part.parts.forEach((p) => walk(p, acc));
  else if (!part.filename) {
    if (mime === "text/plain") acc.plain.push(decodeBody(part.body?.data));
    else if (mime === "text/html") acc.html.push(decodeBody(part.body?.data));
  }
}

export function parseMessage(raw: GmailRawMessage, opts: { includeBody: boolean }): ParsedMessage {
  const { email, name } = parseFrom(header(raw.payload, "From"));
  const subject = decodeMimeWords(header(raw.payload, "Subject")).trim();
  const internal = Number(raw.internalDate);
  const date = Number.isFinite(internal) && internal > 0 ? new Date(internal) : new Date(header(raw.payload, "Date") || Date.now());

  let text = "";
  let links: { url: string; text: string }[] = [];
  if (opts.includeBody) {
    const acc = { plain: [] as string[], html: [] as string[] };
    walk(raw.payload, acc);
    const html = acc.html.join("\n");
    // Prefer HTML-derived text when there is no plain part, but always take links from the HTML.
    const body = acc.plain.join("\n").trim() || htmlToText(html);
    text = collapseWhitespace(body).slice(0, MAX_BODY_CHARS);
    links = extractLinks(html);
  }

  return {
    gmailMessageId: raw.id,
    threadId: raw.threadId,
    internalDate: Number.isNaN(date.getTime()) ? new Date() : date,
    fromEmail: email,
    fromName: name,
    subject: subject.slice(0, 300),
    snippet: decodeEntities(raw.snippet ?? "").slice(0, 300),
    labelIds: raw.labelIds ?? [],
    text,
    links,
  };
}
