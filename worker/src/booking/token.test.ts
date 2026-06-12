// worker/src/booking/token.test.ts
import { describe, it, expect } from "vitest";
import { signToken, hashToken, verifyToken } from "./token";

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
  it("produces a different hash when the token is tampered", async () => {
    const t = await signToken(ID, EXP, SECRET);
    const h1 = await hashToken(t);
    const tampered = t.slice(0, -1) + (t.slice(-1) === "a" ? "b" : "a");
    const h2 = await hashToken(tampered);
    expect(h1).not.toBe(h2);
  });
});

describe("verifyToken", () => {
  const SECRET = "signing-secret";
  const ID = "11111111-2222-3333-4444-555555555555";

  it("round-trips a freshly signed token", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), SECRET);
    const v = await verifyToken(token, SECRET);
    expect(v).not.toBeNull();
    expect(v!.bookingId).toBe(ID);
    expect(v!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for a tampered token", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), SECRET);
    expect(await verifyToken(token + "x", SECRET)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await signToken(ID, new Date(Date.now() + 60_000), "other-secret");
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it("returns null for a structurally malformed token", async () => {
    expect(await verifyToken("not-a-real-token", SECRET)).toBeNull();
  });

  it("authenticates an expired token but reports a past expiry (caller enforces TTL)", async () => {
    const token = await signToken(ID, new Date(Date.now() - 1000), SECRET);
    const v = await verifyToken(token, SECRET);
    expect(v).not.toBeNull();
    expect(v!.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});

describe("signToken — decoded payload", () => {
  it("embeds bookingId and expiry in the decoded payload", async () => {
    const t = await signToken(ID, EXP, SECRET);
    // toBase64Url is standard base64url, so replace - → + and _ → /
    const decoded = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
    const [embeddedId, embeddedExp, hmac] = decoded.split("|");
    expect(embeddedId).toBe(ID);
    expect(embeddedExp).toBe(EXP.toISOString());
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});
