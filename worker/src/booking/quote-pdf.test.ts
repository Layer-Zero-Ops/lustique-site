// worker/src/booking/quote-pdf.test.ts — Wave B.3 quote PDF admin page
import { describe, it, expect, vi } from "vitest";
import { handleAdminQuotePdf } from "./quote-pdf";

const ADMIN_SECRET = "test-admin-secret";

function makeEnv() {
  return {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_KEY: "svc-key",
    ADMIN_SECRET,
  };
}

const BOOKING = {
  id: "b-001",
  reference: "LQ-0042",
  status: "quote_sent",
  bride_name: "Ami Claassen",
  bride_email: "ami@example.com",
  wedding_date: "2026-11-07",
  venue: "Molenvliet",
  town: "Stellenbosch",
  province: "Western Cape",
  party_size: 3,
  total_cents: 450000,
  deposit_pct: 50,
  deposit_net_cents: 225000,
  balance_net_cents: 225000,
  confirm_token_expires_at: "2027-01-01T00:00:00Z",
  confirm_token_used_at: null,
  wave_customer_id: null,
  wave_invoice_id: null,
  quote_sent_at: "2026-06-01T10:00:00Z",
  accepted_at: null,
  quote_lines: [
    { label: "Bridal hair & makeup", amount: 3500 },
    { label: "2 × Bridesmaid hair", amount: 500 },
  ],
};

function makeDbFetch(booking = BOOKING): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [booking],
  }) as unknown as typeof fetch;
}

function makeNotFoundFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as unknown as typeof fetch;
}

function get(params: Record<string, string>): Request {
  const q = new URLSearchParams(params).toString();
  return new Request(`https://worker.dev/api/admin/quote-pdf?${q}`);
}

// ── auth ──────────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("returns 401 with no token", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ id: "b-001" }), makeDbFetch());
    expect(r.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: "wrong", id: "b-001" }), makeDbFetch());
    expect(r.status).toBe(401);
  });

  it("returns 401 with empty token", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: "", id: "b-001" }), makeDbFetch());
    expect(r.status).toBe(401);
  });
});

// ── input validation ──────────────────────────────────────────────────────────

describe("input validation", () => {
  it("returns 400 when id is missing", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET }), makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("returns 404 when booking not found", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-999" }), makeNotFoundFetch());
    expect(r.status).toBe(404);
  });
});

// ── content ───────────────────────────────────────────────────────────────────

describe("quote content", () => {
  it("returns 200 with text/html content-type", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it("is private and not cacheable", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("renders the booking reference", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(await r.text()).toContain("LQ-0042");
  });

  it("renders the bride's name and email", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("Ami Claassen");
    expect(html).toContain("ami@example.com");
  });

  it("renders wedding date and venue", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("2026-11-07");
    expect(html).toContain("Molenvliet");
  });

  it("renders quote line items", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("Bridal hair &amp; makeup");
    expect(html).toContain("2 × Bridesmaid hair");
  });

  it("renders deposit percentage and amounts", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("50%");
    // en-ZA locale may use non-breaking space ( ) as thousands separator
    expect(html).toMatch(/4[\s ]500/);  // total R4500
    expect(html).toMatch(/2[\s ]250/);  // deposit R2250
  });

  it("renders the quote expiry date (quote_sent_at + 7 days)", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(await r.text()).toContain("8 June 2026");
  });

  it("renders a fallback service line when quote_lines is empty", async () => {
    const f = makeDbFetch({ ...BOOKING, quote_lines: [] });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("Wedding hair");
  });

  it("shows '—' expiry when quote_sent_at is null", async () => {
    const f = makeDbFetch({ ...BOOKING, quote_sent_at: null });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("Valid until: —");
  });
});

// ── status badges ─────────────────────────────────────────────────────────────

describe("status badges", () => {
  it("quote_sent → awaiting acceptance", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(await r.text()).toContain("awaiting acceptance");
  });

  it("accepted → awaiting deposit", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "accepted" });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("awaiting deposit");
  });

  it("deposit_paid → deposit received", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "deposit_paid" });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("deposit received");
  });

  it("settled → Fully settled", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "settled" });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("Fully settled");
  });

  it("rejected → Declined by client", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "rejected" });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("Declined by client");
  });

  it("invoice_expired → Quote expired", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "invoice_expired" });
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), f);
    expect(await r.text()).toContain("Quote expired");
  });
});

// ── admin note + noindex ──────────────────────────────────────────────────────

describe("admin-only markers", () => {
  it("includes admin-only note", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(await r.text()).toContain("Admin use only");
  });

  it("includes noindex meta tag", async () => {
    const r = await handleAdminQuotePdf(makeEnv(), get({ token: ADMIN_SECRET, id: "b-001" }), makeDbFetch());
    expect(await r.text()).toContain('content="noindex"');
  });
});
