import { z } from "zod";
import { getDb } from "@/db";
import { apiError, authenticate, json } from "@/lib/api";
import { clearSampleData, loadSampleData } from "@/lib/sample-data";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["load", "clear"]) });

export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "Invalid body");
  const db = getDb();
  if (parsed.data.action === "load") return json({ ok: true, created: await loadSampleData(db, a.user.id) });
  await clearSampleData(db, a.user.id);
  return json({ ok: true });
}
