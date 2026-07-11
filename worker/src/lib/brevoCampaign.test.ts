import { describe, it, expect, vi } from "vitest";
import { upsertBrevoContact, createAndSendCampaign } from "./brevoCampaign";

const env = { BREVO_API_KEY: "brevo-key" };

describe("upsertBrevoContact", () => {
  it("POSTs to /v3/contacts with the email, listId, and updateEnabled", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 201 }));
    await upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    expect((init as RequestInit & { headers: Record<string, string> }).headers["api-key"]).toBe("brevo-key");
    expect(JSON.parse(init.body as string)).toEqual({ email: "bride@example.com", listIds: [42], updateEnabled: true });
  });

  it("treats 204 (already exists) as success", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("throws on a non-2xx, non-204 response", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    await expect(upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch)).rejects.toThrow(/400/);
  });
});

describe("createAndSendCampaign", () => {
  it("creates the campaign then sends it, returning the campaign id", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await createAndSendCampaign(
      env,
      { subject: "A summer offer", htmlContent: "<p>hi</p>", listId: 42, senderEmail: "info@lustiqueco.co.za" },
      f as unknown as typeof fetch,
    );

    expect(result).toEqual({ id: 7 });
    expect(f).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = f.mock.calls[0]!;
    expect(createUrl).toBe("https://api.brevo.com/v3/emailCampaigns");
    const createBody = JSON.parse((createInit as RequestInit).body as string);
    expect(createBody.subject).toBe("A summer offer");
    expect(createBody.recipients).toEqual({ listIds: [42] });
    const [sendUrl] = f.mock.calls[1]!;
    expect(sendUrl).toBe("https://api.brevo.com/v3/emailCampaigns/7/sendNow");
  });

  it("throws if campaign creation fails, without attempting to send", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(createAndSendCampaign(
      env, { subject: "x", htmlContent: "<p/>", listId: 1, senderEmail: "a@b.com" }, f as unknown as typeof fetch,
    )).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledOnce();
  });

  it("throws if send fails after successful creation", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 9 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("send failed", { status: 500 }));
    await expect(createAndSendCampaign(
      env, { subject: "x", htmlContent: "<p/>", listId: 1, senderEmail: "a@b.com" }, f as unknown as typeof fetch,
    )).rejects.toThrow(/500/);
  });
});
