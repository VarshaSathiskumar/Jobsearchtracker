import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export type AppUser = { id: string; email: string; name: string | null; image: string | null };

/** Resolves the signed-in, allowlisted user (creating the row on first visit) or null. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !isAllowedEmail(email)) return null;

  const db = getDb();
  let [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) {
    [row] = await db
      .insert(users)
      .values({ email, name: session?.user?.name ?? null, image: session?.user?.image ?? null })
      .onConflictDoUpdate({ target: users.email, set: { lastLoginAt: new Date() } })
      .returning();
  }
  return { id: row.id, email: row.email, name: row.name, image: row.image };
});

/** For pages and layouts: redirect to /login when not authorized. Every page calls this itself. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
