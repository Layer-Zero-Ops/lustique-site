import { describe, it, expect, vi } from "vitest";
import {
  handleAdminEnquiries,
  handleAdminEnquiryDetail,
  handleAdminUpdateEnquiry,
  type ShellFn,
} from "./enquiries";
import { createHmac } from "node:crypto";

// ── Test helpers ─────────────────────────────────────────────────────────────

const SECRET = "test-jwt-secret";

async function validAdminJwt(): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payload = btoa(JSON.stringify({ sub: "u1", email: "z@lustique.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function authCookie(): Promise<string> {
  return `__Host-sb_session=${await validAdminJwt()}`;
}

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  SUPABASE_JWT_SECRET: SECRET,
  BREVO_API_KEY: "brevo",
  NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  SIGNING_SECRET: "s",
  TURNSTILE_SECRET: "ts",
  YOCO_SECRET_KEY: "yk",
  YOCO_WEBHOOK_SECRET: "yw",
  EFT_BANK: "b", EFT_ACCOUNT_NAME: "n", EFT_ACCOUNT_NO: "0", EFT_BRANCH_CODE: "0",
  AUDIT: { put: vi.fn() },
};

const shell: ShellFn = (_title, _user, inner) => `<html><body>${inner}</body></html>`;

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// First call for any authenticated handler: getAdminSession → profiles lookup
const profileRes = () => res([{ role: "admin", full_name: "Zandeline" }]);

const ENQUIRY = {
  id: "aaaa-1111",
  created_at: "2026-06-22T09:00:00.000Z",
  name: "Anke van der Berg",
  email: "anke@example.com",
  phone: "0671234567",
  occasion: "Wedding",
  event_date: "2027-11-14",
  town: "Hartbeespoort",
  estimate: "R 18 500",
  message: "Hi, I'd love to book.",
  details: [{ label: "Bridesmaids", value: "3" }],
  status: "new",
  notes: null,
  contacted_at: null,
};

const getReq = async (path: string) =>
  new Request(`https://worker${path}`, { headers: { cookie: await authCookie() } });

// ── handleAdminEnquiries ──────────────────────────────────────────────────────

describe("handleAdminEnquiries", () => {
  it("redirects to login when unauthenticated", async () => {
    const f = vi.fn();
    const r = await handleAdminEnquiries(
      new Request("https://worker/api/admin/enquiries"),
      env,
      shell,
      f as unknown as typeof fetch,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("/api/admin/login");
    expect(f).not.toHaveBeenCalled();
  });

  it("renders the enquiries list with a row per enquiry", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([ENQUIRY]));
    const r = await handleAdminEnquiries(await getReq("/api/admin/enquiries"), env, shell, f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("Anke van der Berg");
    expect(body).toContain("anke@example.com");
    expect(body).toContain("R 18 500");
    expect(body).toContain("New");
  });

  it("renders empty state when no enquiries", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([]));
    const r = await handleAdminEnquiries(await getReq("/api/admin/enquiries"), env, shell, f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("No enquiries");
  });

  it("passes status filter to query when ?status= provided", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([]));
    await handleAdminEnquiries(await getReq("/api/admin/enquiries?status=contacted"), env, shell, f as unknown as typeof fetch);
    const url = f.mock.calls[1]![0] as string;
    expect(url).toContain("status=eq.contacted");
  });

  it("shows status filter links", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([]));
    const r = await handleAdminEnquiries(await getReq("/api/admin/enquiries"), env, shell, f as unknown as typeof fetch);
    const body = await r.text();
    expect(body).toContain("/api/admin/enquiries?status=new");
    expect(body).toContain("/api/admin/enquiries?status=converted");
  });
});

// ── handleAdminEnquiryDetail ──────────────────────────────────────────────────

