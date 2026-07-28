// worker/src/booking/post-wedding.test.ts
import { describe, it, expect } from "vitest";
import {
  isPostWedding,
  decidePostWedding,
  composeReviewRequest,
  composeReferralPrompt,
  type PostWeddingInput,
} from "./post-wedding";

const NOW = new Date("2026-08-01T00:00:00Z").getTime();
const past = "2026-07-15";
const future = "2026-09-01";

function base(over: Partial<PostWeddingInput>): PostWeddingInput {
  return { status: "settled", wedding_date: past, balance_net_cents: 0, review_requested_at: null, referral_captured_at: null, now: NOW, ...over };
}

describe("isPostWedding", () => {
  it("true when settled and wedding passed", () => {
    expect(isPostWedding(base({}))).toBe(true);
  });
  it("false when wedding in future", () => {
    expect(isPostWedding(base({ wedding_date: future }))).toBe(false);
  });
  it("true when deposit_paid and balance 0 and past", () => {
    expect(isPostWedding(base({ status: "deposit_paid", balance_net_cents: 0 }))).toBe(true);
  });
  it("false when balance still owed (deposit_paid, balance pending)", () => {
    expect(isPostWedding(base({ status: "deposit_paid", balance_net_cents: 5000, wedding_date: past }))).toBe(false);
  });
});

describe("decidePostWedding", () => {
  it("none before post-wedding", () => {
    expect(decidePostWedding(base({ wedding_date: future }))).toBe("none");
  });
  it("review_due first", () => {
    expect(decidePostWedding(base({}))).toBe("review_due");
  });
  it("referral_due after review sent", () => {
    expect(decidePostWedding(base({ review_requested_at: "2026-07-20" }))).toBe("referral_due");
  });
  it("complete after both done", () => {
    expect(decidePostWedding(base({ review_requested_at: "2026-07-20", referral_captured_at: "2026-07-22" }))).toBe("complete");
  });
});

describe("copy", () => {
  it("review request is on-brand and contains link", () => {
    const c = composeReviewRequest("Janeke Russell", "LUS-1", "https://x.com/lustique");
    expect(c.subject).toContain("Lustique");
    expect(c.body).toContain("https://x.com/lustique");
    expect(c.body).toContain("Janeke");
  });
  it("referral prompt contains referral link", () => {
    const c = composeReferralPrompt("Janeke Russell", "LUS-1", "https://lustique.co.za/?ref=j");
    expect(c.body).toContain("https://lustique.co.za/?ref=j");
  });
});
