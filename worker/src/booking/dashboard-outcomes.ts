// worker/src/booking/dashboard-outcomes.ts
// Pillar 6 — Outcome-framed control panel surface.
// Converts raw KPIs + automation events into OUTCOMES (reclaimed admin time,
// coordination score, weekly momentum) instead of feature-tables.
// Pure functions (no I/O) so they are unit-testable.

export interface AutomationEvent {
  type: string; // notification_type: enquiry_received, invoice_sent, balance_due, ...
  created_at: string;
}

export interface OutcomeInput {
  // KPIs from dashboard-kpi.computeKpis
  pipeline_cents: number;
  booked_cents: number;
  collected_cents: number;
  owed_cents: number;
  collection_pct: number;
  open_enquiries: number;
  at_risk_count: number;
  conversion_pct: number;
  // automation signal
  events: AutomationEvent[];
  now?: number;
}

// Estimated admin minutes saved per automated action vs. doing it by hand.
// Grounded in the real notification_type enum values + audit_log actions.
const MINUTES_SAVED: Record<string, number> = {
  enquiry_received: 8, // auto-intake + confirm email + notify (vs manual data entry)
  invoice_sent: 12, // quote/invoice composed + emailed (vs drafting manually)
  booking_accepted: 6,
  deposit_paid: 4, // auto EFT capture + reconcile (vs manual bank check)
  balance_due: 5, // auto reminder (vs manual chase)
  balance_collected: 4,
  contact_added: 2,
  review_requested: 3,
  referral_captured: 3,
  // fallthrough: anything else counts as 3 min of automation
};

const FALLBACK_MINUTES = 3;

export interface Outcomes {
  reclaimed_minutes_7d: number;
  reclaimed_hours_7d: number;
  coordination_score: number; // 0-100: how automated/healthy the pipeline is
  momentum_label: string; // "Accelerating" | "Steady" | "Needs attention"
  headline: string; // one outcome sentence for the top of the dashboard
}

/** Sum automated-minute savings for events in the last N days. */
export function reclaimedMinutes(events: AutomationEvent[], days = 7, now = Date.now()): number {
  const cutoff = now - days * 86400000;
  let total = 0;
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (t < cutoff) continue;
    total += MINUTES_SAVED[e.type] ?? FALLBACK_MINUTES;
  }
  return total;
}

/**
 * Coordination score (0-100): rewards a healthy, automated pipeline.
 * - collection high → +; owed high → −
 * - at-risk low → +; high → −
 * - conversion reasonable → +
 * - open enquiries with no bottleneck (at-risk low) → +
 */
export function coordinationScore(i: OutcomeInput): number {
  let score = 50; // neutral baseline
  // Collection: each % above 80 adds 0.4, below 80 subtracts 0.4
  score += (i.collection_pct - 80) * 0.4;
  // At-risk: each at-risk item costs 3 points
  score -= i.at_risk_count * 3;
  // Conversion: 60% is the North-Star target
  score += (i.conversion_pct - 60) * 0.3;
  // Pipeline velocity proxy: open enquiries that aren't at-risk are healthy
  const healthy = Math.max(0, i.open_enquiries - i.at_risk_count);
  score += Math.min(healthy, 10) * 0.5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeOutcomes(i: OutcomeInput): Outcomes {
  const now = i.now ?? Date.now();
  const minutes = reclaimedMinutes(i.events, 7, now);
  const score = coordinationScore(i);
  const momentum =
    i.at_risk_count === 0 && i.conversion_pct >= 60
      ? "Accelerating"
      : i.at_risk_count > 3
        ? "Needs attention"
        : "Steady";
  const hours = Math.round((minutes / 60) * 10) / 10;
  const headline =
    score >= 70
      ? `Business running itself — ${hours}h of admin reclaimed this week, coordination ${score}/100.`
      : score >= 45
        ? `${hours}h of admin reclaimed this week. ${i.at_risk_count} item(s) need a human touch.`
        : `${hours}h reclaimed, but ${i.at_risk_count} item(s) are slipping — coordination at ${score}/100.`;
  return {
    reclaimed_minutes_7d: minutes,
    reclaimed_hours_7d: hours,
    coordination_score: score,
    momentum_label: momentum,
    headline,
  };
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
