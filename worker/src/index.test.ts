// worker/src/index.test.ts
// Tests for rate-limiting behaviour wired in index.ts.

import { describe, it, expect, vi } from "vitest";
import worker from "./index";

// ── Env factory ──────────────────────────────────────────────────────────────

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BREVO_API_KEY: "brevo",
    NOTIFY_EMAIL: "z@lustiqueco.co.za",
    ALLOWED_ORIGIN: "https://lustiqueco.co.za",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc",
    SUPABASE_JWT_SECRET: "jwt-secret",
    YOCO_SECRET_KEY: "yoco",
    YOCO_WEBHOOK_SECRET: "whsec",
    SIGNING_SECRET: "signing",
    TURNSTILE_SECRET: "ts",
    EFT_BANK: "FNB",
    EFT_ACCOUNT_NAME: "Lustique",
    EFT_ACCOUNT_NO: "12345",
    EFT_BRANCH_CODE: "250655",
    ADMIN_SECRET: "admin-secret",
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
    // All RL bindings PASS by default
    RL_LOGIN:       { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_LOGIN_EMAIL: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_BOOKING:     { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ENQUIRY:     { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ADMIN:       { limit: vi.fn().mockResolvedValue({ success: true }) },
    ...overrides,
  };
}

function makeReq(method: string, pathname: string, body?: unknown, ip = "1.2.3.4") {
  return new Request(`https://worker${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Rate limiting — POST /api/booking/request", () => {
  it("returns 429 with correct JSON when RL_BOOKING blocks", async () => {
    const env = baseEnv({ RL_BOOKING: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/booking/request", { brideName: "Test" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_BOOKING blocks", async () => {
    const env = baseEnv({ RL_BOOKING: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/booking/request", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — POST /api/enquiry", () => {
  it("returns 429 with correct JSON when RL_ENQUIRY blocks", async () => {
    const env = baseEnv({ RL_ENQUIRY: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/enquiry", { name: "Test", email: "t@t.com", hp_company: "" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_ENQUIRY blocks", async () => {
    const env = baseEnv({ RL_ENQUIRY: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/enquiry", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — POST /api/admin/login", () => {
  it("returns 429 JSON when RL_LOGIN blocks (IP check fires before handler)", async () => {
    const env = baseEnv({ RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/admin/login", null);
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("includes Retry-After header when RL_LOGIN blocks", async () => {
    const env = baseEnv({ RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("POST", "/api/admin/login", null);
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("Rate limiting — GET /api/admin/* (JWT block)", () => {
  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/dashboard", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/dashboard");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });
});

describe("Rate limiting — legacy ADMIN_SECRET routes", () => {
  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/blocked-dates", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/blocked-dates");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
    const data = await resp.json() as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests. Please try again later.");
  });

  it("returns 429 JSON when RL_ADMIN blocks on GET /api/admin/accounting", async () => {
    const env = baseEnv({ RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const req = makeReq("GET", "/api/admin/accounting");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(429);
  });
});

describe("Rate limiting — Yoco webhook is exempt", () => {
  it("does NOT apply RL_BOOKING to POST /api/booking/yoco-webhook", async () => {
    const rlBooking = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const env = baseEnv({ RL_BOOKING: rlBooking });
    // Webhook will fail validation (no sig header) but must not return 429
    const req = makeReq("POST", "/api/booking/yoco-webhook", {});
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).not.toBe(429);
    expect(rlBooking.limit).not.toHaveBeenCalled();
  });
});

describe("Rate limiting — passes through when binding allows", () => {
  it("does not 429 /api/booking/request when RL_BOOKING passes (handler may 422 on bad body)", async () => {
    const env = baseEnv();
    const req = makeReq("POST", "/api/booking/request", { brideName: "x" });
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).not.toBe(429);
  }, 10000);
});

describe("Routing — /api/admin/marketing", () => {
  it("routes GET /api/admin/marketing to the handler (redirects to login, not a 404)", async () => {
    const env = baseEnv();
    const req = makeReq("GET", "/api/admin/marketing");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/api/admin/login");
  });

  it("routes POST /api/admin/marketing/sync-past-clients to the handler (redirects to login, not a 404)", async () => {
    const env = baseEnv();
    const req = makeReq("POST", "/api/admin/marketing/sync-past-clients");
    const resp = await worker.fetch(req, env as never, {} as ExecutionContext);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/api/admin/login");
  });
});
