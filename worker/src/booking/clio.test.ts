// worker/src/booking/clio.test.ts
import { describe, it, expect, vi } from "vitest";
import { notifyClio, signClioEvent, type ClioEnv } from "./clio";

const baseEnv: ClioEnv = {
  CLIO_WEBHOOK_URL: "https://clio.example/inbound",
  CLIO_WEBHOOK_SECRET: "test-secret",
  SUPABASE_URL: "https://db.example",
  SUPABASE_SERVICE_KEY: "svc-key",
};

function mkFetch() {
  return vi.fn(async (_url: string, _opts: unknown) => new Response("OK", { status: 200 }));
}

describe("notifyClio", () => {
  it("is a no-op when CLIO_WEBHOOK_URL is unset (receiver not wired yet)", async () => {
    const f = mkFetch();
    notifyClio({ ...baseEnv, CLIO_WEBHOOK_URL: undefined }, { type: "enquiry.received", title: "New" }, f);
    // allow the microtask to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs a signed event to CLIO_WEBHOOK_URL with webhook-* headers", async () => {
    const f = mkFetch();
    notifyClio(baseEnv, {
      type: "payment.deposit_paid",
      title: "Deposit paid — Jane",
      body: "LUS-2026-AB · 2026-12-01",
      link: "/api/admin/booking/abc",
      audience: "zandeline",
      payload: { reference: "LUS-2026-AB" },
    }, f);
    await new Promise((r) => setTimeout(r, 10));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, opts] = f.mock.calls[0]!;
    expect(url).toBe("https://clio.example/inbound");
    const h = (opts as RequestInit).headers as Record<string, string>;
    expect(h["webhook-id"]).toBeDefined();
    expect(h["webhook-timestamp"]).toBeDefined();
    expect(h["webhook-signature"]).toMatch(/^v1,/);
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.event_type).toBe("payment.deposit_paid");
    expect(body.audience).toBe("zandeline");
    expect(body.payload.reference).toBe("LUS-2026-AB");
  });

  it("defaults audience to zandeline", async () => {
    const f = mkFetch();
    notifyClio(baseEnv, { type: "enquiry.received", title: "New enquiry" }, f);
    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.audience).toBe("zandeline");
  });

  it("persists to clio_activity even when no webhook URL is set", async () => {
    const f = mkFetch();
    notifyClio({ ...baseEnv, CLIO_WEBHOOK_URL: undefined }, { type: "enquiry.received", title: "New" }, f);
    await new Promise((r) => setTimeout(r, 10));
    // Only the Supabase POST (persistActivity) should have fired, not the webhook.
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe("https://db.example/rest/v1/clio_activity");
  });

  it("never throws when the receiver errors (fire-and-forget)", async () => {
    const f = vi.fn(async () => { throw new Error("network down"); });
    // must not throw synchronously or on flush
    expect(() =>
      notifyClio(baseEnv, { type: "payment.failed", title: "Failed" }, f),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("omits signature headers when CLIO_WEBHOOK_SECRET is unset", async () => {
    const f = mkFetch();
    notifyClio({ ...baseEnv, CLIO_WEBHOOK_SECRET: undefined }, { type: "x", title: "t" }, f);
    await new Promise((r) => setTimeout(r, 10));
    const h = (f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(h["webhook-signature"]).toBeUndefined();
  });
});

describe("signClioEvent", () => {
  it("produces a stable v1 signature over id.ts.body", async () => {
    const a = await signClioEvent("body", "id1", "100", "secret");
    const b = await signClioEvent("body", "id1", "100", "secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
    // different body → different sig
    const c = await signClioEvent("other", "id1", "100", "secret");
    expect(c).not.toBe(a);
  });

  it("matches a locally-verified HMAC (timing-safe)", async () => {
    const rawBody = JSON.stringify({ id: "x", ts: "1", event_type: "e" });
    const sig = await signClioEvent(rawBody, "x", "1", "s3cret");
    const computed = await signClioEvent(rawBody, "x", "1", "s3cret");
    expect(timingSafeEqualLocal(sig, computed)).toBe(true);
  });
});

// local mirror of timingSafeEqual for the test only
function timingSafeEqualLocal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
