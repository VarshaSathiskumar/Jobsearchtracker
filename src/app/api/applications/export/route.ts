import { getDb } from "@/db";
import { apiError, authenticate } from "@/lib/api";
import { getConnection } from "@/lib/gmail/connection";
import { listApplications, parseFilters, toCsv, type Preset } from "@/lib/queries/applications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await authenticate(req);
  if ("error" in a) return a.error;
  const url = new URL(req.url);
  const preset = (["rejections", "callbacks", "interviews"].includes(url.searchParams.get("preset") ?? "") ? url.searchParams.get("preset") : "all") as Preset;
  const filters = parseFilters(Object.fromEntries(url.searchParams), preset);
  const db = getDb();
  const [{ rows }, conn] = await Promise.all([listApplications(db, a.user.id, filters, { all: true }), getConnection(db, a.user.id)]);
  if (rows.length > 10_000) return apiError(413, "Too many rows to export");
  return new Response(toCsv(rows, conn?.googleEmail ?? null), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
