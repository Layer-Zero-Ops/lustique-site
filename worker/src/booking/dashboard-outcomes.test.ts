// worker/src/booking/dashboard-outcomes.test.ts
import { describe, it, expect } from "vitest";
import {
  reclaimedMinutes,
  coordinationScore,
  computeOutcomes,
  automationCoveragePct,
  formatMinutes,
  type OutcomeInput,
} from "./dashboard-outcomes";

const NOW = new Date("2026-07-27T12:00:00Z").getTime();
const dayAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

function base(): OutcomeInput {
  return {
    pipeline_cents: 20000,
    booked_cents: 45000,
    collected_cents: 15000,
    owed_cents: 30000,
    collection_pct: 33,
    open_enquiries: 2,
    at_risk_count: 2,
    conversion_pct: 50,
    events: [],
    bookings_7d: 10,
    manual_touches_7d: 1,
  };
}

describe("reclaimedMinutes", () => {
  it("sums within 7-day window, ignores older", () => {
    const events = [
      { type: "enquiry_received", created_at: dayAgo(1) },
      { type: "invoice_sent", created_at: dayAgo(2) },
      { type: "balance_due", created_at: dayAgo(20) }, // ignored
    ];
    // 8 + 12 = 20
    expect(reclaimedMinutes(events, 7, NOW)).toBe(20);
  });
  it("uses fallback for unknown event types", () => {
    const events = [{ type: "something_new", created_at: dayAgo(0) }];
    expect(reclaimedMinutes(events, 7, NOW)).toBe(3);
  });
});

describe("coordinationScore", () => {
  it("penalises at-risk and low collection", () => {
    const s = coordinationScore(base());
    // baseline 50 + (33-80)*0.4=-18.8 - 2*3=-6 + (50-60)*0.3=-3 + min(0,10)*0.5=0
    // = 50 -18.8 -6 -3 = 22.2 -> 22
    expect(s).toBe(22);
  });
  it("rewards healthy pipeline", () => {
    const i = { ...base(), collection_pct: 100, at_risk_count: 0, conversion_pct: 70, open_enquiries: 5 };
    // 50 + (100-80)*0.4=8 - 0 + (70-60)*0.3=3 + min(5,10)*0.5=2.5 = 63.5 -> 64 (healthy=5)
    expect(coordinationScore(i)).toBe(64);
  });
  it("clamps 0..100", () => {
    const i = { ...base(), collection_pct: 0, at_risk_count: 50, conversion_pct: 0, open_enquiries: 0 };
    expect(coordinationScore(i)).toBe(0);
  });
});

describe("computeOutcomes", () => {
  it("produces headline + hours", () => {
    const i = { ...base(), events: [{ type: "enquiry_received", created_at: dayAgo(1) }] };
    const o = computeOutcomes({ ...i, now: NOW });
    expect(o.reclaimed_minutes_7d).toBe(8);
    expect(o.reclaimed_hours_7d).toBe(0.1);
    expect(o.coordination_score).toBe(22);
    expect(o.momentum_label).toBe("Steady"); // at_risk 2 (<=3) and conversion<60
    expect(typeof o.headline).toBe("string");
  });
  it("accelerating when healthy", () => {
    const i = { ...base(), collection_pct: 100, at_risk_count: 0, conversion_pct: 70, open_enquiries: 5,
      events: [{ type: "invoice_sent", created_at: dayAgo(1) }] };
    const o = computeOutcomes({ ...i, now: NOW });
    expect(o.momentum_label).toBe("Accelerating");
    expect(o.coordination_score).toBe(64);
  });
});

describe("automationCoveragePct", () => {
  it("100% when no manual touches", () => {
    expect(automationCoveragePct(10, 0)).toBe(100);
  });
  it("zero when no bookings", () => {
    expect(automationCoveragePct(0, 5)).toBe(0);
  });
  it("partial coverage", () => {
    expect(automationCoveragePct(10, 3)).toBe(70);
  });
});

describe("computeOutcomes coverage", () => {
  it("includes automation_coverage_pct and 'ran itself' headline at high scores", () => {
    const i = { ...base(), collection_pct: 100, at_risk_count: 0, conversion_pct: 70, open_enquiries: 5,
      bookings_7d: 10, manual_touches_7d: 0,
      events: [{ type: "invoice_sent", created_at: dayAgo(1) }] };
    const o = computeOutcomes({ ...i, now: NOW });
    expect(o.automation_coverage_pct).toBe(100);
    expect(o.headline).toContain("the business ran itself");
  });
});

describe("formatMinutes", () => {
  it("under an hour", () => {
    expect(formatMinutes(45)).toBe("45 min");
  });
  it("whole hours", () => {
    expect(formatMinutes(120)).toBe("2h");
  });
  it("hours and minutes", () => {
    expect(formatMinutes(95)).toBe("1h 35m");
  });
});
