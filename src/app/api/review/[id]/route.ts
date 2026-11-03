import { z } from "zod";
import { getDb } from "@/db";
import { apiError, authenticate, json } from "@/lib/api";
import { EVENT_TYPES } from "@/lib/constants";
import { DuplicateApplicationError } from "@/lib/store/applications";
import { resolveReviewItem, ReviewError } from "@/lib/store/review";

export const dynamic = "force-dynamic";

const eventType = z.enum(EVENT_TYPES).optional();
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), applicationId: z.string().uuid(), eventType }),
  z.object({
    action: z.literal("create"),
    company: z.string().trim().min(1).max(120),
    position: z.string().trim().min(1).max(160),
    jobId: z.string().trim().max(80).nullish(),
    source: z.string().trim().max(60).nullish(),
    eventType,
  }),
  z.object({ action: z.literal("other") }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(400, "Invalid id");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid body");
  try {
    const r = await resolveReviewItem(getDb(), a.user.id, id, parsed.data);
    return json({ ok: true, applicationId: r.applicationId });
  } catch (err) {
    if (err instanceof ReviewError) return apiError(404, err.message);
    if (err instanceof DuplicateApplicationError) return apiError(409, err.message);
    throw err;
  }
}
