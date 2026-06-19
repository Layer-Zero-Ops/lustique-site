// worker/src/booking/wave.test.ts — S8 Wave API client tests
import { describe, it, expect, vi } from "vitest";
import { createCustomer, createInvoice, recordPayment } from "../lib/wave";
import type { WaveEnv } from "../lib/wave";

const ENV: WaveEnv = {
  WAVE_API_KEY: "test-key",
  WAVE_BUSINESS_ID: "biz-123",
  WAVE_PRODUCT_ID: "prod-456",
  WAVE_BANK_ACCOUNT_ID: "acct-789",
};

function makeGqlFetch(data: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(data),
    json: async () => ({ data }),
  }) as unknown as typeof fetch;
}

function makeErrorFetch(httpStatus: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: httpStatus,
    text: async () => "Internal Server Error",
  }) as unknown as typeof fetch;
}

// ── createCustomer ────────────────────────────────────────────────────────────

describe("createCustomer", () => {
  it("returns the Wave customer ID on success", async () => {
    const f = makeGqlFetch({ customerCreate: { didSucceed: true, inputErrors: [], customer: { id: "cust-abc" } } });
    const id = await createCustomer(ENV, "Leila Smith", "leila@example.com", f);
    expect(id).toBe("cust-abc");
  });

  it("sends correct variables in the request body", async () => {
    const f = makeGqlFetch({ customerCreate: { didSucceed: true, inputErrors: [], customer: { id: "cust-xyz" } } });
    await createCustomer(ENV, "Test Name", "test@test.com", f);
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.variables.businessId).toBe("biz-123");
    expect(body.variables.input.name).toBe("Test Name");
    expect(body.variables.input.email).toBe("test@test.com");
    expect(body.variables.input.currency).toBe("ZAR");
  });

  it("sends Bearer auth header", async () => {
    const f = makeGqlFetch({ customerCreate: { didSucceed: true, inputErrors: [], customer: { id: "c1" } } });
    await createCustomer(ENV, "Jane", "jane@ex.com", f);
    const headers = (f as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
  });

  it("throws when didSucceed is false", async () => {
    const f = makeGqlFetch({
      customerCreate: { didSucceed: false, inputErrors: [{ message: "Email already used", code: "DUPLICATE" }], customer: null },
    });
    await expect(createCustomer(ENV, "X", "x@x.com", f)).rejects.toThrow("Email already used");
  });

  it("throws on HTTP error", async () => {
    const f = makeErrorFetch(500);
    await expect(createCustomer(ENV, "X", "x@x.com", f)).rejects.toThrow("Wave HTTP 500");
  });

  it("throws when GQL errors array is populated", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "Authentication failed" }] }),
    }) as unknown as typeof fetch;
    await expect(createCustomer(ENV, "X", "x@x.com", f)).rejects.toThrow("Authentication failed");
  });
});

// ── createInvoice ─────────────────────────────────────────────────────────────

describe("createInvoice", () => {
  it("returns the Wave invoice ID on success", async () => {
    const f = makeGqlFetch({ invoiceCreate: { didSucceed: true, inputErrors: [], invoice: { id: "inv-111" } } });
    const id = await createInvoice(ENV, "cust-abc", "LQ-0001", 500000, "2026-09-15", f);
    expect(id).toBe("inv-111");
  });

  it("sends the total as rand (not cents) and includes the product ID", async () => {
    const f = makeGqlFetch({ invoiceCreate: { didSucceed: true, inputErrors: [], invoice: { id: "inv-222" } } });
    await createInvoice(ENV, "cust-abc", "LQ-0002", 500000, "2026-09-15", f);
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const item = body.variables.input.itemsCreate[0];
    expect(item.unitPrice).toBe(5000); // 500000 cents = R5000
    expect(item.productId).toBe("prod-456");
  });

  it("uses weddingDate as the invoice date", async () => {
    const f = makeGqlFetch({ invoiceCreate: { didSucceed: true, inputErrors: [], invoice: { id: "inv-333" } } });
    await createInvoice(ENV, "cust-abc", "LQ-0003", 100000, "2026-12-01", f);
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.variables.input.invoiceDate).toBe("2026-12-01");
  });

  it("throws when WAVE_PRODUCT_ID is absent", async () => {
    const f = makeGqlFetch({});
    const envNoProd = { ...ENV, WAVE_PRODUCT_ID: undefined };
    await expect(createInvoice(envNoProd, "cust", "ref", 10000, "2026-01-01", f)).rejects.toThrow("WAVE_PRODUCT_ID not configured");
  });

  it("throws when didSucceed is false", async () => {
    const f = makeGqlFetch({
      invoiceCreate: { didSucceed: false, inputErrors: [{ message: "Customer not found", code: "NOT_FOUND" }], invoice: null },
    });
    await expect(createInvoice(ENV, "cust", "ref", 10000, "2026-01-01", f)).rejects.toThrow("Customer not found");
  });
});

// ── recordPayment ─────────────────────────────────────────────────────────────

describe("recordPayment", () => {
  it("resolves on success", async () => {
    const f = makeGqlFetch({ invoicePaymentCreate: { didSucceed: true, inputErrors: [] } });
    await expect(recordPayment(ENV, "inv-999", 250000, "2026-09-15", "Yoco deposit · LQ-0001", f)).resolves.toBeUndefined();
  });

  it("sends amount as rand (not cents)", async () => {
    const f = makeGqlFetch({ invoicePaymentCreate: { didSucceed: true, inputErrors: [] } });
    await recordPayment(ENV, "inv-999", 250000, "2026-09-15", "memo", f);
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.variables.input.amount).toBe(2500); // 250000 cents = R2500
  });

  it("sends the bank account ID", async () => {
    const f = makeGqlFetch({ invoicePaymentCreate: { didSucceed: true, inputErrors: [] } });
    await recordPayment(ENV, "inv-999", 100, "2026-09-15", "memo", f);
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.variables.input.paymentAccountId).toBe("acct-789");
  });

  it("throws when WAVE_BANK_ACCOUNT_ID is absent", async () => {
    const f = makeGqlFetch({});
    const envNoAcct = { ...ENV, WAVE_BANK_ACCOUNT_ID: undefined };
    await expect(recordPayment(envNoAcct, "inv", 100, "2026-01-01", "memo", f)).rejects.toThrow("WAVE_BANK_ACCOUNT_ID not configured");
  });

  it("throws when didSucceed is false", async () => {
    const f = makeGqlFetch({
      invoicePaymentCreate: { didSucceed: false, inputErrors: [{ message: "Invoice not found", code: "NOT_FOUND" }] },
    });
    await expect(recordPayment(ENV, "inv", 100, "2026-01-01", "memo", f)).rejects.toThrow("Invoice not found");
  });

  it("throws on HTTP 401", async () => {
    const f = makeErrorFetch(401);
    await expect(recordPayment(ENV, "inv", 100, "2026-01-01", "memo", f)).rejects.toThrow("Wave HTTP 401");
  });
});
