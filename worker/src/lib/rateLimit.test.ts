// worker/src/lib/rateLimit.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkRateLimit, RATE_LIMITS } from "./rateLimit";

function makeBinding(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

describe("checkRateLimit", () => {
  it("returns success:true when binding allows the request", async () => {
    const binding = makeBinding(true);
    const result = await checkRateLimit(binding, "1.2.3.4", RATE_LIMITS.LOGIN_IP);
    expect(result.success).toBe(true);
    expect(binding.limit).toHaveBeenCalledOnce();
    expect(binding.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
  });

  it("returns success:false when binding blocks the request", async () => {
    const binding = makeBinding(false);
    const result = await checkRateLimit(binding, "1.2.3.4", RATE_LIMITS.LOGIN_IP);
    expect(result.success).toBe(false);
  });

  it("returns retryAfter equal to policy.periodSeconds when blocked", async () => {
    const binding = makeBinding(false);
    const result = await checkRateLimit(binding, "x", RATE_LIMITS.LOGIN_IP);
    expect(result.retryAfter).toBe(RATE_LIMITS.LOGIN_IP.periodSeconds);
  });

  it("returns retryAfter 0 when not blocked", async () => {
    const binding = makeBinding(true);
    const result = await checkRateLimit(binding, "x", RATE_LIMITS.ADMIN);
    expect(result.retryAfter).toBe(0);
  });

  it("BOOKING period is 60s", () => {
    expect(RATE_LIMITS.BOOKING.periodSeconds).toBe(60);
  });

  it("ENQUIRY period is 60s", () => {
    expect(RATE_LIMITS.ENQUIRY.periodSeconds).toBe(60);
  });

  it("ADMIN period is 60s", () => {
    expect(RATE_LIMITS.ADMIN.periodSeconds).toBe(60);
  });

  it("LOGIN_IP period is 60s", () => {
    expect(RATE_LIMITS.LOGIN_IP.periodSeconds).toBe(60);
  });

  it("LOGIN_EMAIL period is 60s", () => {
    expect(RATE_LIMITS.LOGIN_EMAIL.periodSeconds).toBe(60);
  });
});
