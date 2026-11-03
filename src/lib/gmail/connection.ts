import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { gmailConnections, type GmailConnection } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { GmailClient, GmailAuthError } from "./client";
import { refreshAccessToken, revokeToken } from "./oauth";
import { syncTuning } from "@/env";

export async function getConnection(db: Db, userId: string): Promise<GmailConnection | null> {
  const [row] = await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1);
  return row ?? null;
}

/** Public-safe view of the connection. Never includes token material. */
export type ConnectionView = {
  status: "connected" | "needs_reauth" | "disconnected" | "none";
  googleEmail: string | null;
  lastSyncedAt: Date | null;
  backfillDone: boolean;
  backfillInProgress: boolean;
  hasHistoryId: boolean;
};

export function toConnectionView(c: GmailConnection | null): ConnectionView {
  if (!c) return { status: "none", googleEmail: null, lastSyncedAt: null, backfillDone: false, backfillInProgress: false, hasHistoryId: false };
  return {
    status: c.status,
    googleEmail: c.googleEmail,
    lastSyncedAt: c.lastSyncedAt,
    backfillDone: !!c.historyId && (!c.backfillState || c.backfillState.done),
    backfillInProgress: !!c.backfillState && !c.backfillState.done,
    hasHistoryId: !!c.historyId,
  };
}

export async function saveConnection(
  db: Db,
  args: { userId: string; googleEmail: string; refreshToken: string; scopes: string },
) {
  const existing = await getConnection(db, args.userId);
  // A different mailbox invalidates the history id and any backfill progress.
  const sameMailbox = !existing || existing.googleEmail.toLowerCase() === args.googleEmail.toLowerCase();
  const values = {
    googleEmail: args.googleEmail,
    encryptedRefreshToken: encryptSecret(args.refreshToken),
    scopes: args.scopes,
    status: "connected" as const,
    lastError: null,
    connectedAt: new Date(),
    disconnectedAt: null,
    updatedAt: new Date(),
    ...(sameMailbox ? {} : { historyId: null, backfillState: null, lastSyncedAt: null }),
  };
  await db
    .insert(gmailConnections)
    .values({ userId: args.userId, ...values })
    .onConflictDoUpdate({ target: gmailConnections.userId, set: values });
}

export async function disconnect(db: Db, userId: string) {
  const c = await getConnection(db, userId);
  if (!c) return;
  if (c.encryptedRefreshToken) {
    try {
      await revokeToken(decryptSecret(c.encryptedRefreshToken));
    } catch {
      /* ignore, token may already be unusable */
    }
  }
  await db
    .update(gmailConnections)
    .set({ encryptedRefreshToken: null, status: "disconnected", disconnectedAt: new Date(), updatedAt: new Date() })
    .where(eq(gmailConnections.userId, userId));
}

export async function markNeedsReauth(db: Db, userId: string, message: string) {
  await db
    .update(gmailConnections)
    .set({ status: "needs_reauth", lastError: message, updatedAt: new Date() })
    .where(eq(gmailConnections.userId, userId));
}

/**
 * Builds a Gmail client whose access token is minted from the encrypted refresh token on demand and
 * cached in memory for the life of the client. Tokens are never logged or returned to callers.
 */
export async function createGmailClient(db: Db, userId: string): Promise<GmailClient> {
  const c = await getConnection(db, userId);
  if (!c || c.status === "disconnected" || !c.encryptedRefreshToken) throw new GmailAuthError("Gmail is not connected");
  const refreshToken = decryptSecret(c.encryptedRefreshToken);
  let cached: { token: string; expiresAt: number } | null = null;

  return new GmailClient({
    concurrency: syncTuning().gmailConcurrency,
    getAccessToken: async () => {
      if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
      try {
        const t = await refreshAccessToken(refreshToken);
        cached = { token: t.accessToken, expiresAt: Date.now() + t.expiresInSec * 1000 };
        return cached.token;
      } catch (err) {
        if (err instanceof GmailAuthError) await markNeedsReauth(db, userId, "Google revoked or expired the Gmail authorization. Reconnect Gmail.");
        throw err;
      }
    },
  });
}
