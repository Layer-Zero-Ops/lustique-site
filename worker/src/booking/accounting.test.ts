import { describe, it, expect, vi } from "vitest";
import { handleAdminAccounting } from "./accounting";
import type { AccountingEnv } from "./accounting";

const ADMIN_SECRET = "test-secret-abc";

const env: AccountingEnv = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_KEY: "service-key",
  ADMIN_SECRET,
};

function makeRow(overrides: Partial<{
  reference: string; bride_name: string; bride_email: string; occasion: string;
  wedding_date: string; status: string; total_cents: number;
  deposit_net_cents: number; balance_net_cents: number;
  deposit_paid_at: string | null; settled_at: string | null; created_at: string;
}> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    reference: "LQ-2026-0001",
    bride_name: "Jane Doe",
    bride_email: "jane@example.com",
    occasion: "Wedding",
    wedding_date: "2026-08-15",
    status: "settled",
    total_cents: 1000000,
    deposit_net_cents: 250000,
    balance_net_cents: 750000,
    deposit_paid_at: "2026-06-01T10:00:00Z",
    settled_at: "2026-07-01T10:00:00Z",
    created_at: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

function mockFetch(rows: object[]) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("handleAdminAccounting — auth gate", () => {
  it("returns 401 when token is missing", async () => {
    const req = new Request("https://w.example/api/admin/accounting");
    const res = await handleAdminAccounting(env, req, mockFetch([]));
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const req = new Request("https://w.example/api/admin/accounting?token=wrong");
    const res = await handleAdminAccounting(env, req, mockFetch([]));
    expect(res.status).toBe(401);
  });

  it("returns 405 for non-GET methods", async () => {
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`, { method: "POST" });
    const res = await handleAdminAccounting(env, req, mockFetch([]));
    expect(res.status).toBe(405);
  });
});

describe("handleAdminAccounting — dashboard page", () => {
  it("renders the accounting page with a valid token", async () => {
    const rows = [makeRow()];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Accounting");
    expect(html).toContain("Revenue by month");
    expect(html).toContain("Outstanding balances");
  });

  it("shows revenue for settled bookings", async () => {
    const rows = [makeRow({ status: "settled", total_cents: 500000, settled_at: "2026-08-01T00:00:00Z" })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    // R 5 000.00 formatted with space separator
    expect(html).toContain("5 000.00");
    expect(html).toContain("2026-08");
  });

  it("shows outstanding balance row for deposit_paid bookings", async () => {
    const rows = [makeRow({ status: "deposit_paid", balance_net_cents: 750000 })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    expect(html).toContain("Jane Doe");
    expect(html).toContain("7 500.00");
  });

  it("shows 'No settled bookings' when no settled rows exist", async () => {
    const rows = [makeRow({ status: "requested" })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    expect(html).toContain("No settled bookings yet");
  });

  it("shows 'No outstanding balances' when none exist", async () => {
    const rows = [makeRow({ status: "settled" })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    expect(html).toContain("No outstanding balances");
  });

  it("shows pipeline row for accepted bookings", async () => {
    const rows = [makeRow({ status: "accepted", total_cents: 1200000 })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    expect(html).toContain("Accepted");
    expect(html).toContain("12 000.00");
  });

  it("KPI shows correct total revenue across multiple settled bookings", async () => {
    const rows = [
      makeRow({ status: "settled", total_cents: 500000, settled_at: "2026-07-01T00:00:00Z" }),
      makeRow({ id: "00000000-0000-0000-0000-000000000002", reference: "LQ-2026-0002", status: "settled", total_cents: 300000, settled_at: "2026-08-01T00:00:00Z" }),
    ];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const html = await res.text();
    // Total: R 8 000.00
    expect(html).toContain("8 000.00");
  });
});

describe("handleAdminAccounting — CSV export", () => {
  it("returns a CSV file with correct content-disposition", async () => {
    const rows = [makeRow()];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}&export=csv`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("lustique-bookings-");
    expect(res.headers.get("content-disposition")).toContain(".csv");
  });

  it("CSV includes header row and booking data", async () => {
    const rows = [makeRow({ reference: "LQ-2026-0001", bride_name: "Jane Doe", total_cents: 1000000 })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}&export=csv`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const text = await res.text();
    expect(text).toContain("Reference");
    expect(text).toContain("LQ-2026-0001");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("10000.00"); // R 10 000.00 → 10000.00 in CSV
  });

  it("CSV escapes quotes in field values", async () => {
    const rows = [makeRow({ bride_name: 'Jane "The Bride" Doe' })];
    const req = new Request(`https://w.example/api/admin/accounting?token=${ADMIN_SECRET}&export=csv`);
    const res = await handleAdminAccounting(env, req, mockFetch(rows));
    const text = await res.text();
    expect(text).toContain('Jane ""The Bride"" Doe');
  });
});
