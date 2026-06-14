import { describe, it, expect } from "vitest";
import { buildSmokeBooking } from "./smoke-helpers";
import { hashToken, verifyToken } from "./token";

describe("buildSmokeBooking", () => {
  it("produces a valid requested row whose confirm_token_hash matches the minted token", async () => {
    const { id, confirmToken, row } = await buildSmokeBooking("test-secret", "ops@example.com");
    expect(row.id).toBe(id);
    expect(row.status).toBe("requested");
    expect(String(row.bride_name)).toMatch(/^SMOKE TEST /);
    expect(row.wedding_date).toBe("2099-12-31");
    expect(row.bride_email).toBe("ops@example.com");
    expect(row.confirm_token_hash).toBe(await hashToken(confirmToken));
    for (const k of [
      "reference", "idempotency_key", "occasion", "bride_phone", "party_size",
      "estimate_input", "total_cents", "quote_lines", "deposit_pct",
      "deposit_net_cents", "balance_net_cents", "consent_at", "confirm_token_expires_at",
    ]) {
      expect(row[k], `missing NOT NULL column ${k}`).toBeDefined();
    }
  });

  it("mints a confirm token that verifies back to the row id", async () => {
    const { id, confirmToken } = await buildSmokeBooking("s", "a@b.com");
    const v = await verifyToken(confirmToken, "s");
    expect(v?.bookingId).toBe(id);
  });
});
