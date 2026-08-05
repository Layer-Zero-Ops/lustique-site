// worker/src/booking/lifecycle-actions.ts
// Shared "advance to next stage" maps for dashboard bulk actions.
// Status-only advance: moves a submission/booking one step forward in its
// pipeline and (callers) stamp the relevant timestamp. Never regresses.

type Stage = { status: string; stamp?: string };

const ENQUIRY_FLOW: string[] = ["new", "contacted", "converted", "closed"];
const BOOKING_FLOW: string[] = ["requested", "quote_sent", "accepted", "deposit_paid", "settled"];

/** Next enquiry status, or same if already at the end. */
export function nextEnquiryStatus(current: string): string {
  const i = ENQUIRY_FLOW.indexOf(current);
  if (i < 0 || i >= ENQUIRY_FLOW.length - 1) return current;
  return ENQUIRY_FLOW[i + 1]!;
}

/** Next booking status + the timestamp column to stamp, or same if at the end. */
export function nextBookingStage(current: string): Stage {
  const i = BOOKING_FLOW.indexOf(current);
  if (i < 0 || i >= BOOKING_FLOW.length - 1) return { status: current };
  const status = BOOKING_FLOW[i + 1]!;
  const stamp =
    status === "quote_sent" ? "quote_sent_at"
    : status === "accepted" ? "accepted_at"
    : status === "deposit_paid" ? "deposit_paid_at"
    : undefined;
  return { status, stamp };
}
