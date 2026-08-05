// worker/src/booking/command-center.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleAdminCommand, handleAdminCommandBulk, handleAdminCommandApprove } from "./command-center";
import { AUTH_COOKIE } from "./auth";

const SEC = "test-jwt-secret-at-least-32-chars-long!!";
function b64(b: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function jwt(p: any): Promise<string> {
  const h = b64(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const b = b64(new TextEncoder().encode(JSON.stringify(p)));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEC), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`));
  return `${h}.${b}.${b64(s)}`;
}

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_KEY: "svc",
  SUPABASE_JWT_SECRET: SEC,
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
} as any;

function mkFetch(rows: { enquiries: any[]; bookings: any[]; approvals: any[]; patches: any[] }) {
  const f = vi.fn().mockImplementation(async (url: string, opts?: any) => {
    const u = String(url);
    const m = (opts?.method ?? "GET").toUpperCase();
    if (u.includes("/auth/v1/user")) return { ok: true, status: 200, text: async () => JSON.stringify({ id: "aaaaaaaa-0000-0000-0000-000000000001", email: "z@l.co.za" }), json: async () => ({ id: "1", email: "z" }) };
    if (u.includes("/rest/v1/profiles")) return { ok: true, status: 200, text: async () => JSON.stringify([{ role: "admin", full_name: "Z" }]), json: async () => ([{ role: "admin" }]) };
    if (m === "PATCH") { rows.patches.push({ url: u, body: JSON.parse(opts.body) }); return { ok: true, status: 204, text: async () => "", json: async () => [] }; }
    if (u.includes("/rest/v1/enquiries") && u.includes("select=status")) return r200([{ status: "new" }]);
    if (u.includes("/rest/v1/bookings") && u.includes("select=status")) return r200([{ status: "requested" }]);
    if (u.includes("/rest/v1/notifications") && u.includes("approval_needed")) return r200(rows.approvals);
    if (u.includes("/rest/v1/enquiries?")) return r200(rows.enquiries);
    if (u.includes("/rest/v1/bookings?")) return r200(rows.bookings);
    if (u.includes("/rest/v1/notifications?")) return r200(rows.approvals);
    return r200([]);
  });
  return f;
}
const r200 = (body: any) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

const cookie = (tok: string) => ({ "Cookie": `${AUTH_COOKIE}=${tok}` });

describe("GET /api/admin/command", () => {
  it("renders the command center with KPI tiles + stages + no inline style= strings", async () => {
    const tok = await jwt({ sub: "1", email: "z@l.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
    const f = mkFetch({ enquiries: [{ id: "e1", name: "Amy", status: "new", created_at: new Date(Date.now() - 3600000).toISOString() }], bookings: [{ id: "b1", bride_name: "Bea", status: "requested", created_at: new Date().toISOString(), total_cents: 100000, deposit_net_cents: 0, balance_net_cents: 100000, wedding_date: "2027-01-01" }], approvals: [], patches: [] });
    const res = await handleAdminCommand(new Request("https://w/api/admin/command", { headers: cookie(tok) }), env, f);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Command Center");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Collected");
    expect(html).toContain("Overdue");
    expect(html).toContain("At risk");
    expect(html).toContain("New leads");
    expect(html).toContain("Awaiting quote");
    // hard requirement: zero inline style= in the markup
    expect(html).not.toContain("style=");
  });

  it("redirects to login when unauthenticated", async () => {
    const f = mkFetch({ enquiries: [], bookings: [], approvals: [], patches: [] });
    const res = await handleAdminCommand(new Request("https://w/api/admin/command"), env, f);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("login");
  });
});

describe("POST /api/admin/command/bulk", () => {
  it("advances a booking one stage and stamps the timestamp", async () => {
    const tok = await jwt({ sub: "1", email: "z@l.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
    const rows = { enquiries: [], bookings: [], approvals: [], patches: [] as any[] };
    const f = mkFetch(rows);
    const fd = new URLSearchParams({ action: "advance", ids: "booking:bbbbbbbb-0000-0000-0000-000000000002" });
    const res = await handleAdminCommandBulk(new Request("https://w/api/admin/command/bulk", { method: "POST", headers: { ...cookie(tok), "content-type": "application/x-www-form-urlencoded" }, body: fd.toString() }), env, f);
    expect(res.status).toBe(302);
    const patch = rows.patches.find((p) => p.url.includes("bookings?"));
    expect(patch?.body.status).toBe("quote_sent");
  });

  it("soft-deletes an enquiry on delete", async () => {
    const tok = await jwt({ sub: "1", email: "z@l.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
    const rows = { enquiries: [], bookings: [], approvals: [], patches: [] as any[] };
    const f = mkFetch(rows);
    const fd = new URLSearchParams({ action: "delete", ids: "enquiry:cccccccc-0000-0000-0000-000000000003" });
    await handleAdminCommandBulk(new Request("https://w/api/admin/command/bulk", { method: "POST", headers: { ...cookie(tok), "content-type": "application/x-www-form-urlencoded" }, body: fd.toString() }), env, f);
    const patch = rows.patches.find((p) => p.url.includes("enquiries?"));
    expect(patch?.body.deleted_at).toBeTruthy();
  });
});

describe("POST /api/admin/command/approve", () => {
  it("executes the queued action then marks the approval done", async () => {
    const tok = await jwt({ sub: "1", email: "z@l.co.za", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
    const rows = { enquiries: [], bookings: [], approvals: [], patches: [] as any[] };
    const f = mkFetch(rows);
    const fd = new URLSearchParams({ id: "aaaaaaaa-0000-0000-0000-000000000099" });
    await handleAdminCommandApprove(new Request("https://w/api/admin/command/approve", { method: "POST", headers: { ...cookie(tok), "content-type": "application/x-www-form-urlencoded" }, body: fd.toString() }), env, f);
    // The approval notification is PATCHed to approval_done
    const patch = rows.patches.find((p) => p.url.includes("notifications?") && p.body.type === "approval_done");
    expect(patch).toBeTruthy();
  });
});
