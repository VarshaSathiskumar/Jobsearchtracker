import { getDb } from "@/db";
import { apiError, authenticate, json } from "@/lib/api";
import { getRun, reapStaleRuns } from "@/lib/sync/lock";
import { runDto } from "@/lib/sync/dto";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(400, "Invalid run id");
  const db = getDb();
  await reapStaleRuns(db, a.user.id);
  const run = await getRun(db, a.user.id, id);
  if (!run) return apiError(404, "Run not found");
  return json({ run: runDto(run) });
}
