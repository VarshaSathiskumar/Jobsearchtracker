import { z } from "zod";
import { getDb } from "@/db";
import { apiError, authenticate, json } from "@/lib/api";
import { APPLICATION_STATUSES } from "@/lib/constants";
import { deleteApplication, DuplicateApplicationError, updateApplicationManually } from "@/lib/store/applications";

export const dynamic = "force-dynamic";

const patchBody = z
  .object({
    company: z.string().trim().min(1).max(120),
    position: z.string().trim().min(1).max(160),
    jobId: z.string().trim().max(80).nullable(),
    source: z.string().trim().max(60).nullable(),
    appliedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
    status: z.enum(APPLICATION_STATUSES),
    notes: z.string().max(4000).nullable(),
  })
  .partial();

const idOk = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const { id } = await ctx.params;
  if (!idOk(id)) return apiError(400, "Invalid id");
  const parsed = patchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid body");
  try {
    const { appliedAt, ...rest } = parsed.data;
    const app = await updateApplicationManually(getDb(), a.user.id, id, { ...rest, ...(appliedAt ? { appliedAt: new Date(appliedAt) } : {}) });
    if (!app) return apiError(404, "Application not found");
    return json({ application: app });
  } catch (err) {
    if (err instanceof DuplicateApplicationError) return apiError(409, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const { id } = await ctx.params;
  if (!idOk(id)) return apiError(400, "Invalid id");
  const ok = await deleteApplication(getDb(), a.user.id, id);
  return ok ? json({ ok: true }) : apiError(404, "Application not found");
}