describe("handleAdminEnquiryDetail", () => {
  it("redirects to login when unauthenticated", async () => {
    const f = vi.fn();
    const r = await handleAdminEnquiryDetail(
      new Request("https://worker/api/admin/enquiries/aaaa-1111"),
      env, shell, "aaaa-1111", f as unknown as typeof fetch,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders enquiry detail with all fields", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([ENQUIRY]));
    const r = await handleAdminEnquiryDetail(await getReq("/api/admin/enquiries/aaaa-1111"), env, shell, "aaaa-1111", f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("Anke van der Berg");
    expect(body).toContain("anke@example.com");
    expect(body).toContain("0671234567");
    expect(body).toContain("Hartbeespoort");
    expect(body).toContain("Hi, I&#39;d love to book.");
    expect(body).toContain("Bridesmaids");
    expect(body).toContain("status");
    expect(body).toContain("Notes");
  });

  it("shows 404 when enquiry not found", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([]));
    const r = await handleAdminEnquiryDetail(await getReq("/api/admin/enquiries/missing"), env, shell, "missing", f as unknown as typeof fetch);
    expect(r.status).toBe(404);
  });

  it("shows saved banner when ?saved=1", async () => {
    const f = vi.fn().mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([ENQUIRY]));
    const r = await handleAdminEnquiryDetail(await getReq("/api/admin/enquiries/aaaa-1111?saved=1"), env, shell, "aaaa-1111", f as unknown as typeof fetch);
    const body = await r.text();
    expect(body).toContain("Saved.");
  });
});

// ── handleAdminUpdateEnquiry ──────────────────────────────────────────────────

describe("handleAdminUpdateEnquiry", () => {
  const postReq = async (path: string, formBody: Record<string, string>) => {
    const form = new URLSearchParams(formBody).toString();
    return new Request(`https://worker${path}`, {
      method: "POST",
      headers: { cookie: await authCookie(), "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
  };

  it("redirects to login when unauthenticated", async () => {
    const f = vi.fn();
    const r = await handleAdminUpdateEnquiry(
      new Request("https://worker/api/admin/enquiries/aaaa-1111", { method: "POST" }),
      env, "aaaa-1111", f as unknown as typeof fetch,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("/api/admin/login");
  });

  it("PATCHes status and notes, redirects with ?saved=1", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(profileRes())     // getAdminSession → profiles
      .mockResolvedValueOnce(res([ENQUIRY]))   // getEnquiryById
      .mockResolvedValueOnce(new Response(null, { status: 204 }));  // updateEnquiry PATCH
    const r = await handleAdminUpdateEnquiry(
      await postReq("/api/admin/enquiries/aaaa-1111", { status: "contacted", notes: "Called, left voicemail." }),
      env, "aaaa-1111", f as unknown as typeof fetch,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("?saved=1");
    const patchBody = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(patchBody.status).toBe("contacted");
    expect(patchBody.notes).toBe("Called, left voicemail.");
  });

  it("sets contacted_at when transitioning from 'new' for the first time", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(profileRes())
      .mockResolvedValueOnce(res([{ ...ENQUIRY, status: "new", contacted_at: null }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));  // updateEnquiry PATCH
    await handleAdminUpdateEnquiry(
      await postReq("/api/admin/enquiries/aaaa-1111", { status: "contacted", notes: "" }),
      env, "aaaa-1111", f as unknown as typeof fetch,
    );
    const patchBody = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(patchBody.contacted_at).toBeTruthy();
  });

  it("does not overwrite contacted_at when already set", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(profileRes())
      .mockResolvedValueOnce(res([{ ...ENQUIRY, status: "contacted", contacted_at: "2026-06-20T10:00:00Z" }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));  // updateEnquiry PATCH
    await handleAdminUpdateEnquiry(
      await postReq("/api/admin/enquiries/aaaa-1111", { status: "converted", notes: "Booked!" }),
      env, "aaaa-1111", f as unknown as typeof fetch,
    );
    const patchBody = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(patchBody.contacted_at).toBeUndefined();
  });

  it("rejects invalid status values and redirects without PATCH", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(profileRes())
      .mockResolvedValueOnce(res([ENQUIRY]));
    const r = await handleAdminUpdateEnquiry(
      await postReq("/api/admin/enquiries/aaaa-1111", { status: "hacked", notes: "" }),
      env, "aaaa-1111", f as unknown as typeof fetch,
    );
    expect(r.status).toBe(302);
    expect(f).toHaveBeenCalledTimes(2); // profiles + getEnquiryById, no PATCH
  });
});
