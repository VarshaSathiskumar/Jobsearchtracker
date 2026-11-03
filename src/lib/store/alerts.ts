import { createHash } from "node:crypto";
import type { Db } from "@/db";
import { jobAlerts } from "@/db/schema";
import { normalizeCompany, normalizeTitle } from "@/lib/normalize";

export type AlertItemInput = { company: string | null; position: string; location: string | null; url: string | null };

export function alertItemKey(item: AlertItemInput): string {
  const basis = item.url ? item.url.split("#")[0] : `${normalizeCompany(item.company ?? "")}|${normalizeTitle(item.position)}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 20);
}

/** Job alerts are stored apart from applications and are never marked as applied. */
export async function saveJobAlerts(
  db: Db,
  args: { userId: string; messageRowId: string; receivedAt: Date; source: string | null; items: AlertItemInput[]; runId?: string | null },
): Promise<number> {
  if (args.items.length === 0) return 0;
  const seen = new Set<string>();
  const values = args.items
    .map((i) => ({ ...i, itemKey: alertItemKey(i) }))
    .filter((i) => (seen.has(i.itemKey) ? false : (seen.add(i.itemKey), true)))
    .map((i) => ({
      userId: args.userId,
      gmailMessageId: args.messageRowId,
      company: i.company,
      position: i.position,
      location: i.location,
      url: i.url,
      source: args.source,
      receivedAt: args.receivedAt,
      itemKey: i.itemKey,
      syncRunId: args.runId ?? null,
    }));
  const inserted = await db.insert(jobAlerts).values(values).onConflictDoNothing().returning({ id: jobAlerts.id });
  return inserted.length;
}
