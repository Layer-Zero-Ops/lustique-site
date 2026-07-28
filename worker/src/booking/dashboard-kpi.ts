// worker/src/booking/dashboard-kpi.ts
// Phase 1 — KPI engine for the Lustique control panel.
// Pure functions (no I/O) so they are unit-testable without Supabase.

export interface KpiBooking {
  status: string;
  total_cents: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  wedding_date: string;
  created_at: string;
  quote_sent_at: string | null;
  archived_at?: string | null;
}

export interface KpiEnquiry {
  id: string;
  status: string;
  created_at: string;
  booking_id: string | null;
  archived_at?: string | null;
}

export interface KpiResult {
  pipeline_cents: number; // open quotes (requested + quote_sent) total value
  booked_cents: number; // accepted + deposit_paid + settled total value
  collected_cents: number; // deposits + balances already paid
  owed_cents: number; // outstanding deposits + balances
  collection_pct: number; // collected / (collected + owed) * 100
  open_enquiries: number; // enquiries with no booking, not archived
  at_risk_count: number; // quotes expiring <48h + overdue balances + zero-totals
  conversion_pct: number; // bookings with booking_id / total enquiries
}

const OPEN_QUOTE = new Set(["requested", "quote_sent"]);
const BOOKED = new Set(["accepted", "deposit_paid", "settled"]);

/** Days from now until an ISO date (negative = past). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

/** Bookings with total_cents === 0 in a money state are data-integrity risks. */
export function isZeroTotal(b: KpiBooking): boolean {
  return b.total_cents === 0 && BOOKED.has(b.status);
}

/** A quote sent >14 days ago with no decision is expired/stale. */
export function isQuoteExpired(b: KpiBooking, now = Date.now()): boolean {
  if (b.status !== "quote_sent" || !b.quote_sent_at) return false;
  return now - new Date(b.quote_sent_at).getTime() > 14 * 86400000;
}

/** A confirmed booking with unpaid balance past its wedding date is overdue. */
export function isBalanceOverdue(b: KpiBooking, now = Date.now()): boolean {
  if (!BOOKED.has(b.status)) return false;
  if (b.balance_net_cents <= 0) return false;
  return new Date(b.wedding_date).getTime() < now;
}

export function computeKpis(
  bookings: KpiBooking[],
  enquiries: KpiEnquiry[],
  now = Date.now(),
): KpiResult {
  let pipeline_cents = 0;
  let booked_cents = 0;
  let collected_cents = 0;
  let owed_cents = 0;
  let at_risk_count = 0;

  for (const b of bookings) {
    if (b.archived_at) continue;
    if (OPEN_QUOTE.has(b.status)) {
      pipeline_cents += b.total_cents;
      // quote expiring within 48h of its 14-day deadline is at-risk
      if (b.quote_sent_at) {
        const daysLeft = Math.ceil(
          (new Date(b.quote_sent_at).getTime() + 14 * 86400000 - now) / 86400000,
        );
        if (daysLeft <= 2) at_risk_count++;
      }
    } else if (BOOKED.has(b.status)) {
      booked_cents += b.total_cents;
      collected_cents += b.deposit_net_cents;
      owed_cents += b.balance_net_cents;
      if (b.balance_net_cents > 0) at_risk_count++; // outstanding balance to chase
    }
    if (isZeroTotal(b)) at_risk_count++;
    if (isQuoteExpired(b, now)) at_risk_count++;
    if (isBalanceOverdue(b, now)) at_risk_count++;
  }

  const total = collected_cents + owed_cents;
  const collection_pct = total > 0 ? Math.round((collected_cents / total) * 100) : 100;

  const liveEnquiries = enquiries.filter((e) => !e.archived_at);
  const open_enquiries = liveEnquiries.filter((e) => !e.booking_id).length;
  const withBooking = liveEnquiries.filter((e) => e.booking_id).length;
  const denom = liveEnquiries.length;
  const conversion_pct = denom > 0 ? Math.round((withBooking / denom) * 100) : 0;

  return {
    pipeline_cents,
    booked_cents,
    collected_cents,
    owed_cents,
    collection_pct,
    open_enquiries,
    at_risk_count,
    conversion_pct,
  };
}

export function formatZAR(cents: number): string {
  const rands = cents / 100;
  return "R " + rands.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
