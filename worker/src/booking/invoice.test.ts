// worker/src/booking/invoice.test.ts — S9 invoice page + reject handler + TASK-D pay handler
import { describe, it, expect, vi } from "vitest";
import { renderInvoicePage, handleInvoiceReject, handleInvoicePay } from "./invoice";
import { signActionToken } from "./token";

const SECRET = "test-signing-secret";

function makeEnv() {
  return {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_KEY: "svc-key",
    SIGNING_SECRET: SECRET,
    BREVO_API_KEY: "brevo-key",
    NOTIFY_EMAIL: "info@lustiqueco.co.za",
    AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
  };
}

const BOOKING = {
  id: "b-123",
  reference: "LQ-0001",
  status: "confirmed",
  bride_name: "Leila Smith",
  bride_email: "leila@example.com",
  wedding_date: "2026-09-15",
  venue: "Red Ivory Estate",
  town: "Hartbeespoort",
  province: "North West",
  party_size: 4,
  total_cents: 500000,
  deposit_pct: 50,
  deposit_net_cents: 250000,
  balance_net_cents: 250000,
  confirm_token_expires_at: "2026-07-01T00:00:00Z",
  confirm_token_used_at: null,
  wave_customer_id: null,
  wave_invoice_id: null,
  quote_lines: [
    { label: "Bridal hair", amount: 3000 },
    { label: "Bridal makeup", amount: 2000 },
  ],
};

const EFT_ROWS = [
  { key: "eft_bank_name", value: "FNB" },
  { key: "eft_account_holder", value: "Lustique Co." },
  { key: "eft_account_number", value: "62123456789" },
  { key: "eft_branch_code", value: "250655" },
];

function makeDbFetch(booking = BOOKING, eftRows = EFT_ROWS): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("business_settings")) {
      return { ok: true, json: async () => eftRows };
    }
    return { ok: true, json: async () => [booking] };
  }) as unknown as typeof fetch;
}

async function validToken(bookingId = "b-123"): Promise<string> {
  const ttl = 2 * 365 * 24 * 60 * 60 * 1000;
  return signActionToken(bookingId, new Date(Date.now() + ttl), SECRET, "invoice");
}

function get(token: string): Request {
  return new Request(`https://worker.dev/api/booking/invoice?token=${encodeURIComponent(token)}`);
}

// ── token validation ──────────────────────────────────────────────────────────

describe("token validation", () => {
  it("returns 400 with no token", async () => {
    const r = await renderInvoicePage(makeEnv(), new Request("https://worker.dev/api/booking/invoice"), makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("returns 400 for a tampered token", async () => {
    const r = await renderInvoicePage(makeEnv(), get("bad-token"), makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("returns 400 for a token with wrong action", async () => {
    const wrongAction = await signActionToken("b-123", new Date(Date.now() + 99999999), SECRET, "deposit");
    const r = await renderInvoicePage(makeEnv(), get(wrongAction), makeDbFetch());
    expect(r.status).toBe(400);
  });

  it("returns 404 when booking not found", async () => {
    const notFound = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), notFound);
    expect(r.status).toBe(404);
  });
});

// ── invoice content ───────────────────────────────────────────────────────────

describe("invoice content", () => {
  it("returns 200 with HTML content-type", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it("renders the booking reference", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    expect(await r.text()).toContain("LQ-0001");
  });

  it("renders the bride's name", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    expect(await r.text()).toContain("Leila Smith");
  });

  it("renders the wedding date and venue", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("15 September 2026");
    expect(html).toContain("Red Ivory Estate");
  });

  it("renders quote line items", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("Bridal hair");
    expect(html).toContain("Bridal makeup");
  });

  it("renders EFT bank details from business_settings", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    const html = await r.text();
    expect(html).toContain("FNB");
    expect(html).toContain("62123456789");
  });

  it("renders 'Awaiting deposit' badge for confirmed status", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    expect(await r.text()).toContain("Awaiting deposit");
  });

  it("renders 'Deposit received' badge for deposit_paid status", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "deposit_paid" });
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    expect(await r.text()).toContain("Deposit received");
  });

  it("renders 'Fully paid' badge for settled status", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "settled" });
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    expect(await r.text()).toContain("Fully paid");
  });

  it("renders a fallback service line when quote_lines is empty", async () => {
    const f = makeDbFetch({ ...BOOKING, quote_lines: [] });
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    expect(await r.text()).toContain("Wedding hair");
  });

  it("is private and not cacheable", async () => {
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), makeDbFetch());
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("still renders if EFT settings fetch fails", async () => {
    const f = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("business_settings")) return { ok: false, status: 500 };
      return { ok: true, json: async () => [BOOKING] };
    }) as unknown as typeof fetch;
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    expect(r.status).toBe(200);
  });

  it("shows accept/reject buttons for quote_sent status", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "quote_sent" });
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    const html = await r.text();
    expect(html).toContain("acceptBtn");
    expect(html).toContain("rejectBtn");
  });

  it("hides accept/reject buttons when booking is already paid", async () => {
    const f = makeDbFetch({ ...BOOKING, status: "deposit_paid" });
    const r = await renderInvoicePage(makeEnv(), get(await validToken()), f);
    const html = await r.text();
    expect(html).not.toContain("acceptBtn");
    expect(html).not.toContain("rejectBtn");
  });
});

