// worker/src/booking/dashboard-c2.test.ts
// Wave C.2 — tests for the 6 new JWT-gated admin dashboard views.
import { describe, it, expect, vi } from "vitest";
import {
  handleAdminBookingDetail,
  handleAdminQuotes,
  handleAdminPayments,
  handleAdminRejections,
  handleAdminCalendar,
  handleAdminTemplates,
} from "./dashboard";
import { AUTH_COOKIE } from "./auth";

// ── Shared JWT helpers (same pattern as dashboard.test.ts) ────────────────────

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintJwt(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TEST_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

async function validAdminJwt(): Promise<string> {
  return mintJwt({
    sub: "aaaaaaaa-0000-0000-0000-000000000001",
    email: "zandeline@lustiqueco.co.za",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
}

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "info@lustiqueco.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  ADMIN_SECRET: "secret",
  SIGNING_SECRET: "signing",
  YOCO_SECRET_KEY: "yoco",
  YOCO_WEBHOOK_SECRET: "yoco-hook",
  TURNSTILE_SECRET: "ts",
  EFT_BANK: "", EFT_ACCOUNT_NAME: "", EFT_ACCOUNT_NO: "", EFT_BRANCH_CODE: "",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const getReq = (path: string, cookie?: string) => {
  const headers: HeadersInit = {};
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { headers });
};

const postReq = (path: string, body: Record<string, string>, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
};

// Profile mock returned by getAdminSession's profiles query
const adminProfile = [{ role: "admin", full_name: "Zandeline" }];

const sampleBooking = {
  id: "bb-0001",
  reference: "LUS-2026-001",
  status: "requested",
  bride_name: "Anke Smith",
  bride_email: "anke@example.com",
  bride_phone: "0831234567",
  wedding_date: "2027-03-14",
  town: "Pretoria",
  province: "Gauteng",
  venue: "The Venue",
  party_size: 4,
  total_cents: 360000,
  deposit_pct: 50,
  deposit_net_cents: 180000,
  balance_net_cents: 180000,
  occasion: "wedding",
  quote_lines: [{ label: "Hair", amount: 200000 }, { label: "Makeup", amount: 160000 }],
  created_at: "2026-06-01T10:00:00Z",
  quote_sent_at: null,
  accepted_at: null,
  rejected_at: null,
  invoice_expired_at: null,
  availability_conflict: false,
  notes: null,
};

// ── handleAdminBookingDetail ──────────────────────────────────────────────────

describe("handleAdminBookingDetail — GET", () => {
  it("redirects to login without a valid session", async () => {
    const f = vi.fn();
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bb-0001"),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders booking detail with bride info and quote lines", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))       // getAdminSession profiles
      .mockResolvedValueOnce(json([sampleBooking]))    // booking fetch
      .mockResolvedValueOnce(json([]))                 // payments
      .mockResolvedValueOnce(json([]))                 // quote_revisions
      .mockResolvedValueOnce(json([]));                // rejections
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bb-0001", token),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Anke Smith");
    expect(html).toContain("LUS-2026-001");
    expect(html).toContain("Pretoria");
    expect(html).toContain("Hair");
    expect(html).toContain("Makeup");
    expect(html).toContain("R");           // ZAR prefix present (exact separator is locale-dependent)
  });

  it("shows edit form for a requested booking", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([sampleBooking]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bb-0001", token),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain('name="total_zar"');
    expect(html).toContain("Save revision");
  });

  it("shows revision history when revisions exist", async () => {
    const token = await validAdminJwt();
    const revisions = [{ id: "r1", old_total_cents: 300000, new_total_cents: 360000, revised_by: "zandeline@lustiqueco.co.za", created_at: "2026-06-02T09:00:00Z" }];
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([sampleBooking]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json(revisions))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/bb-0001", token),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain("zandeline@lustiqueco.co.za");
    expect(html).toContain("Old total");    // revision table header
    expect(html).toContain("New total");    // revision table header
  });

  it("returns 404 when booking id not found", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]));   // empty = not found
    const res = await handleAdminBookingDetail(
      getReq("/api/admin/booking/unknown-id", token),
      env,
      "unknown-id",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(404);
  });
});

