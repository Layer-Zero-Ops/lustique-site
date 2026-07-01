import { describe, it, expect, vi } from "vitest";
import { handleVenueMatchLog, handleVenueMatchStats } from "./venueMatchLog";

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc", ADMIN_SECRET: "sekrit" };
const origin = "https://lustiqueco.co.za";

describe("handleVenueMatchLog", () => {
  it("inserts a valid outcome and returns 204", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    const req = new Request("https://x/api/venue-match-log", {
      method: "POST",
      body: JSON.stringify({ outcome: "directory-exact", typedText: "Avianto", matchedName: "Avianto Function Venue" }),
    });
    const res = await handleVenueMatchLog(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(204);
    expect(f).toHaveBeenCalledOnce();
    const [, init] = f.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ outcome: "directory-exact", typed_text: "Avianto", matched_name: "Avianto Function Venue" });
  });

  it("rejects an unknown outcome without calling the DB", async () => {
    const f = vi.fn();
    const req = new Request("https://x/api/venue-match-log", {
      method: "POST",
      body: JSON.stringify({ outcome: "made-up-outcome" }),
    });
    const res = await handleVenueMatchLog(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without throwing", async () => {
    const f = vi.fn();
    const req = new Request("https://x/api/venue-match-log", { method: "POST", body: "{not json" });
    const res = await handleVenueMatchLog(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("truncates overlong free-text fields rather than rejecting", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 201 }));
    const req = new Request("https://x/api/venue-match-log", {
      method: "POST",
      body: JSON.stringify({ outcome: "geocode-fail", typedText: "x".repeat(500) }),
    });
    const res = await handleVenueMatchLog(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(204);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect((body.typed_text as string).length).toBeLessThanOrEqual(200);
  });

  it("never throws when the DB insert fails — telemetry must not break the quote page", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const req = new Request("https://x/api/venue-match-log", {
      method: "POST",
      body: JSON.stringify({ outcome: "manual-pin" }),
    });
    const res = await handleVenueMatchLog(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(204);
  });
});

describe("handleVenueMatchStats", () => {
  it("rejects requests without a valid token", async () => {
    const f = vi.fn();
    const req = new Request("https://x/api/admin/venue-match-stats");
    const res = await handleVenueMatchStats(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("summarises counts per outcome for a valid token", async () => {
    const rows = [
      { outcome: "directory-exact" }, { outcome: "directory-exact" },
      { outcome: "geocode-fallback" }, { outcome: "manual-pin" },
    ];
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
    const req = new Request("https://x/api/admin/venue-match-stats?token=sekrit");
    const res = await handleVenueMatchStats(req, env, origin, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      total: 4,
      byOutcome: { "directory-exact": 2, "geocode-fallback": 1, "manual-pin": 1 },
    });
  });
});
