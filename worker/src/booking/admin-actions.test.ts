// worker/src/booking/admin-actions.test.ts
// Wave D5 — TDD: admin action handlers (Send Quote, Decline, Mark Deposit, Mark Balance).

import { describe, it, expect, vi } from "vitest";
import {
  handleAdminSendQuote,
  handleAdminDeclineBooking,
  handleAdminMarkDepositPaid,
  handleAdminMarkBalancePaid,
} from "./admin-actions";
import { AUTH_COOKIE } from "./auth";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function mintJwt(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockAudit = { put: vi.fn().mockResolvedValue(undefined) };

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  SIGNING_SECRET: "signing-secret-at-least-32-chars-long!!",
  BREVO_API_KEY: "brevo-key",
  NOTIFY_EMAIL: "info@lustiqueco.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  AUDIT: mockAudit,
};

const adminProfile = [{ role: "admin", full_name: "Zandeline" }];

const requestedBooking = {
  id: "bk1",
  reference: "LUS-2026-001",
  status: "requested",
  bride_name: "Sophie Rose",
  bride_email: "sophie@example.com",
  wedding_date: "2026-09-15",
  venue: null,
  town: "Pretoria",
  province: "Gauteng",
  party_size: 4,
  total_cents: 1500000,
  deposit_pct: 50,
  deposit_net_cents: 750000,
  balance_net_cents: 750000,
  confirm_token_expires_at: "2027-01-01T00:00:00Z",
  confirm_token_used_at: null,
  wave_customer_id: null,
  wave_invoice_id: null,
  quote_sent_at: null,
  accepted_at: null,
};

const acceptedBooking = { ...requestedBooking, status: "accepted", quote_sent_at: "2026-06-01T10:00:00Z", accepted_at: "2026-06-02T10:00:00Z" };
const depositPaidBooking = { ...acceptedBooking, status: "deposit_paid" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const postReq = (path: string, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { method: "POST", headers, body: "" });
};

// ── handleAdminSendQuote ──────────────────────────────────────────────────────

describe("handleAdminSendQuote", () => {
  it("redirects to login without a session cookie", async () => {
    const f = vi.fn();
    const res = await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote"), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("redirects with error when booking not found", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([])); // getBookingById → not found
      return Promise.resolve(json([]));
    });
    const res = await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("Booking%20not%20found");
  });

  it("redirects with error when status is not 'requested' or 'quote_sent'", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([{ ...requestedBooking, status: "accepted" }]));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("accepted");
  });

  it("redirects with error when transition returns null (already handled)", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([requestedBooking]));
      // transitionRequestedBooking PATCH → empty array = 0 rows matched
      if (url.includes("&status=eq.requested")) return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });

  it("sends emails and redirects to saved on success", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([requestedBooking]));
      if (url.includes("&status=eq.requested")) return Promise.resolve(json([{ ...requestedBooking, status: "quote_sent" }]));
      if (url.includes("brevo.com")) return Promise.resolve(json({ messageId: "x" }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
    // Two Brevo calls (bride + team)
    const brevoCalls = (f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => typeof url === "string" && url.includes("brevo.com"),
    );
    expect(brevoCalls.length).toBe(2);
  });

  it("bride email contains secure URL + invoice URL and no reject URL", async () => {
    const token = await validAdminJwt();
    let capturedBrideHtml = "";
    const f = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([requestedBooking]));
      if (url.includes("&status=eq.requested")) return Promise.resolve(json([{ ...requestedBooking, status: "quote_sent" }]));
      if (url.includes("brevo.com")) {
        const body = JSON.parse((opts as RequestInit).body as string);
        if (body.to[0].email === "sophie@example.com") capturedBrideHtml = body.htmlContent as string;
        return Promise.resolve(json({ messageId: "x" }));
      }
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    await handleAdminSendQuote(postReq("/api/admin/booking/bk1/send-quote", token), env, "bk1", f as unknown as typeof fetch);
    expect(capturedBrideHtml).toContain("/api/booking/invoice");
    expect(capturedBrideHtml).not.toContain("/api/booking/accept");
    expect(capturedBrideHtml).not.toContain("/api/booking/reject");
  });
});

// ── handleAdminDeclineBooking ─────────────────────────────────────────────────

