/**
 * Optional zero-install local Postgres for development (PGlite over a TCP socket).
 * Production uses Supabase. Usage:  npm run db:local
 * Then set  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres  and  DB_POOL_MAX=1
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
const dir = process.env.LOCAL_DB_DIR ?? ".pglite-data";

const client = new PGlite(dir);
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
const server = new PGLiteSocketServer({ db: client, port, host: "127.0.0.1" });
await server.start();
console.log(`Local Postgres (PGlite) ready on postgres://postgres:postgres@127.0.0.1:${port}/postgres  (data: ${dir})`);

const stop = async () => {
  await server.stop();
  await client.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
