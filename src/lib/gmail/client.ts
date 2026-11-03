import { mapLimit, sleep } from "@/lib/async";
import { redact } from "@/lib/log";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

/** Raised when the refresh token is revoked or expired (e.g. OAuth Testing mode 7 day expiry). */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** Raised by history.list when the stored history id is too old (HTTP 404). */
export class HistoryExpiredError extends Error {
  constructor() {
    super("Gmail history id expired");
    this.name = "HistoryExpiredError";
  }
}

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailRawMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
};

export interface GmailLike {
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
  listMessageIds(args: { query: string; pageToken?: string | null; maxResults: number }): Promise<{ ids: string[]; nextPageToken: string | null }>;
  listHistory(args: { startHistoryId: string; pageToken?: string | null; maxResults: number }): Promise<{
    ids: string[];
    nextPageToken: string | null;
    historyId: string | null;
  }>;
  /** Returns null for messages that no longer exist (deleted between list and get). */
  getMessages(ids: string[], format: "metadata" | "full"): Promise<(GmailRawMessage | null)[]>;
}

export type GmailClientOptions = {
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  maxAttempts?: number;
  sleepImpl?: (ms: number) => Promise<void>;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError", "internalError"]);

export class GmailClient implements GmailLike {
  private fetchImpl: typeof fetch;
  private concurrency: number;
  private maxAttempts: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: GmailClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.concurrency = opts.concurrency ?? 5;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.sleep = opts.sleepImpl ?? sleep;
  }

  /** Authenticated GET with exponential backoff, jitter and Retry-After support. */
  private async get<T>(path: string, params?: Record<string, string | string[] | number | undefined | null>): Promise<T> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res: Response;
      try {
        const token = await this.opts.getAccessToken();
        res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      } catch (err) {
        if (err instanceof GmailAuthError) throw err;
        lastError = err; // network failure, retry
        await this.sleep(this.backoff(attempt));
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      let reason: string | undefined;
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
        reason = body.error?.errors?.[0]?.reason ?? body.error?.status;
        message = body.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }

      if (res.status === 401) {
        // Access token may have been revoked mid-run; a fresh one is fetched on the next attempt.
        lastError = new GmailApiError("Unauthorized", 401, reason);
        if (attempt >= 2) throw new GmailAuthError("Gmail rejected the access token");
        await this.sleep(this.backoff(attempt));
        continue;
      }

      const retryable = RETRYABLE_STATUS.has(res.status) || (res.status === 403 && !!reason && RETRYABLE_REASONS.has(reason));
      lastError = new GmailApiError(redact(message), res.status, reason);
      if (!retryable || attempt === this.maxAttempts) throw lastError;

      const retryAfter = Number(res.headers.get("retry-after"));
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt));
    }
    throw lastError instanceof Error ? lastError : new Error("Gmail request failed");
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
  }

  async getProfile() {
    const p = await this.get<{ emailAddress: string; historyId: string }>("/profile");
    return { emailAddress: p.emailAddress, historyId: String(p.historyId) };
  }

  async listMessageIds({ query, pageToken, maxResults }: { query: string; pageToken?: string | null; maxResults: number }) {
    const r = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", {
      q: query,
      pageToken,
      maxResults,
      includeSpamTrash: "false",
    });
    return { ids: (r.messages ?? []).map((m) => m.id), nextPageToken: r.nextPageToken ?? null };
  }

  async listHistory({ startHistoryId, pageToken, maxResults }: { startHistoryId: string; pageToken?: string | null; maxResults: number }) {
    try {
      const r = await this.get<{
        history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
        nextPageToken?: string;
        historyId?: string;
      }>("/history", { startHistoryId, pageToken, maxResults, historyTypes: "messageAdded" });
      const ids = new Set<string>();
      for (const h of r.history ?? []) for (const a of h.messagesAdded ?? []) {
        const labels = a.message.labelIds ?? [];
        if (!labels.includes("SPAM") && !labels.includes("TRASH") && !labels.includes("DRAFT")) ids.add(a.message.id);
      }
      return { ids: [...ids], nextPageToken: r.nextPageToken ?? null, historyId: r.historyId ? String(r.historyId) : null };
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) throw new HistoryExpiredError();
      throw err;
    }
  }

  async getMessages(ids: string[], format: "metadata" | "full") {
    return mapLimit(ids, this.concurrency, async (id) => {
      try {
        return await this.get<GmailRawMessage>(`/messages/${encodeURIComponent(id)}`, {
          format,
          ...(format === "metadata" ? { metadataHeaders: ["From", "Subject", "Date"] } : {}),
        });
      } catch (err) {
        if (err instanceof GmailApiError && err.status === 404) return null;
        throw err;
      }
    });
  }
}

export function gmailMessageUrl(accountEmail: string | null | undefined, messageId: string): string {
  const account = accountEmail ? encodeURIComponent(accountEmail) : "0";
  return `https://mail.google.com/mail/u/${account}/#all/${encodeURIComponent(messageId)}`;
}
