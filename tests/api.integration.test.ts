import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/db";
import { setDbOverride } from "@/db";
import { applications, syncRuns, users } from "@/db/schema";
import { saveConnection } from "@/lib/gmail/connection";

let session: { user?: { email?: string; name?: string } } | null = null;
const startMock = vi.fn();

vi.mock("@/auth", () => ({ auth: async () => session, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("workflow/api", () => ({ start: (...args: unknown[]) => startMock(...args) }));
vi.mock("@/workflows/sync", () => ({ syncWorkflow: async () => undefined }));

const origin = "http://localhost:3000";
const req = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  new Request(origin + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", host: "localhost:3000", origin, ...(init.headers as object) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });

let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let userId: string;
let close: () => Promise<void>;

const routes = async () => ({
  sync: await import("@/app/api/sync/route"),
  syncId: await import("@/app/api/sync/[id]/route"),
  apps: await import("@/app/api/applications/route"),
  appId: await import("@/app/api/applications/[id]/route"),
  exp: await import("@/app/api/applications/export/route"),
  review: await import("@/app/api/review/[id]/route"),
  disconnect: await import("@/app/api/gmail/disconnect/route"),
  sample: await import("@/app/api/sample-data/route"),
});

beforeEach(async () => {
  ({ db, userId, close } = await createTestDb());
  setDbOverride(db);
  session = { user: { email: "owner@example.com", name: "Owner" } };
  startMock.mockReset();
  startMock.mockResolvedValue({ runId: "wf_123" });
});
afterEach(async () => {
  setDbOverride(undefined);
  await close();
});

describe("API authorization (acceptance 1)", () => {
  it("rejects unauthenticated callers on every endpoint", async () => {
    session = null;
    const r = await routes();
    const ctx = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) };
    const responses = await Promise.all([
      r.sync.POST(req("/api/sync", { method: "POST", json: {} })),
      r.sync.GET(req("/api/sync")),
      r.syncId.GET(req("/api/sync/x"), ctx),
      r.apps.POST(req("/api/applications", { method: "POST", json: {} })),
      r.appId.PATCH(req("/api/applications/x", { method: "PATCH", json: {} }), ctx),
      r.appId.DELETE(req("/api/applications/x", { method: "DELETE" }), ctx),
      r.exp.GET(req("/api/applications/export")),
      r.review.POST(req("/api/review/x", { method: "POST", json: { action: "dismiss" } }), ctx),
      r.disconnect.POST(req("/api/gmail/disconnect", { method: "POST" })),
      r.sample.POST(req("/api/sample-data", { method: "POST", json: { action: "load" } })),
    ]);
    expect(responses.map((x) => x.status)).toEqual(Array(10).fill(401));
    expect(startMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in Google account that is not on the allowlist", async () => {
    session = { user: { email: "intruder@example.com" } };
    const r = await routes();
    const res = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(res.status).toBe(403);
    expect(startMock).not.toHaveBeenCalled();
    expect(await db.select().from(syncRuns)).toHaveLength(0);
    expect((await r.apps.POST(req("/api/applications", { method: "POST", json: { company: "A", position: "B", appliedAt: "2026-01-01" } }))).status).toBe(403);
  });

  it("blocks cross-site state changing requests", async () => {
    const r = await routes();
    const res = await r.sync.POST(req("/api/sync", { method: "POST", json: {}, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    const res2 = await r.sync.POST(req("/api/sync", { method: "POST", json: {}, headers: { "sec-fetch-site": "cross-site" } }));
    expect(res2.status).toBe(403);
  });
});

describe("POST /api/sync", () => {
  it("requires a connected Gmail account", async () => {
    const r = await routes();
    const res = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("gmail_not_connected");
  });

  it("starts a durable workflow, returns a run id immediately and blocks overlapping runs", async () => {
    await saveConnection(db, { userId, googleEmail: "owner@example.com", refreshToken: "1//x", scopes: "gmail.readonly" });
    const r = await routes();
    const res = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(res.status).toBe(202);
    const { runId } = await res.json();
    expect(runId).toMatch(/[0-9a-f-]{36}/);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock.mock.calls[0][1]).toEqual([runId]);
    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(row.status).toBe("queued");
    expect(row.workflowRunId).toBe("wf_123");

    const again = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "sync_running", runId });
    expect(startMock).toHaveBeenCalledTimes(1);

    const poll = await r.syncId.GET(req(`/api/sync/${runId}`), { params: Promise.resolve({ id: runId }) });
    const body = await poll.json();
    expect(body.run).toMatchObject({ id: runId, status: "queued" });
    expect(body.run.cursor).toBeUndefined(); // internal state is not exposed
  });

  it("releases the lock when the workflow cannot be started", async () => {
    await saveConnection(db, { userId, googleEmail: "owner@example.com", refreshToken: "1//x", scopes: "gmail.readonly" });
    startMock.mockRejectedValueOnce(new Error("queue down"));
    const r = await routes();
    const res = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(res.status).toBe(500);
    startMock.mockResolvedValue({ runId: "wf_2" });
    const retry = await r.sync.POST(req("/api/sync", { method: "POST", json: {} }));
    expect(retry.status).toBe(202);
  });

  it("validates a backfill date range", async () => {
    await saveConnection(db, { userId, googleEmail: "owner@example.com", refreshToken: "1//x", scopes: "gmail.readonly" });
    const r = await routes();
    const bad = await r.sync.POST(req("/api/sync", { method: "POST", json: { mode: "backfill", after: "2026-05-01", before: "2026-01-01" } }));
    expect(bad.status).toBe(400);
    const ok = await r.sync.POST(req("/api/sync", { method: "POST", json: { mode: "backfill", after: "2026-01-01", before: "2026-05-01" } }));
    expect(ok.status).toBe(202);
    const { runId } = await ok.json();
    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(row.kind).toBe("backfill");
    expect(row.params).toEqual({ after: "2026-01-01", before: "2026-05-01" });
  });

  it("does not let one user read another user's run", async () => {
    await saveConnection(db, { userId, googleEmail: "owner@example.com", refreshToken: "1//x", scopes: "gmail.readonly" });
    const [other] = await db.insert(users).values({ email: "other@example.com" }).returning();
    const [foreign] = await db.insert(syncRuns).values({ userId: other.id, status: "completed" }).returning();
    const r = await routes();
    const res = await r.syncId.GET(req(`/api/sync/${foreign.id}`), { params: Promise.resolve({ id: foreign.id }) });
    expect(res.status).toBe(404);
  });
});

describe("applications API", () => {
  it("creates, edits, de-duplicates and exports applications", async () => {
    const r = await routes();
    const create = await r.apps.POST(req("/api/applications", { method: "POST", json: { company: "Acme", position: "Engineer", appliedAt: "2026-01-05", source: "Referral" } }));
    expect(create.status).toBe(201);
    const { application } = await create.json();

    const dup = await r.apps.POST(req("/api/applications", { method: "POST", json: { company: "ACME Inc.", position: "engineer", appliedAt: "2026-02-01" } }));
    expect(dup.status).toBe(409);

    const ctx = { params: Promise.resolve({ id: application.id }) };
    const patch = await r.appId.PATCH(req(`/api/applications/${application.id}`, { method: "PATCH", json: { status: "interview_scheduled", notes: "Phone screen" } }), ctx);
    expect(patch.status).toBe(200);
    expect((await patch.json()).application.status).toBe("interview_scheduled");

    const bad = await r.appId.PATCH(req(`/api/applications/${application.id}`, { method: "PATCH", json: { status: "hired" } }), ctx);
    expect(bad.status).toBe(400);

    const csv = await (await r.exp.GET(req("/api/applications/export?preset=interviews"))).text();
    expect(csv).toContain("Acme,Engineer");
    expect(csv).toContain("interview_scheduled");

    const del = await r.appId.DELETE(req(`/api/applications/${application.id}`, { method: "DELETE" }), ctx);
    expect(del.status).toBe(200);
    expect(await db.select().from(applications)).toHaveLength(0);
  });

  it("marks sample data and can remove it without touching real records", async () => {
    const r = await routes();
    await r.apps.POST(req("/api/applications", { method: "POST", json: { company: "Real Co", position: "Dev", appliedAt: "2026-01-05" } }));
    expect((await r.sample.POST(req("/api/sample-data", { method: "POST", json: { action: "load" } }))).status).toBe(200);
    const all = await db.select().from(applications);
    expect(all.filter((a) => a.isSample).length).toBeGreaterThan(5);
    expect(all.filter((a) => !a.isSample)).toHaveLength(1);
    await r.sample.POST(req("/api/sample-data", { method: "POST", json: { action: "clear" } }));
    const left = await db.select().from(applications);
    expect(left).toHaveLength(1);
    expect(left[0].company).toBe("Real Co");
  });
});
