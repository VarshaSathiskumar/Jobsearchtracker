import { describe, expect, it } from "vitest";
import { deriveStatus, nextStatus, statusTimeline } from "@/lib/status";
import type { EventType } from "@/lib/constants";

const at = (d: number) => new Date(Date.UTC(2026, 0, d));
const ev = (eventType: EventType, day: number, extra: object = {}) => ({ eventType, occurredAt: at(day), ...extra });

describe("status transitions", () => {
  it("moves forward through the funnel", () => {
    expect(nextStatus("applied", ev("callback", 2))).toBe("callback");
    expect(nextStatus("callback", ev("assessment", 3))).toBe("assessment");
    expect(nextStatus("assessment", ev("interview_scheduled", 4))).toBe("interview_scheduled");
    expect(nextStatus("interview_scheduled", ev("offer", 5))).toBe("offer");
  });

  it("never moves backwards", () => {
    expect(nextStatus("interview_scheduled", ev("callback", 6))).toBe("interview_scheduled");
    expect(nextStatus("interview_scheduled", ev("applied", 6))).toBe("interview_scheduled");
    expect(nextStatus("offer", ev("interview_scheduled", 6))).toBe("offer");
  });

  it("a rejection applies from any active state", () => {
    for (const s of ["applied", "callback", "assessment", "interview_scheduled", "offer"] as const) {
      expect(nextStatus(s, ev("rejected", 9))).toBe("rejected");
    }
  });

  it("informational updates change nothing", () => {
    expect(nextStatus("callback", ev("update", 3))).toBe("callback");
  });

  it("rescheduling keeps the interview scheduled", () => {
    expect(nextStatus("interview_scheduled", ev("interview_rescheduled", 7))).toBe("interview_scheduled");
    expect(nextStatus("callback", ev("interview_rescheduled", 7))).toBe("interview_scheduled");
  });

  it("rejection is terminal except for a confident later interview or offer", () => {
    expect(nextStatus("rejected", ev("callback", 10))).toBe("rejected");
    expect(nextStatus("rejected", ev("interview_scheduled", 10, { confidence: 0.6 }))).toBe("rejected");
    expect(nextStatus("rejected", ev("interview_scheduled", 10, { confidence: 0.95 }))).toBe("interview_scheduled");
    expect(nextStatus("withdrawn", ev("offer", 10, { confidence: 0.9 }))).toBe("offer");
  });

  it("manual edits always win", () => {
    expect(nextStatus("rejected", { eventType: "manual_edit", toStatus: "applied", occurredAt: at(11) })).toBe("applied");
    expect(nextStatus("offer", { eventType: "manual_edit", toStatus: "callback", occurredAt: at(11) })).toBe("callback");
  });

  it("derives the same status regardless of processing order", () => {
    const events = [ev("applied", 1), ev("callback", 3), ev("interview_scheduled", 5), ev("rejected", 8)];
    const shuffled = [events[3], events[1], events[0], events[2]];
    expect(deriveStatus(events)).toBe("rejected");
    expect(deriveStatus(shuffled)).toBe("rejected");
  });

  it("a rejection that predates a later interview does not hide the interview when confident", () => {
    const events = [ev("applied", 1), ev("rejected", 3), ev("interview_scheduled", 10, { confidence: 0.95 })];
    expect(deriveStatus(events)).toBe("interview_scheduled");
  });

  it("builds a per-event timeline", () => {
    const events = [
      { id: "a", ...ev("applied", 1) },
      { id: "b", ...ev("callback", 2) },
      { id: "c", ...ev("callback", 3) },
      { id: "d", ...ev("rejected", 4) },
    ];
    const t = statusTimeline(events);
    expect([t.get("a"), t.get("b"), t.get("c"), t.get("d")]).toEqual(["applied", "callback", "callback", "rejected"]);
  });
});