// ── handleInvoiceReject ───────────────────────────────────────────────────────

function postReject(token: string, reason = ""): Request {
  const body = new URLSearchParams({ reason });
  return new Request(
    `https://worker.dev/api/booking/invoice/reject?token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
  );
}

function makeRejectFetch(status = "quote_sent", extra: Partial<typeof BOOKING> = {}): typeof fetch {
  const f = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [{ ...BOOKING, status, ...extra }] })  // getBookingByIdForInvoice
    .mockResolvedValueOnce({ ok: true, json: async () => [{ ...BOOKING, status: "rejected", ...extra }] }) // transitionBooking
    .mockResolvedValue({ ok: true, json: async () => ({}) }); // rejections insert, notification, email, audit
  return f as unknown as typeof fetch;
}

describe("handleInvoiceReject", () => {
  it("returns 400 with no token", async () => {
    const r = await handleInvoiceReject(
      makeEnv(),
      new Request("https://worker.dev/api/booking/invoice/reject", { method: "POST" }),
    );
    expect(r.status).toBe(400);
  });

  it("returns 400 for a tampered token", async () => {
    const r = await handleInvoiceReject(makeEnv(), postReject("bad-token"), makeRejectFetch());
    expect(r.status).toBe(400);
  });

  it("returns 200 ok:true when booking is already rejected (already handled)", async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [{ ...BOOKING, status: "rejected" }] }) as unknown as typeof fetch;
    const r = await handleInvoiceReject(makeEnv(), postReject(await validToken()), f);
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; already?: boolean };
    expect(body.ok).toBe(true);
    expect(body.already).toBe(true);
  });

  it("transitions quote_sent → rejected and returns 200", async () => {
    const f = makeRejectFetch("quote_sent");
    const r = await handleInvoiceReject(makeEnv(), postReject(await validToken(), "Too expensive"), f);
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    // Verify transitionBooking PATCH hit quote_sent guard
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("status=eq.quote_sent"))).toBe(true);
  });

  it("inserts a rejections row with reason_text", async () => {
    const f = makeRejectFetch("quote_sent");
    await handleInvoiceReject(makeEnv(), postReject(await validToken(), "Budget changed"), f);
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls;
    const rejectionCall = calls.find((c) => (c[0] as string).includes("/rejections"));
    expect(rejectionCall).toBeTruthy();
    const body = JSON.parse((rejectionCall![1] as RequestInit).body as string);
    expect(body.rejected_by).toBe("bride");
    expect(body.reason_text).toBe("Budget changed");
  });

  it("405 on GET", async () => {
    const r = await handleInvoiceReject(
      makeEnv(),
      new Request("https://worker.dev/api/booking/invoice/reject", { method: "GET" }),
    );
    expect(r.status).toBe(405);
  });
});

// ── handleInvoicePay ──────────────────────────────────────────────────────────

function makePayEnv() {
  return {
    ...makeEnv(),
    YOCO_SECRET_KEY: "sk_test_abc",
    ALLOWED_ORIGIN: "https://lustiqueco.co.za",
  };
}

const QUOTE_SENT_BOOKING = { ...BOOKING, status: "quote_sent" };

function postPay(token: string, depositPct: number, extra: Record<string, unknown> = {}): Request {
  return new Request(
    `https://worker.dev/api/booking/invoice/pay?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ depositPct, ...extra }),
    },
  );
}

function makePayFetch(
  booking = QUOTE_SENT_BOOKING,
  yocoOk = true,
): typeof fetch {
  const yocoResp = yocoOk
    ? { ok: true, json: async () => ({ id: "chk_123", redirectUrl: "https://pay.yoco.com/chk_123" }), text: async () => "" }
    : { ok: false, status: 500, text: async () => "Yoco error" };
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("business_settings")) {
      return { ok: true, json: async () => EFT_ROWS };
    }
    if (String(url).includes("payments.yoco.com")) return yocoResp;
    if (String(url).includes("/bookings?id=") && String(url).includes("status=eq.quote_sent")) {
      // transitionBooking PATCH — returns updated row
      return { ok: true, json: async () => [{ ...booking, status: "accepted" }] };
    }
    if (String(url).includes("/bookings")) {
      return { ok: true, json: async () => [booking] };
    }
    // payments insert, audit
    return { ok: true, json: async () => [{ id: "pay-1" }] };
  }) as unknown as typeof fetch;
}

function makePayFetchContractEnabled(booking = QUOTE_SENT_BOOKING): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("business_settings")) {
      return { ok: true, json: async () => [{ key: "contract_enabled", value: "true" }] };
    }
    if (String(url).includes("payments.yoco.com")) {
      return { ok: true, json: async () => ({ id: "chk_123", redirectUrl: "https://pay.yoco.com/chk_123" }) };
    }
    if (String(url).includes("/bookings?id=") && String(url).includes("status=eq.quote_sent")) {
      return { ok: true, json: async () => [{ ...booking, status: "accepted" }] };
    }
    if (String(url).includes("/bookings")) {
      return { ok: true, json: async () => [booking] };
    }
    return { ok: true, json: async () => [{ id: "pay-1" }] };
  }) as unknown as typeof fetch;
}

