// worker/src/booking/dashboard-kpi.test.ts
import { describe, it, expect } from "vitest";
import {
  computeKpis,
  isZeroTotal,
  isQuoteExpired,
  isBalanceOverdue,
  daysUntil,
  formatZAR,
  type KpiBooking,
  type KpiEnquiry,
} from "./dashboard-kpi";

const NOW = new Date("2026-07-27T12:00:00Z").getTime();

function bk(over: Partial<KpiBooking>): KpiBooking {
  return {
    status: "requested",
    total_cents: 10000,
    deposit_net_cents: 0,
    balance_net_cents: 0,
    wedding_date: "2027-01-01",
    created_at: "2026-07-01T00:00:00Z",
    quote_sent_at: null,
    ...over,
  };
}

describe("daysUntil", () => {
  it("returns null for null", () => {
    expect(daysUntil(null)).toBeNull();
  });
  it("computes positive days", () => {
    const future = new Date(NOW + 5 * 86400000).toISOString();
    expect(daysUntil(future)).toBe(5);
  });
});

describe("isZeroTotal", () => {
  it("flags booked zero-total", () => {
    expect(isZeroTotal(bk({ status: "accepted", total_cents: 0 }))).toBe(true);
  });
  it("ignores open quote zero-total", () => {
    expect(isZeroTotal(bk({ status: "requested", total_cents: 0 }))).toBe(false);
  });
});

describe("isQuoteExpired", () => {
  it("flags quote sent >14 days ago", () => {
    const old = new Date(NOW - 20 * 86400000).toISOString();
    expect(isQuoteExpired(bk({ status: "quote_sent", quote_sent_at: old }), NOW)).toBe(true);
  });
  it("not expired if sent 3 days ago", () => {
    const recent = new Date(NOW - 3 * 86400000).toISOString();
    expect(isQuoteExpired(bk({ status: "quote_sent", quote_sent_at: recent }), NOW)).toBe(false);
  });
});

describe("isBalanceOverdue", () => {
  it("flags booked balance unpaid past wedding date", () => {
    expect(isBalanceOverdue(bk({ status: "deposit_paid", wedding_date: "2026-07-01", balance_net_cents: 5000 }), NOW)).toBe(true);
  });
  it("not overdue if wedding in future", () => {
    expect(isBalanceOverdue(bk({ status: "deposit_paid", wedding_date: "2027-01-01", balance_net_cents: 5000 }), NOW)).toBe(false);
  });
});

describe("computeKpis", () => {
  it("computes pipeline + booked + collection", () => {
    const bookings: KpiBooking[] = [
      bk({ status: "quote_sent", total_cents: 20000, quote_sent_at: new Date(NOW - 2 * 86400000).toISOString() }),
      bk({ status: "accepted", total_cents: 30000, deposit_net_cents: 10000, balance_net_cents: 20000 }),
      bk({ status: "deposit_paid", total_cents: 15000, deposit_net_cents: 5000, balance_net_cents: 10000 }),
    ];
    const enquiries: KpiEnquiry[] = [
      { id: "e1", status: "new", created_at: "2026-07-10", booking_id: null },
      { id: "e2", status: "converted", created_at: "2026-07-11", booking_id: "b1" },
    ];
    const r = computeKpis(bookings, enquiries, NOW);
    expect(r.pipeline_cents).toBe(20000);
    expect(r.booked_cents).toBe(45000);
    expect(r.collected_cents).toBe(15000);
    expect(r.owed_cents).toBe(30000);
    expect(r.collection_pct).toBe(33); // 15000 / 45000
    expect(r.open_enquiries).toBe(1);
    expect(r.conversion_pct).toBe(50); // 1 of 2 enquiries has booking
    // at-risk: 2 outstanding balances (booking2 + booking3)
    expect(r.at_risk_count).toBe(2);
  });

  it("skips archived rows", () => {
    const bookings: KpiBooking[] = [bk({ status: "accepted", total_cents: 30000, archived_at: "2026-07-20" })];
    const r = computeKpis(bookings, [], NOW);
    expect(r.booked_cents).toBe(0);
  });

  it("collection 100 when nothing owed", () => {
    const bookings: KpiBooking[] = [bk({ status: "settled", total_cents: 10000, deposit_net_cents: 5000, balance_net_cents: 0 })];
    const r = computeKpis(bookings, [], NOW);
    expect(r.collection_pct).toBe(100);
  });
});

describe("formatZAR", () => {
  it("formats cents to rand", () => {
    expect(formatZAR(12345)).toBe("R 123.45");
  });
});
