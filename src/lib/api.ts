import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AppUser } from "./session";
import { log } from "./log";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (!origin) return true; // non-browser clients cannot carry the session cookie cross-site
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/** Authenticates an API request. Returns the user or a ready-to-return error response. */
export async function authenticate(req: Request): Promise<{ user: AppUser } | { error: NextResponse }> {
  if (!sameOrigin(req)) return { error: apiError(403, "Cross-site request blocked") };
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return { error: apiError(401, "Not authenticated") };
  if (!isAllowedEmail(email)) return { error: apiError(403, "This account is not authorized") };
  try {
    const db = getDb();
    let [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) {
      [row] = await db.insert(users).values({ email, name: session?.user?.name ?? null, image: session?.user?.image ?? null }).onConflictDoUpdate({ target: users.email, set: { lastLoginAt: new Date() } }).returning();
    }
    return { user: { id: row.id, email: row.email, name: row.name, image: row.image } };
  } catch (err) {
    log.error("api.auth_failed", {}, err);
    return { error: apiError(500, "Server error") };
  }
}
