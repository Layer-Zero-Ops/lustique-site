// worker/src/booking/post-wedding.ts
// Phase 3 (Pillar 1) — post-wedding journey stage.
// Pure decision + copy logic so it is TDD-able. The Worker calls these to
// decide WHEN to ask for a review/referral and WHAT to send.

export type PostWeddingStage = "none" | "review_due" | "referral_due" | "complete";

export interface PostWeddingInput {
  status: string;
  wedding_date: string;
  balance_net_cents: number;
  review_requested_at: string | null;
  referral_captured_at: string | null;
  now?: number;
}

/** A booking reaches the post-wedding stage once it's settled (balance paid) AND the wedding date has passed. */
export function isPostWedding(i: PostWeddingInput): boolean {
  const settled = i.status === "settled" || (i.status === "deposit_paid" && i.balance_net_cents <= 0);
  const past = new Date(i.wedding_date).getTime() <= (i.now ?? Date.now());
  return settled && past;
}

/** Decide the next post-wedding action. Review first, then referral, then done. */
export function decidePostWedding(i: PostWeddingInput): PostWeddingStage {
  if (!isPostWedding(i)) return "none";
  if (!i.review_requested_at) return "review_due";
  if (!i.referral_captured_at) return "referral_due";
  return "complete";
}

export interface ReviewCopy {
  subject: string;
  body: string;
}

/** Compose the review-request email (quiet-luxury tone, per BRAND.md). */
export function composeReviewRequest(brideName: string, bookingRef: string, reviewUrl: string): ReviewCopy {
  const first = (brideName || "there").split(" ")[0];
  return {
    subject: "How did we do? ✦ Lustique Co.",
    body:
      `Hi ${first},\n\n` +
      `Thank you for trusting Lustique Co. with your wedding day. ` +
      `We'd love to hear how it felt — your words help future brides find us.\n\n` +
      `If you have a moment, a review means the world: ${reviewUrl}\n\n` +
      `With love,\nThe Lustique Co. team\n(Reference ${bookingRef})`,
  };
}

export interface ReferralCopy {
  subject: string;
  body: string;
}

/** Compose the referral prompt — turns a happy bride into a source of new bookings. */
export function composeReferralPrompt(brideName: string, bookingRef: string, referralUrl: string): ReferralCopy {
  const first = (brideName || "there").split(" ")[0];
  return {
    subject: "Know a bride-to-be? ✦ Lustique Co.",
    body:
      `Hi ${first},\n\n` +
      `If you know someone planning their wedding, we'd be honoured to care for them too. ` +
      `Share this link and we'll treat them like family: ${referralUrl}\n\n` +
      `With love,\nThe Lustique Co. team\n(Reference ${bookingRef})`,
  };
}
