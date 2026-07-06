// worker/src/booking/contract.test.ts — Client Agreement page + signature hashing
import { describe, it, expect, vi } from "vitest";
import { renderContractPageHandler, contractBodyText, sha256Hex, CONTRACT_VERSION } from "./contract";
import { signActionToken } from "./token";

const SECRET = "test-signing-secret";

function makeEnv() {
  return {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_KEY: "svc-key",
    SIGNING_SECRET: SECRET,
  };
}

const BOOKING = {
  id: "b-123",
  reference: "LQ-0001",
  status: "quote_sent",
  bride_name: "Leila Smith",
  bride_email: "leila@example.com",
  wedding_date: "2026-09-15",
  venue: "Red Ivory Estate",
  town: "Hartbeespoort",
  province: "North West",
  party_size: 4,
  total_cents: 500000,
  deposit_pct: null,
  deposit_net_cents: 0,
  balance_net_cents: 0,
  confirm_token_expires_at: "2026-07-01T00:00:00Z",
  confirm_token_used_at: null,
  wave_customer_id: null,
  wave_invoice_id: null,
  quote_sent_at: "2026-06-01T00:00:00Z",
  accepted_at: null,
  quote_lines: null,
};

function validToken(): Promise<string> {
  return signActionToken(BOOKING.id, new Date(Date.now() + 1000 * 60 * 60), SECRET, "invoice");
}

function get(token: string): Request {
  return new Request(`https://worker.dev/api/booking/contract?token=${encodeURIComponent(token)}`);
}

function makeDbFetch(booking = BOOKING): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => [booking] }) as unknown as typeof fetch;
}

describe("renderContractPageHandler", () => {
  it("400 with no token", async () => {
    const r = await renderContractPageHandler(makeEnv(), new Request("https://worker.dev/api/booking/contract"));
    expect(r.status).toBe(400);
  });

  it("400 for invalid token", async () => {
    const r = await renderContractPageHandler(makeEnv(), get("bad-token"), makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("404 when booking not found", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    const r = await renderContractPageHandler(makeEnv(), get(await validToken()), f);
    expect(r.status).toBe(404);
  });

  it("renders the client name and reference into the page", async () => {
    const r = await renderContractPageHandler(makeEnv(), get(await validToken()), makeDbFetch());
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Leila Smith");
    expect(html).toContain("LQ-0001");
    expect(html).toContain("Client Agreement");
  });
});

describe("contractBodyText / sha256Hex", () => {
  it("includes the chosen booking fee percentage once selected", () => {
    const text = contractBodyText({ ...BOOKING, deposit_pct: 50 });
    expect(text).toContain("50%");
    expect(text).toContain(CONTRACT_VERSION);
  });

  it("names all three options before a percentage is chosen", () => {
    const text = contractBodyText({ ...BOOKING, deposit_pct: null });
    expect(text).toContain("25%, 50%, or 100%");
  });

  it("hashes deterministically for identical input", async () => {
    const text = contractBodyText({ ...BOOKING, deposit_pct: 25 });
    const h1 = await sha256Hex(text);
    const h2 = await sha256Hex(text);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("hashes differently when the booking fee changes", async () => {
    const h25 = await sha256Hex(contractBodyText({ ...BOOKING, deposit_pct: 25 }));
    const h50 = await sha256Hex(contractBodyText({ ...BOOKING, deposit_pct: 50 }));
    expect(h25).not.toBe(h50);
  });
});