describe("handleAdminBookingDetail — POST (quote edit)", () => {
  it("patches booking total and records revision, then redirects", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))          // getAdminSession
      .mockResolvedValueOnce(json([{                      // fetch current totals
        total_cents: 360000, deposit_pct: 50,
        deposit_net_cents: 180000, balance_net_cents: 180000,
      }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))  // PATCH booking
      .mockResolvedValueOnce(new Response(null, { status: 201 })); // INSERT revision
    const res = await handleAdminBookingDetail(
      postReq("/api/admin/quote/bb-0001", { total_zar: "4000" }, token),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/booking/bb-0001");

    // Verify PATCH was called with new total
    const patchCall = (f as ReturnType<typeof vi.fn>).mock.calls[2] as [string, RequestInit];
    const patchBody = JSON.parse(patchCall[1]!.body as string);
    expect(patchBody.total_cents).toBe(400000);
    expect(patchBody.deposit_net_cents).toBe(200000); // 50% of 400000
    expect(patchBody.balance_net_cents).toBe(200000);
  });

  it("returns 400 for an invalid amount", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockResolvedValueOnce(json(adminProfile));
    const res = await handleAdminBookingDetail(
      postReq("/api/admin/quote/bb-0001", { total_zar: "0" }, token),
      env,
      "bb-0001",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
  });
});

// ── handleAdminQuotes ─────────────────────────────────────────────────────────

describe("handleAdminQuotes", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAdminQuotes(getReq("/api/admin/quotes"), env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders sent-quotes table with expiry countdown", async () => {
    const token = await validAdminJwt();
    const quoteSentAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago → 5d left
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([{
        id: "bb-q1", reference: "LUS-2026-002",
        bride_name: "Liesl van Wyk", bride_email: "liesl@example.com",
        wedding_date: "2027-09-20", town: "Johannesburg",
        party_size: 6, total_cents: 480000, quote_sent_at: quoteSentAt,
      }]));
    const res = await handleAdminQuotes(
      getReq("/api/admin/quotes", token),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Liesl van Wyk");
    expect(html).toContain("LUS-2026-002");
    expect(html).toContain("Johannesburg");
    expect(html).toContain("left");
  });

  it("shows empty state when no quotes are pending", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminQuotes(getReq("/api/admin/quotes", token), env, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("no quotes");
  });
});

// ── handleAdminPayments ───────────────────────────────────────────────────────

describe("handleAdminPayments", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAdminPayments(getReq("/api/admin/payments"), env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
  });

  it("renders payments table with Yoco vs EFT indicator", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([
        {
          id: "pay-1", kind: "deposit", status: "paid",
          net_cents: 180000, payable_cents: 183240,
          yoco_checkout_id: "chk-aaa", yoco_payment_id: "pay-bbb",
          created_at: "2026-06-10T10:00:00Z", paid_at: "2026-06-10T10:05:00Z",
          bookings: { reference: "LUS-2026-003", bride_name: "Marie Botha", wedding_date: "2027-05-01" },
        },
        {
          id: "pay-2", kind: "deposit", status: "paid",
          net_cents: 90000, payable_cents: 90000,
          yoco_checkout_id: null, yoco_payment_id: null,
          created_at: "2026-06-11T08:00:00Z", paid_at: "2026-06-11T14:00:00Z",
          bookings: { reference: "LUS-2026-004", bride_name: "Caro Nel", wedding_date: "2027-06-15" },
        },
      ]));
    const res = await handleAdminPayments(getReq("/api/admin/payments", token), env, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Marie Botha");
    expect(html).toContain("Yoco");
    expect(html).toContain("Caro Nel");
    expect(html).toContain("EFT");
  });

  it("shows empty state when no payments exist", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminPayments(getReq("/api/admin/payments", token), env, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("no payments");
  });
});

// ── handleAdminRejections ─────────────────────────────────────────────────────

describe("handleAdminRejections", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAdminRejections(getReq("/api/admin/rejections"), env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
  });

  it("renders rejections table with reason codes and booking links", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([
        {
          id: "rej-1", rejected_by: "bride", reason_code: "price",
          reason_text: "Too expensive for our budget", created_at: "2026-06-12T09:00:00Z",
          bookings: { id: "bb-0002", reference: "LUS-2026-005", bride_name: "Sonia du Plessis", wedding_date: "2027-08-10", status: "rejected" },
        },
      ]));
    const res = await handleAdminRejections(getReq("/api/admin/rejections", token), env, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sonia du Plessis");
    expect(html).toContain("price");
    expect(html).toContain("Too expensive");
    expect(html).toContain("LUS-2026-005");
    expect(html).toContain("/api/admin/booking/bb-0002");
  });

  it("shows empty state when no rejections exist", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminRejections(getReq("/api/admin/rejections", token), env, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("no rejections");
  });
});

// ── handleAdminCalendar ───────────────────────────────────────────────────────

