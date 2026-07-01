import { describe, it, expect, vi } from "vitest";
import { handleAdminPromos, handlePublicActivePromo } from "./promos";
import { AUTH_COOKIE } from "./auth";

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: "test-secret",
};

const shell = (title: string, _user: unknown, inner: string) => `<html><title>${title}</title>${inner}</html>`;

function authedGet(path = "https://x/api/admin/promos") {
  return new Request(path, { headers: { Cookie: `${AUTH_COOKIE}=tok` } });
}
function authedPost(body: URLSearchParams, path = "https://x/api/admin/promos") {
  return new Request(path, {
    method: "POST",
    headers: { Cookie: `${AUTH_COOKIE}=tok`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

// Fresh Response objects per call — a Response body can only be read once, and these
// mocks get consumed across several tests, so a shared instance would break the 2nd+ test.
function authOkResponses() {
  return [
    new Response(JSON.stringify({ id: "u1", email: "zandeline@lustiqueco.co.za" }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify([{ role: "admin", full_name: "Zandeline" }]), { status: 200, headers: { "content-type": "application/json" } }),
  ] as const;
}

describe("handleAdminPromos — GET", () => {
  it("redirects to login when there's no session", async () => {
    const f = vi.fn();
    const res = await handleAdminPromos(new Request("https://x/api/admin/promos"), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders all 10 presets and reflects saved library/active state", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify([{ value: JSON.stringify(["cheapest-look-free", "flat-1000-off"]) }]), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ value: "flat-1000-off" }]), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handleAdminPromos(authedGet(), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Least-Expensive Look, On Us");
    expect(html).toContain("Bring Your Bestie"); // manual-only preset still listed
    expect(html).toContain('value="flat-1000-off" checked'); // active radio reflects saved state
  });
});

describe("handleAdminPromos — POST", () => {
  it("saves the library (capped at 5) and the active promo, then redirects", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValue(new Response("[]", { status: 201, headers: { "content-type": "application/json" } }));
    const body = new URLSearchParams();
    for (const id of ["cheapest-look-free", "flat-1000-off", "glam-squad-milestones", "weekday-wonders", "off-peak-season", "early-bird-bonus"]) {
      body.append("library", id);
    }
    body.set("active", "flat-1000-off");
    const res = await handleAdminPromos(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("saved=1");

    const savedLibrary = JSON.parse(findSettingWrite(f, "promo_library"));
    expect(savedLibrary).toHaveLength(5); // capped, not 6
  });

  it("falls back to 'none' if the chosen active promo isn't in the saved library", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValue(new Response("[]", { status: 201, headers: { "content-type": "application/json" } }));
    const body = new URLSearchParams();
    body.append("library", "cheapest-look-free");
    body.set("active", "flat-1000-off"); // not in the library above
    await handleAdminPromos(authedPost(body), env, shell, f as unknown as typeof fetch);

    expect(findSettingWrite(f, "active_promo_id")).toBe("none");
  });

  it("silently drops manual-only (non-live) preset ids from a submitted library", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValue(new Response("[]", { status: 201, headers: { "content-type": "application/json" } }));
    const body = new URLSearchParams();
    body.append("library", "cheapest-look-free");
    body.append("library", "bring-your-bestie"); // manual-only — must never enter the live library
    const res = await handleAdminPromos(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);

    const savedLibrary = JSON.parse(findSettingWrite(f, "promo_library"));
    expect(savedLibrary).toEqual(["cheapest-look-free"]);
  });
});

/** Find the value written for a given business_settings key across all fetch calls. */
function findSettingWrite(f: ReturnType<typeof vi.fn>, key: string): string {
  const call = f.mock.calls.find((c) => {
    try { return JSON.parse((c[1] as RequestInit).body as string).key === key; } catch { return false; }
  });
  if (!call) throw new Error(`no write found for key ${key}`);
  return JSON.parse((call[1] as RequestInit).body as string).value;
}

describe("handlePublicActivePromo", () => {
  it("returns { kind: none } when nothing is set", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handlePublicActivePromo(new Request("https://x/api/promo/active"), env, "https://lustiqueco.co.za", f as unknown as typeof fetch);
    const body = await res.json();
    expect(body).toEqual({ promo: { kind: "none" }, meta: null });
  });

  it("returns the live promo config + marketing meta when one is active", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ value: "flat-1000-off" }]), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handlePublicActivePromo(new Request("https://x/api/promo/active"), env, "https://lustiqueco.co.za", f as unknown as typeof fetch);
    const body = await res.json() as { promo: { kind: string }; meta: { id: string } | null };
    expect(body.promo).toEqual({ kind: "flatCreditOnMinParty", minPeople: 5, amount: 1000 });
    expect(body.meta?.id).toBe("flat-1000-off");
  });

  it("never exposes a manual-only preset as the live active promo, even if misconfigured", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ value: "bring-your-bestie" }]), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handlePublicActivePromo(new Request("https://x/api/promo/active"), env, "https://lustiqueco.co.za", f as unknown as typeof fetch);
    const body = await res.json();
    expect(body).toEqual({ promo: { kind: "none" }, meta: null });
  });

  it("falls back to none for an unknown/removed preset id", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ value: "some-retired-id" }]), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handlePublicActivePromo(new Request("https://x/api/promo/active"), env, "https://lustiqueco.co.za", f as unknown as typeof fetch);
    const body = await res.json();
    expect(body).toEqual({ promo: { kind: "none" }, meta: null });
  });
});
