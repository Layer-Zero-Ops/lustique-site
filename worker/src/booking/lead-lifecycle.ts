// worker/src/booking/lead-lifecycle.ts
// Phase 2 (Pillar 2 unification) — derive ONE canonical lead lifecycle per
// submission, so enquiry -> booking is a single tracked entity (no orphans).
// Pure functions, TDD'd.

export type EnquiryLifecycle =
  | "new"
  | "contacted"
  | "quoted"
  | "booked"
  | "declined"
  | "archived";

export interface LeadInput {
  enquiry_status: string | null; // legacy enquiry.status (new/contacted/converted/closed)
  booking_id: string | null;
  booking_status: string | null; // requested/quote_sent/accepted/deposit_paid/settled/declined
  archived_at: string | null;
}

const LIFECYCLE_RANK: Record<EnquiryLifecycle, number> = {
  new: 0,
  contacted: 1,
  quoted: 2,
  booked: 3,
  declined: 4,
  archived: 5,
};

/**
 * Collapse the fragmented enquiry.status + booking.status into one lifecycle.
 * Precedence (highest wins): archived > declined > booked > quoted > contacted > new.
 */
export function deriveLifecycle(i: LeadInput): EnquiryLifecycle {
  if (i.archived_at) return "archived";
  if (i.booking_status === "declined" || i.enquiry_status === "closed") return "declined";
  if (i.booking_id || i.booking_status) {
    // a booking exists (or exists in booking-status) -> the lead is booked
    if (i.booking_status === "requested" || i.booking_status === "quote_sent") return "quoted";
    return "booked";
  }
  if (i.enquiry_status === "converted") return "booked";
  if (i.enquiry_status === "contacted") return "contacted";
  return "new";
}

/** True when the enquiry has no booking link AND is stuck at new/contacted — the orphan risk. */
export function isOrphanRisk(i: LeadInput): boolean {
  if (i.archived_at) return false;
  if (i.booking_id) return false;
  return i.enquiry_status === "new" || i.enquiry_status === "contacted" || i.enquiry_status === null;
}

/** Advance lifecycle only forward (never regress). Returns the higher-ranked state. */
export function advanceLifecycle(current: EnquiryLifecycle, next: EnquiryLifecycle): EnquiryLifecycle {
  return LIFECYCLE_RANK[next] > LIFECYCLE_RANK[current] ? next : current;
}
