import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { reviewItems } from "@/db/schema";
import { getConnection, toConnectionView } from "@/lib/gmail/connection";
import { getLatestRun } from "@/lib/sync/lock";
import { runDto } from "@/lib/sync/dto";

export const getShellData = cache(async (db: Db, userId: string) => {
  const [conn, run, review] = await Promise.all([
    getConnection(db, userId),
    getLatestRun(db, userId),
    db.select({ c: sql<number>`count(*)` }).from(reviewItems).where(and(eq(reviewItems.userId, userId), eq(reviewItems.status, "open"))),
  ]);
  return {
    connection: toConnectionView(conn),
    run: run ? runDto(run) : null,
    needsReview: Number(review[0].c),
  };
});
