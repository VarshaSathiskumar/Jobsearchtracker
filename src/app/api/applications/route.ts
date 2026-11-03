import { z } from "zod";
import { getDb } from "@/db";
import { apiError, authenticate, json } from "@/lib/api";
import { APPLICATION_STATUSES } from "@/lib/constants";
import { createApplicationManually, DuplicateApplicationError } from "@/lib/store/applications";

export const dynamic = "force-dynamic";

const applicationBody = z.object({
  company: z.string().trim().min(1).max(120),
  position: z.string().trim().min(1).max(160),
  jobId: z.string().trim().max(80).nullish(),
  source: z.string().trim().max(60).nullish(),
  appliedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().max(4000).nullish(),
});

export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const parsed = applicationBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid body");
  try {
    const app = await createApplicationManually(getDb(), a.user.id, { ...parsed.data, appliedAt: new Date(parsed.data.appliedAt) });
    return json({ application: app }, 201);
  } catch (err) {
    if (err instanceof DuplicateApplicationError) return apiError(409, err.message);
    throw err;
  }
}
