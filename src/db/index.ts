import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";
import { dbEnv } from "@/env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db; __dbOverride?: Db };

/**
 * Lazily created database handle. Supabase pooled connections (transaction mode) do not
 * support prepared statements, so they are disabled.
 */
export function getDb(): Db {
  if (globalForDb.__dbOverride) return globalForDb.__dbOverride;
  if (!globalForDb.__db) {
    const { DATABASE_URL } = dbEnv();
    const client = postgres(DATABASE_URL, {
      prepare: false,
      max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10),
      idle_timeout: 20,
      connect_timeout: 15,
    });
    globalForDb.__db = drizzlePg(client, { schema });
  }
  return globalForDb.__db;
}

/** Test hook: route all getDb() calls to the supplied database. */
export function setDbOverride(db: Db | undefined) {
  globalForDb.__dbOverride = db;
}

export { schema };
