import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import type { Db } from "@/db";

/** Real Postgres (PGlite/WASM) with the project's actual migrations applied. */
export async function createTestDb(): Promise<{ db: Db; userId: string; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  const [u] = await db.insert(users).values({ email: "owner@example.com", name: "Owner" }).returning();
  return { db: db as unknown as Db, userId: u.id, close: () => client.close() };
}
