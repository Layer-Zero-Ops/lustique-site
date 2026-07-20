// worker/src/lib/observe.test.ts
import { describe, it, expect, vi } from "vitest";
import { newRequestId, attachRequestId, reportError } from "./observe";
import worker from "../index";

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
    RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_LOGIN_EMAIL: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_BOOKING: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ENQUIRY: { limit: vi.fn().mockResolvedValue({ success: true }) },
    RL_ADMIN: { limit: vi.fn().mockResolvedValue({ success: true }) },
    ...overrides,
  };
}

function req(method: string, pathname: string) {
  return new Request(`https://worker${pathname}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
  });
}

describe("observe helpers", () => {
  it("newRequestId returns a short non-empty id", () => {
    const id = newRequestId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("attachRequestId sets the header without mutating status", () => {
    const r = new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    const out = attachRequestId(r, "abc123");
    expect(out.headers.get("X-Request-Id")).toBe("abc123");
    expect(out.status).toBe(200);
  });

  it("reportError is a no-op (and does not throw) when SENTRY_DSN is unset", async () => {
    await expect(reportError({}, "rid", new Error("boom"))).resolves.toBeUndefined();
  });

  it("reportError POSTs to Sentry store endpoint when DSN is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const dsn = "https://deadbeef@o1.ingest.sentry.io/42";
    await reportError({ SENTRY_DSN: dsn }, "rid9", new Error("kaboom"), fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/store/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=deadbeef");
    expect(init.body as string).toContain("kaboom");
  });
});

describe("worker fetch wrapper — observability", () => {
  it("attaches an X-Request-Id to every response (proves the wrapper runs)", async () => {
    const res = await worker.fetch(req("GET", "/api/health"), baseEnv() as never, undefined as never);
    // /api/health returns 200 or 503 depending on whether the (sandbox-unreachable)
    // Supabase ping succeeds — both are valid; the point is the wrapper ran.
    expect([200, 503]).toContain(res.status);
    expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{1,36}$/);
  });

  it("attaches X-Request-Id even on 404 (unknown route)", async () => {
    const res = await worker.fetch(req("GET", "/api/does-not-exist"), baseEnv() as never, undefined as never);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});