describe("handleAdminDeclineBooking", () => {
  it("redirects to login without a session cookie", async () => {
    const f = vi.fn();
    const res = await handleAdminDeclineBooking(postReq("/api/admin/booking/bk1/decline-booking"), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("redirects with error when status is not 'requested'", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([acceptedBooking]));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminDeclineBooking(postReq("/api/admin/booking/bk1/decline-booking", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("accepted");
  });

  it("sends decline email and redirects to saved on success", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([requestedBooking]));
      if (url.includes("&status=eq.requested")) return Promise.resolve(json([{ ...requestedBooking, status: "declined" }]));
      if (url.includes("brevo.com")) return Promise.resolve(json({ messageId: "x" }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminDeclineBooking(postReq("/api/admin/booking/bk1/decline-booking", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
    const brevoCalls = (f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => typeof url === "string" && url.includes("brevo.com"),
    );
    expect(brevoCalls.length).toBe(1);
  });
});

// ── handleAdminMarkDepositPaid ────────────────────────────────────────────────

describe("handleAdminMarkDepositPaid", () => {
  it("redirects to login without a session cookie", async () => {
    const f = vi.fn();
    const res = await handleAdminMarkDepositPaid(postReq("/api/admin/booking/bk1/mark-deposit"), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("redirects with error when status is not 'accepted' or 'confirmed'", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([requestedBooking]));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminMarkDepositPaid(postReq("/api/admin/booking/bk1/mark-deposit", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("requested");
  });

  it("transitions accepted → deposit_paid and emails bride", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([acceptedBooking]));
      if (url.includes("&status=eq.accepted")) return Promise.resolve(json([{ ...acceptedBooking, status: "deposit_paid" }]));
      if (url.includes("brevo.com")) return Promise.resolve(json({ messageId: "x" }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminMarkDepositPaid(postReq("/api/admin/booking/bk1/mark-deposit", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
    const brevoCalls = (f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => typeof url === "string" && url.includes("brevo.com"),
    );
    expect(brevoCalls.length).toBe(1);
  });
});

// ── handleAdminMarkBalancePaid ────────────────────────────────────────────────

describe("handleAdminMarkBalancePaid", () => {
  it("redirects to login without a session cookie", async () => {
    const f = vi.fn();
    const res = await handleAdminMarkBalancePaid(postReq("/api/admin/booking/bk1/mark-balance"), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("redirects with error when status is not 'deposit_paid'", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([acceptedBooking]));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminMarkBalancePaid(postReq("/api/admin/booking/bk1/mark-balance", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("accepted");
  });

  it("transitions deposit_paid → settled and emails bride", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([depositPaidBooking]));
      if (url.includes("&status=eq.deposit_paid")) return Promise.resolve(json([{ ...depositPaidBooking, status: "settled" }]));
      if (url.includes("brevo.com")) return Promise.resolve(json({ messageId: "x" }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAdminMarkBalancePaid(postReq("/api/admin/booking/bk1/mark-balance", token), env, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
    const brevoCalls = (f as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => typeof url === "string" && url.includes("brevo.com"),
    );
    expect(brevoCalls.length).toBe(1);
  });

  it("syncs the bride to the past-clients Brevo list when BREVO_PAST_CLIENTS_LIST_ID is set", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/auth/v1/user")) return Promise.resolve(json({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "zandeline@lustiqueco.co.za" }));
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("&select=")) return Promise.resolve(json([depositPaidBooking]));
      if (url.includes("&status=eq.deposit_paid")) return Promise.resolve(json([{ ...depositPaidBooking, status: "settled" }]));
      if (url === "https://api.brevo.com/v3/contacts") return Promise.resolve(new Response(null, { status: 201 }));
      if (url.includes("brevo.com")) return Promise.resolve(json({ messageId: "x" }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const envWithList = { ...env, BREVO_PAST_CLIENTS_LIST_ID: "99" };
    const res = await handleAdminMarkBalancePaid(postReq("/api/admin/booking/bk1/mark-balance", token), envWithList, "bk1", f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    const contactCall = (f as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]: [string]) => url === "https://api.brevo.com/v3/contacts",
    );
    expect(contactCall).toBeTruthy();
  });
});
