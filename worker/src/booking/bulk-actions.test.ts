// worker/src/booking/bulk-actions.test.ts
// Tests for bulk advance + bulk delete on the Inbox and CRM lists.
import { describe, it, expect, vi } from "vitest";
import { handleAdminInboxBulk } from "./inbox";
import { handleAdminEnquiryBulk } from "./enquiries";
import { AUTH_COOKIE } from "./auth";

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintJwt(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}
async function adminJwt(): Promise<string> {
  return mintJwt({ sub: "aaaaaaaa-0000-0000-0000-000000000001", email: "z@l.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
}

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
} as any;

// fetch mock: records PATCH calls; GET status lookup returns a canned status.
// Also satisfies getAdminSession: /auth/v1/user + /rest/v1/profiles?role=admin.
// Pass authOk=false to simulate an unauthenticated (bad token) request.
function makeFetch(currentStatusByTable: Record<string, string>, authOk = true) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fn = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    const u = String(url);
    // Session validation (getAdminSession)
    if (u.includes("/auth/v1/user")) {
      if (!authOk) return { ok: false, status: 401, text: async () => "unauth", json: async () => ({}) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "z@l.co.za" }), json: async () => ({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "z@l.co.za" }) };
    }
    if (u.includes("/rest/v1/profiles")) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ role: "admin", full_name: "Zandeline" }]), json: async () => ([{ role: "admin", full_name: "Zandeline" }]) };
    }
    if (method === "PATCH") {
      calls.push({ url: u, method, body: JSON.parse(opts!.body as string) });
      return { ok: true, status: 204, text: async () => "", json: async () => [] };
    }
    if (u.includes("select=status")) {
      const table = u.includes("enquiries") ? "enquiries" : "bookings";
      return { ok: true, status: 200, text: async () => JSON.stringify([{ status: currentStatusByTable[table] ?? "new" }]), json: async () => [{ status: currentStatusByTable[table] ?? "new" }] };
    }
    // getEnquiryById / getEnquiryById-style lookups → return a row with the canned status
    if (u.includes("/rest/v1/enquiries") && method === "GET") {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "x", status: currentStatusByTable.enquiries ?? "new", contacted_at: null }]), json: async () => ([{ id: "x", status: currentStatusByTable.enquiries ?? "new", contacted_at: null }]) };
    }
    if (u.includes("/rest/v1/bookings") && method === "GET") {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "x", status: currentStatusByTable.bookings ?? "requested", quote_sent_at: null }]), json: async () => ([{ id: "x", status: currentStatusByTable.bookings ?? "requested", quote_sent_at: null }]) };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  });
  return { fn, calls };
}

const postForm = (path: string, fields: Record<string, string>, cookie: string) => {
  const fd = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", Cookie: `${AUTH_COOKIE}=${cookie}` },
    body: fd.toString(),
  });
};

describe("POST /api/admin/inbox/bulk", () => {
  it("advances a booking one stage and stamps the stage timestamp", async () => {
    const jwt = await adminJwt();
    const { fn, calls } = makeFetch({ bookings: "requested" });
    const req = postForm("/api/admin/inbox/bulk", { action: "advance", ids: "booking:bbbbbbbb-0000-0000-0000-000000000002" }, jwt);
    const res = await handleAdminInboxBulk(req, env, fn);
    expect(res.status).toBe(302);
    const patch = calls.find((c) => c.url.includes("bookings?"));
    expect(patch?.body.status).toBe("quote_sent");
    expect(patch?.body.quote_sent_at).toBeTruthy();
  });

  it("soft-deletes selected items (sets deleted_at)", async () => {
    const jwt = await adminJwt();
    const { fn, calls } = makeFetch({});
    const req = postForm("/api/admin/inbox/bulk", { action: "delete", ids: "enquiry:cccccccc-0000-0000-0000-000000000003" }, jwt);
    await handleAdminInboxBulk(req, env, fn);
    const patch = calls.find((c) => c.url.includes("enquiries?"));
    expect(patch?.body.deleted_at).toBeTruthy();
  });

  it("ignores malformed ids", async () => {
    const jwt = await adminJwt();
    const { fn, calls } = makeFetch({});
    const req = postForm("/api/admin/inbox/bulk", { action: "delete", ids: "enquiry:not-a-uuid" }, jwt);
    await handleAdminInboxBulk(req, env, fn);
    expect(calls.length).toBe(0);
  });

  it("redirects to login when unauthenticated", async () => {
    const { fn } = makeFetch({}, false);
    const req = postForm("/api/admin/inbox/bulk", { action: "advance", ids: "booking:bbbbbbbb-0000-0000-0000-000000000002" }, "bad-jwt");
    const res = await handleAdminInboxBulk(req, env, fn);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("login");
  });
});

describe("POST /api/admin/enquiries/bulk", () => {
  it("advances enquiries new -> contacted", async () => {
    const jwt = await adminJwt();
    const { fn, calls } = makeFetch({ enquiries: "new" });
    const req = postForm("/api/admin/enquiries/bulk", { action: "advance", ids: "dddddddd-0000-0000-0000-000000000004" }, jwt);
    await handleAdminEnquiryBulk(req, env, fn);
    const patch = calls.find((c) => c.url.includes("enquiries?"));
    expect(patch?.body.status).toBe("contacted");
  });

  it("soft-deletes selected enquiries", async () => {
    const jwt = await adminJwt();
    const { fn, calls } = makeFetch({});
    const req = postForm("/api/admin/enquiries/bulk", { action: "delete", ids: "eeeeeeee-0000-0000-0000-000000000005" }, jwt);
    await handleAdminEnquiryBulk(req, env, fn);
    const patch = calls.find((c) => c.url.includes("enquiries?"));
    expect(patch?.body.deleted_at).toBeTruthy();
  });
});
