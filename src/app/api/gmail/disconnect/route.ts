import { getDb } from "@/db";
import { authenticate, json } from "@/lib/api";
import { disconnect } from "@/lib/gmail/connection";

export const dynamic = "force-dynamic";

/** Revokes the Google grant and deletes the stored (encrypted) refresh token. Tracked data is kept. */
export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  await disconnect(getDb(), a.user.id);
  return json({ ok: true });
}