describe("handleInvoicePay", () => {
  it("405 on GET", async () => {
    const r = await handleInvoicePay(
      makePayEnv(),
      new Request("https://worker.dev/api/booking/invoice/pay", { method: "GET" }),
    );
    expect(r.status).toBe(405);
  });

  it("400 with no token", async () => {
    const r = await handleInvoicePay(
      makePayEnv(),
      new Request("https://worker.dev/api/booking/invoice/pay", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { ok: boolean; error: string };
    expect(body.error).toBe("missing_token");
  });

  it("400 for invalid token", async () => {
    const r = await handleInvoicePay(makePayEnv(), postPay("bad-token", 25), makePayFetch());
    expect(r.status).toBe(400);
    const body = await r.json() as { ok: boolean; error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("400 for invalid depositPct", async () => {
    const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 33), makePayFetch());
    expect(r.status).toBe(400);
    const body = await r.json() as { ok: boolean; error: string };
    expect(body.error).toBe("invalid_deposit_pct");
  });

  it("409 when booking is not quote_sent", async () => {
    const f = makePayFetch({ ...BOOKING, status: "accepted" });
    const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25), f);
    expect(r.status).toBe(409);
    const body = await r.json() as { ok: boolean; already_handled: boolean };
    expect(body.already_handled).toBe(true);
  });

  it("returns checkoutUrl on success", async () => {
    const f = makePayFetch();
    const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25), f);
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; checkoutUrl: string };
    expect(body.ok).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.yoco.com/chk_123");
  });

  it("transitions booking with correct deposit amounts for 50%", async () => {
    const f = makePayFetch();
    await handleInvoicePay(makePayEnv(), postPay(await validToken(), 50), f);
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls;
    const transitionCall = calls.find((c) =>
      (c[0] as string).includes("status=eq.quote_sent"),
    );
    expect(transitionCall).toBeTruthy();
    const patch = JSON.parse((transitionCall![1] as RequestInit).body as string);
    expect(patch.status).toBe("accepted");
    expect(patch.deposit_pct).toBe(50);
    expect(patch.deposit_net_cents).toBe(250000); // 50% of 500000
    expect(patch.balance_net_cents).toBe(250000);
  });

  it("inserts a payment row with the checkout id", async () => {
    const f = makePayFetch();
    await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25), f);
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls;
    const paymentCall = calls.find((c) => (c[0] as string).includes("/rest/v1/payments"));
    expect(paymentCall).toBeTruthy();
    const body = JSON.parse((paymentCall![1] as RequestInit).body as string);
    expect(body.kind).toBe("deposit");
    expect(body.yoco_checkout_id).toBe("chk_123");
    expect(body.status).toBe("pending");
  });

  it("returns eftOnly when Yoco checkout fails", async () => {
    const f = makePayFetch(QUOTE_SENT_BOOKING, false);
    const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25), f);
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; eftOnly: boolean; eft: { bank: string; reference: string } };
    expect(body.ok).toBe(true);
    expect(body.eftOnly).toBe(true);
    expect(body.eft.bank).toBe("FNB");
    expect(body.eft.reference).toBe("LQ-0001");
  });

  describe("contract signature gate (contract_enabled=true)", () => {
    it("400 contract_not_signed when checkbox not agreed", async () => {
      const f = makePayFetchContractEnabled();
      const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25, { signerName: "Jane Bride", agreedToContract: false }), f);
      expect(r.status).toBe(400);
      const body = await r.json() as { ok: boolean; error: string };
      expect(body.error).toBe("contract_not_signed");
    });

    it("400 contract_not_signed when signerName missing", async () => {
      const f = makePayFetchContractEnabled();
      const r = await handleInvoicePay(makePayEnv(), postPay(await validToken(), 25, { agreedToContract: true }), f);
      expect(r.status).toBe(400);
      const body = await r.json() as { ok: boolean; error: string };
      expect(body.error).toBe("contract_not_signed");
    });

    it("succeeds and records signature fields when name + checkbox provided", async () => {
      const f = makePayFetchContractEnabled();
      const r = await handleInvoicePay(
        makePayEnv(),
        postPay(await validToken(), 25, { signerName: "Jane Bride", agreedToContract: true }),
        f,
      );
      expect(r.status).toBe(200);
      const calls = (f as ReturnType<typeof vi.fn>).mock.calls;
      const transitionCall = calls.find((c) => (c[0] as string).includes("status=eq.quote_sent"));
      expect(transitionCall).toBeTruthy();
      const patch = JSON.parse((transitionCall![1] as RequestInit).body as string);
      expect(patch.contract_signer_name).toBe("Jane Bride");
      expect(patch.contract_signed_at).toBeTruthy();
      expect(typeof patch.contract_content_hash).toBe("string");
      expect(patch.contract_content_hash).toHaveLength(64); // sha256 hex
      expect(patch.contract_version).toBeTruthy();
    });
  });
});
