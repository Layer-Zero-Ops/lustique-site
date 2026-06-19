import { describe, it, expect, vi } from "vitest";
import { handleAdminInvoices } from "./invoices";
import type { InvoicesEnv } from "./invoices";

const ADMIN_SECRET = "test-admin-secret";
const SIGNING_SECRET = "test-signing-secret-32-chars-long";

const env: InvoicesEnv = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_KEY: "service-key",
  ADMIN_SECRET,
  SIGNING_SECRET,
};

function makeRow(overrides: Partial<{
  id: string; reference: string; bride_name: string; bride_email: string;
  occasion: string; wedding_date: string; status: string;
  total_cents: number; deposit_net_cents: number; balance_net_cents: number;
  deposit_paid_at: string | null; settled_at: string | null; created_at: string;
}> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    reference: "LQ-2026-0001",
    bride_name: "Jane Doe",
    bride_email: "jane@example.com",
    occasion: "Wedding",
    wedding_date: "2026-08-15",
    status: "deposit_paid",
    total_cents: 1000000,
    deposit_net_cents: 250000,
    balance_net_cents: 750000,
    deposit_paid_at: "2026-06-01T10:00:00Z",
    settled_at: null,
    created_at: "2026-05-01T10:00:00Z",
    ...overrides,
  };
}

function mockFetch(rows: object[]) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("handleAdminInvoices — auth gate", () => {
  it("returns 401 when token is missing", async () => {
    const req = new Request("https://w.example/api/admin/invoices");
    const res = await handleAdminInvoices(env, req, mockFetch([]));
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const req = new Request("https://w.example/api/admin/invoices?token=wrong-token");
    const res = await handleAdminInvoices(env, req, mockFetch([]));
    expect(res.status).toBe(401);
  });

  it("returns 405 for non-GET methods", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`, { method: "POST" });
    const res = await handleAdminInvoices(env, req, mockFetch([]));
    expect(res.status).toBe(405);
  });
});

describe("handleAdminInvoices — invoice listing", () => {
  it("renders the invoices page with a valid token", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow()]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Invoices");
    expect(html).toContain("LQ-2026-0001");
    expect(html).toContain("Jane Doe");
  });

  it("shows the wedding date formatted as YYYY-MM-DD", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow()]));
    const html = await res.text();
    expect(html).toContain("2026-08-15");
  });

  it("shows a status badge for deposit_paid", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow({ status: "deposit_paid" })]));
    const html = await res.text();
    expect(html).toContain("Deposit paid");
    expect(html).toContain("badge-dp");
  });

  it("shows financial amounts in ZAR with space separator", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([
      makeRow({ total_cents: 500000, deposit_net_cents: 125000, balance_net_cents: 375000 }),
    ]));
    const html = await res.text();
    expect(html).toContain("5 000.00"); // total
    expect(html).toContain("1 250.00"); // deposit
    expect(html).toContain("3 750.00"); // balance
  });

  it("includes a View invoice link with a signed token per row", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow()]));
    const html = await res.text();
    expect(html).toContain("/api/booking/invoice?token=");
    expect(html).toContain("View");
  });

  it("shows 'No bookings yet' for an empty list", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([]));
    const html = await res.text();
    expect(html).toContain("No bookings yet");
  });

  it.each([
    ["settled", "Settled", "badge-set"],
    ["accepted", "Accepted", "badge-acc"],
    ["quote_sent", "Quote sent", "badge-q"],
    ["requested", "Requested", "badge-req"],
    ["rejected", "Rejected", "badge-rej"],
    ["invoice_expired", "Expired", "badge-exp"],
  ])("shows correct badge label and class for status '%s'", async (status, label, cls) => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow({ status })]));
    const html = await res.text();
    expect(html).toContain(label);
    expect(html).toContain(cls);
  });

  it("rows are sorted by wedding date ascending", async () => {
    const rows = [
      makeRow({ id: "id-2", reference: "LQ-LATER", wedding_date: "2026-12-01" }),
      makeRow({ id: "id-1", reference: "LQ-EARLIER", wedding_date: "2026-08-01" }),
    ];
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch(rows));
    const html = await res.text();
    expect(html.indexOf("LQ-EARLIER")).toBeLessThan(html.indexOf("LQ-LATER"));
  });

  it("generates distinct invoice tokens for different bookings", async () => {
    const rows = [
      makeRow({ id: "aaaaaaaa-0000-0000-0000-000000000001", reference: "LQ-A" }),
      makeRow({ id: "bbbbbbbb-0000-0000-0000-000000000002", reference: "LQ-B" }),
    ];
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch(rows));
    const html = await res.text();
    const matches = [...html.matchAll(/\/api\/booking\/invoice\?token=([A-Za-z0-9_%.-]+)/g)];
    expect(matches.length).toBe(2);
    // Different booking IDs produce different tokens
    expect(matches[0]![1]).not.toBe(matches[1]![1]);
  });

  it("escapes HTML in bride name and reference", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([
      makeRow({ bride_name: "<script>xss</script>", reference: "LQ-<>&" }),
    ]));
    const html = await res.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes nav links to other admin pages", async () => {
    const req = new Request(`https://w.example/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([]));
    const html = await res.text();
    expect(html).toContain("/api/admin/blocked-dates");
    expect(html).toContain("/api/admin/accounting");
  });

  it("invoice links use the request's host as base URL", async () => {
    const req = new Request(`https://lustiqueco.co.za/api/admin/invoices?token=${ADMIN_SECRET}`);
    const res = await handleAdminInvoices(env, req, mockFetch([makeRow()]));
    const html = await res.text();
    expect(html).toContain("https://lustiqueco.co.za/api/booking/invoice?token=");
  });
});