describe("handleAdminCalendar — GET", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAdminCalendar(getReq("/api/admin/calendar"), env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
  });

  it("renders a month grid with day numbers and booking counts", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([{ wedding_date: "2027-03-14", status: "requested" }]))  // bookings
      .mockResolvedValueOnce(json([]));  // blocked_dates
    const res = await handleAdminCalendar(
      getReq("/api/admin/calendar?month=2027-03", token),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("March 2027");
    expect(html).toContain("1 booked");
    expect(html).toContain("Sun");
    expect(html).toContain("Sat");
  });

  it("shows hard-blocked indicator for slots=0 dates", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ date: "2027-03-15", slots: 0 }]));
    const res = await handleAdminCalendar(
      getReq("/api/admin/calendar?month=2027-03", token),
      env,
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain("BLOCKED");
  });

  it("renders the slots editor form", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminCalendar(getReq("/api/admin/calendar", token), env, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain('name="date"');
    expect(html).toContain('name="slots"');
    expect(html).toContain("Save");
  });
});

describe("handleAdminCalendar — POST (set slots)", () => {
  it("upserts slots for a date and redirects to the same month", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(new Response(null, { status: 201 })); // upsert
    const res = await handleAdminCalendar(
      postReq("/api/admin/calendar", { date: "2027-03-15", slots: "3" }, token),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("month=2027-03");
    const upsertCall = (f as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(upsertCall[1]!.body as string);
    expect(body.date).toBe("2027-03-15");
    expect(body.slots).toBe(3);
  });

  it("returns 400 for an invalid date format", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockResolvedValueOnce(json(adminProfile));
    const res = await handleAdminCalendar(
      postReq("/api/admin/calendar", { date: "not-a-date", slots: "2" }, token),
      env,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
  });
});

// ── handleAdminTemplates ──────────────────────────────────────────────────────

const sampleTemplate: Record<string, unknown> = {
  key: "invoice_sent",
  name: "Invoice sent to bride",
  subject: "Your Lustique quote — {{reference}}",
  body_html: "<p>Hi {{bride_name}},</p><p>Thank you for your interest in Lustique Co.</p>",
  enabled: true,
  send_offset_days: null,
  updated_at: "2026-06-01T08:00:00Z",
};

describe("handleAdminTemplates — list", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAdminTemplates(getReq("/api/admin/templates"), env, null, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
  });

  it("renders the templates list with key, name, subject, enabled", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([sampleTemplate]));
    const res = await handleAdminTemplates(
      getReq("/api/admin/templates", token),
      env,
      null,
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("invoice_sent");
    expect(html).toContain("Invoice sent to bride");
    expect(html).toContain("Your Lustique quote");
    expect(html).toContain("/api/admin/templates/invoice_sent");
  });
});

describe("handleAdminTemplates — GET edit", () => {
  it("renders the edit form with subject and body_html fields", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([sampleTemplate]));
    const res = await handleAdminTemplates(
      getReq("/api/admin/templates/invoice_sent", token),
      env,
      "invoice_sent",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="subject"');
    expect(html).toContain('name="body_html"');
    expect(html).toContain('name="enabled"');
    expect(html).toContain("Save template");
    expect(html).toContain("Your Lustique quote");
  });

  it("returns 404 for an unknown template key", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(json([]));
    const res = await handleAdminTemplates(
      getReq("/api/admin/templates/nonexistent", token),
      env,
      "nonexistent",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(404);
  });
});

describe("handleAdminTemplates — POST (save)", () => {
  it("patches the template and redirects back with saved=1", async () => {
    const token = await validAdminJwt();
    const f = vi.fn()
      .mockResolvedValueOnce(json(adminProfile))
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // PATCH
    const res = await handleAdminTemplates(
      postReq("/api/admin/templates/invoice_sent", {
        subject: "Updated subject",
        body_html: "<p>Hi {{bride_name}}, updated.</p>",
        enabled: "1",
      }, token),
      env,
      "invoice_sent",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/templates/invoice_sent");
    expect(res.headers.get("Location")).toContain("saved=1");

    const patchCall = (f as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(patchCall[1]!.body as string);
    expect(body.subject).toBe("Updated subject");
    expect(body.enabled).toBe(true);
  });

  it("returns 400 when subject is empty", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockResolvedValueOnce(json(adminProfile));
    const res = await handleAdminTemplates(
      postReq("/api/admin/templates/invoice_sent", { subject: "", body_html: "<p>Hi</p>", enabled: "1" }, token),
      env,
      "invoice_sent",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
  });
});
