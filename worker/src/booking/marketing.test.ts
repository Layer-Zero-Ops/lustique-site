import { describe, it, expect, vi } from "vitest";
import { handleAdminMarketing, handleAdminMarketingSyncPastClients } from "./marketing";
import { AUTH_COOKIE } from "./auth";

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: "test-secret",
  BREVO_API_KEY: "brevo-key",
  BREVO_NEWSLETTER_LIST_ID: "10",
  BREVO_PAST_CLIENTS_LIST_ID: "20",
  NOTIFY_EMAIL: "info@lustiqueco.co.za",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const shell = (title: string, _user: unknown, inner: string) => `<html><title>${title}</title>${inner}</html>`;

function authedGet(path = "https://x/api/admin/marketing") {
  return new Request(path, { headers: { Cookie: `${AUTH_COOKIE}=tok` } });
}
function authedPost(body: URLSearchParams, path = "https://x/api/admin/marketing") {
  return new Request(path, {
    method: "POST",
    headers: { Cookie: `${AUTH_COOKIE}=tok`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}
function authOkResponses() {
  return [
    new Response(JSON.stringify({ id: "u1", email: "zandeline@lustiqueco.co.za" }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify([{ role: "admin", full_name: "Zandeline" }]), { status: 200, headers: { "content-type": "application/json" } }),
  ] as const;
}

describe("handleAdminMarketing — GET", () => {
  it("redirects to login when there's no session", async () => {
    const f = vi.fn();
    const res = await handleAdminMarketing(new Request("https://x/api/admin/marketing"), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders the form with audience options and the promo dropdown", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const res = await handleAdminMarketing(authedGet(), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("Newsletter");
    expect(html).toContain("Past clients");
    expect(html).toContain("Weekday Wonders"); // a PROMO_PRESETS name, confirming the dropdown is populated
  });
});

describe("handleAdminMarketing — POST intent=preview", () => {
  it("re-renders the form with a rendered preview and a Send Now button, without calling Brevo", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const body = new URLSearchParams({
      intent: "preview", audience: "newsletter", subject: "Test subject",
      headline: "Test headline", bodyText: "Paragraph one.", ctaLabel: "Go", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("Test headline");
    expect(html).toContain("Send Now");
    expect(f).toHaveBeenCalledTimes(2); // only the two auth calls — no Brevo call yet
  });
});

describe("handleAdminMarketing — POST intent=send", () => {
  it("builds the email, sends via Brevo Campaign API to the newsletter list, and audits", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 55 }), { status: 201, headers: { "content-type": "application/json" } })) // campaign create
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // campaign sendNow
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // writeAudit's insertAudit

    const body = new URLSearchParams({
      intent: "send", audience: "newsletter", subject: "Test subject",
      headline: "Test headline", bodyText: "Paragraph one.", ctaLabel: "Go", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("sent=1");
    const campaignCreateCall = f.mock.calls.find(([url]) => url === "https://api.brevo.com/v3/emailCampaigns");
    expect(campaignCreateCall).toBeTruthy();
    const [, createInit] = campaignCreateCall!;
    const createBody = JSON.parse(createInit!.body as string);
    expect(createBody.recipients).toEqual({ listIds: [10] }); // BREVO_NEWSLETTER_LIST_ID from env
  });

  it("targets the past-clients list id when audience=past-clients", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 56 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const body = new URLSearchParams({
      intent: "send", audience: "past-clients", subject: "Refer a friend",
      headline: "Bring your bestie", bodyText: "Refer a friend and you both save.", ctaLabel: "Refer now", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    const campaignCreateCall = f.mock.calls.find(([url]) => url === "https://api.brevo.com/v3/emailCampaigns");
    const [, createInit] = campaignCreateCall!;
    expect(JSON.parse(createInit!.body as string).recipients).toEqual({ listIds: [20] });
  });

  it("surfaces a Brevo failure as a visible error, not a silent redirect", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response("Brevo down", { status: 500 }));
    const body = new URLSearchParams({
      intent: "send", audience: "newsletter", subject: "x", headline: "x", bodyText: "x", ctaLabel: "x", ctaHref: "https://a.com",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(res.status).toBe(200); // re-renders the form with an error, doesn't redirect as if it succeeded
    expect(html.toLowerCase()).toContain("error");
  });

  it("rejects an empty required field with a 400-equivalent re-render, no Brevo call", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const body = new URLSearchParams({ intent: "send", audience: "newsletter", subject: "", headline: "", bodyText: "", ctaLabel: "", ctaHref: "" });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("required");
    expect(f).toHaveBeenCalledTimes(2); // only auth — never reached Brevo
  });
});

describe("handleAdminMarketingSyncPastClients", () => {
  it("upserts every settled booking's bride email into the past-clients list", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { bride_email: "a@example.com", bride_name: "A" },
        { bride_email: "b@example.com", bride_name: "B" },
      ]), { status: 200, headers: { "content-type": "application/json" } })) // listSettledBookingEmails
      .mockResolvedValueOnce(new Response(null, { status: 201 })) // upsert a
      .mockResolvedValueOnce(new Response(null, { status: 201 })); // upsert b

    const req = new Request("https://x/api/admin/marketing/sync-past-clients", { method: "POST", headers: { Cookie: `${AUTH_COOKIE}=tok` } });
    const res = await handleAdminMarketingSyncPastClients(req, env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    const contactCalls = f.mock.calls.filter(([url]) => url === "https://api.brevo.com/v3/contacts");
    expect(contactCalls).toHaveLength(2);
  });
});
