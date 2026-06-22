// worker/src/booking/dashboard.rateLimit.test.ts
// Tests the email-keyed rate-limit guard inside handleAdminLogin.
// The IP-keyed guard lives in index.ts and is tested in index.test.ts.

import { describe, it, expect, vi } from "vitest";
import { handleAdminLogin } from "./dashboard";
import type { DashboardEnv } from "./dashboard";

// ── env factory ───────────────────────────────────────────────────────────────

function makeEnv(rlEmailSuccess: boolean, includeBinding = true): DashboardEnv {
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
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
    ...(includeBinding
      ? { RL_LOGIN_EMAIL: { limit: vi.fn().mockResolvedValue({ success: rlEmailSuccess }) } }
      : {}),
  } as unknown as DashboardEnv;
}

// noFetch: asserts that Supabase OTP is never called when rate-limited
const noFetch = vi.fn().mockRejectedValue(new Error("fetch must not be called when rate-limited"));

// ── Request builders ──────────────────────────────────────────────────────────

/** URL-encoded body — the standard browser form-submit format */
function makeUrlEncodedPost(email: string): Request {
  return new Request("https://worker/api/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "5.6.7.8",
    },
    body: `email=${encodeURIComponent(email)}`,
  });
}

/** Multipart/form-data body — what browsers send for <form enctype="multipart/form-data"> */
function makeMultipartPost(email: string): Request {
  const fd = new FormData();
  fd.append("email", email);
  return new Request("https://worker/api/admin/login", {
    method: "POST",
    headers: { "cf-connecting-ip": "5.6.7.8" },
    body: fd,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleAdminLogin — email-keyed rate limit (RL_LOGIN_EMAIL)", () => {
  it("returns 429 when RL_LOGIN_EMAIL blocks (URL-encoded body)", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.status).toBe(429);
    const text = await resp.text();
    expect(text).toContain("Too many requests");
  });

  it("does NOT call Supabase OTP when rate-limited (URL-encoded body)", async () => {
    const env = makeEnv(false);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchSpy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 429 when RL_LOGIN_EMAIL blocks (multipart body)", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeMultipartPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.status).toBe(429);
    const text = await resp.text();
    expect(text).toContain("Too many requests");
  });

  it("does NOT call Supabase OTP when rate-limited (multipart body)", async () => {
    const env = makeEnv(false);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    await handleAdminLogin(makeMultipartPost("info@lustiqueco.co.za"), env, fetchSpy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes Retry-After: 60 header when RL_LOGIN_EMAIL blocks", async () => {
    const env = makeEnv(false);
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, noFetch);
    expect(resp.headers.get("retry-after")).toBe("60");
  });

  it("keys the binding by the submitted email address (not the IP)", async () => {
    const env = makeEnv(true); // passes — we just want to inspect the call
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchMock);
    const rl = (env.RL_LOGIN_EMAIL as { limit: ReturnType<typeof vi.fn> }).limit;
    expect(rl).toHaveBeenCalledWith({ key: "info@lustiqueco.co.za" });
  });

  it("proceeds to OTP call when RL_LOGIN_EMAIL passes", async () => {
    const env = makeEnv(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), env, fetchMock);
    expect(resp.status).toBe(200); // check-email page
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("skips RL_LOGIN_EMAIL check gracefully when binding is absent (optional field)", async () => {
    const envNoRl = makeEnv(true, false); // no RL_LOGIN_EMAIL in env
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const resp = await handleAdminLogin(makeUrlEncodedPost("info@lustiqueco.co.za"), envNoRl, fetchMock);
    expect(resp.status).toBe(200); // still reaches check-email page
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
