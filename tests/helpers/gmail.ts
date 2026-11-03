import { GmailApiError, HistoryExpiredError, type GmailLike, type GmailRawMessage } from "@/lib/gmail/client";

export type MailSpec = {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  body: string;
  html?: string;
  date: Date;
  labels?: string[];
};

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export function rawMessage(spec: MailSpec, historyId: number): GmailRawMessage {
  const parts = [{ mimeType: "text/plain", body: { data: b64(spec.body) } }];
  if (spec.html) parts.push({ mimeType: "text/html", body: { data: b64(spec.html) } });
  return {
    id: spec.id,
    threadId: spec.threadId ?? spec.id,
    labelIds: spec.labels ?? ["INBOX"],
    snippet: spec.body.slice(0, 120),
    internalDate: String(spec.date.getTime()),
    historyId: String(historyId),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: spec.from },
        { name: "Subject", value: spec.subject },
        { name: "Date", value: spec.date.toUTCString() },
      ],
      parts,
    },
  };
}

export class FakeGmail implements GmailLike {
  messages: GmailRawMessage[] = [];
  historyCounter = 1000;
  expireHistory = false;
  /** Throw a non-retryable error when listing the Nth page (1-based) of a list call. */
  failOnListCall: number | null = null;
  listCalls = 0;
  listTokens: (string | null)[] = [];
  fullFetches = 0;
  metadataFetches = 0;

  add(spec: MailSpec) {
    this.messages.push(rawMessage(spec, ++this.historyCounter));
  }

  async getProfile() {
    return { emailAddress: "owner@example.com", historyId: String(this.historyCounter) };
  }

  async listMessageIds({ pageToken, maxResults }: { query: string; pageToken?: string | null; maxResults: number }) {
    this.listCalls++;
    this.listTokens.push(pageToken ?? null);
    if (this.failOnListCall === this.listCalls) throw new GmailApiError("Simulated Gmail outage", 500);
    const sorted = [...this.messages].sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const offset = pageToken ? Number(pageToken) : 0;
    const slice = sorted.slice(offset, offset + maxResults);
    const next = offset + maxResults < sorted.length ? String(offset + maxResults) : null;
    return { ids: slice.map((m) => m.id), nextPageToken: next };
  }

  async listHistory({ startHistoryId }: { startHistoryId: string; pageToken?: string | null; maxResults: number }) {
    if (this.expireHistory) throw new HistoryExpiredError();
    const ids = this.messages.filter((m) => Number(m.historyId) > Number(startHistoryId)).map((m) => m.id);
    return { ids, nextPageToken: null, historyId: String(this.historyCounter) };
  }

  async getMessages(ids: string[], format: "metadata" | "full") {
    return ids.map((id) => {
      const m = this.messages.find((x) => x.id === id);
      if (!m) return null;
      if (format === "full") {
        this.fullFetches++;
        return m;
      }
      this.metadataFetches++;
      return { ...m, payload: { headers: m.payload?.headers } };
    });
  }
}
