// worker/src/booking/token.test.ts
import { describe, it, expect } from "vitest";
import { signToken, hashToken } from "./token";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const EXP = new Date("2026-07-01T00:00:00Z");
const SECRET = "test-signing-secret";

describe("signToken", () => {
  it("returns only base64url chars (no +, /, or = padding)", async () => {
    const t = await signToken(ID, EXP, SECRET);
    expect(t).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
  it("is deterministic for the same inputs", async () => {
    expect(await signToken(ID, EXP, SECRET)).toBe(await signToken(ID, EXP, SECRET));
  });
  it("differs when the booking ID changes", async () => {
    const other = await signToken("different-id", EXP, SECRET);
    expect(await signToken(ID, EXP, SECRET)).not.toBe(other);
  });
  it("differs when the secret changes", async () => {
    expect(await signToken(ID, EXP, SECRET)).not.toBe(await signToken(ID, EXP, "other-secret"));
  });
  it("differs when the expiry changes", async () => {
    const laterExp = new Date("2026-08-01T00:00:00Z");
    expect(await signToken(ID, EXP, SECRET)).not.toBe(await signToken(ID, laterExp, SECRET));
  });
});

describe("hashToken", () => {
  it("returns a 64-char lowercase hex string (SHA-256)", async () => {
    expect(await hashToken("any-token")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic", async () => {
    expect(await hashToken("x")).toBe(await hashToken("x"));
  });
  it("produces different hashes for different inputs", async () => {
    expect(await hashToken("a")).not.toBe(await hashToken("b"));
  });
  it("hashes a real signed token without throwing", async () => {
    const t = await signToken(ID, EXP, SECRET);
    const h = await hashToken(t);
    expect(h).toHaveLength(64);
  });
});
