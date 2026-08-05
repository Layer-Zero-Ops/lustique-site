// worker/src/booking/automation.ts
// The "one entire action, 0 human touch — but gated for human QC" engine.
//
// Rule: a quote-invoice MUST go out within 24h of submission.
// Design: the system computes the next pipeline action for every submission and,
// when a step would normally need a human, it DRAFTS the action and queues it as
// an approval task (notification type "approval_needed") instead of executing it.
// Zandeline approves in one click → the action runs. This keeps the pipeline at
// zero-touch by default while every consequential step has a quality-control gate
// until confidence is high (the gate can later be relaxed per action type).
//
// No new auth/DB layer: reuses insertNotification + the existing db helpers.

export const QUOTE_SLA_MS = 24 * 60 * 60 * 1000;
export const QUOTE_DEADLINE_MS = 14 * 24 * 60 * 60 * 1000;

export type PipelineKind = "enquiry" | "booking";

export interface PipelineItem {
  kind: PipelineKind;
  id: string;
  name: string;
  status: string;
  created_at: string;
  // booking-only
  quote_sent_at?: string | null;
  detailHref: string;
}

/** SLA info for a row: due timestamp, hours remaining, state. */
export interface SlaInfo {
  dueAt: number;
  hoursLeft: number; // negative = overdue
  state: "ok" | "due" | "over";
  label: string;
}

export function slaFor(item: PipelineItem, now = Date.now()): SlaInfo {
  // Enquiry at new → must be contacted + moved within 24h.
  // Booking at requested → quote must go out within 24h.
  // Booking at quote_sent → bride has 14 days; show due/over at deadline.
  if (item.kind === "enquiry") {
    if (item.status === "new" || item.status === "contacted") {
      const dueAt = new Date(item.created_at).getTime() + QUOTE_SLA_MS;
      const hoursLeft = Math.round((dueAt - now) / 3600000);
      const state: SlaInfo["state"] = hoursLeft < 0 ? "over" : hoursLeft <= 6 ? "due" : "ok";
      return { dueAt, hoursLeft, state, label: hoursLeft < 0 ? `OVERDUE ${Math.abs(hoursLeft)}h` : `due in ${hoursLeft}h` };
    }
    return { dueAt: 0, hoursLeft: 0, state: "ok", label: "—" };
  }
  // booking
  if (item.status === "requested") {
    const dueAt = new Date(item.created_at).getTime() + QUOTE_SLA_MS;
    const hoursLeft = Math.round((dueAt - now) / 3600000);
    const state: SlaInfo["state"] = hoursLeft < 0 ? "over" : hoursLeft <= 6 ? "due" : "ok";
    return { dueAt, hoursLeft, state, label: hoursLeft < 0 ? `OVERDUE ${Math.abs(hoursLeft)}h` : `quote in ${hoursLeft}h` };
  }
  if (item.status === "quote_sent" && item.quote_sent_at) {
    const dueAt = new Date(item.quote_sent_at).getTime() + QUOTE_DEADLINE_MS;
    const hoursLeft = Math.round((dueAt - now) / 3600000);
    const state: SlaInfo["state"] = hoursLeft < 0 ? "over" : hoursLeft <= 48 ? "due" : "ok";
    return { dueAt, hoursLeft, state, label: hoursLeft < 0 ? `expired ${Math.abs(hoursLeft)}h` : `reply in ${Math.round(hoursLeft / 24)}d` };
  }
  return { dueAt: 0, hoursLeft: 0, state: "ok", label: "—" };
}

/** The next automated action for a row, or null if none pending. */
export interface PendingAction {
  item: PipelineItem;
  action: string; // e.g. "send_quote", "advance_contacted", "generate_invoice"
  verb: string; // human label for the approval card
  draft: string; // what will happen on approval
}

export function nextAutomatedAction(item: PipelineItem, now = Date.now()): PendingAction | null {
  const sla = slaFor(item, now);
  if (item.kind === "enquiry") {
    if (item.status === "new") {
      return {
        item,
        action: "advance_contacted",
        verb: "Mark contacted + draft reply",
        draft: `Open with ${item.name}, acknowledge the enquiry, and prepare a quote.`,
      };
    }
    if (item.status === "contacted") {
      // needs an invoice generated → routes to booking
      return {
        item,
        action: "generate_invoice",
        verb: "Generate invoice",
        draft: `Create a draft invoice for ${item.name} from this enquiry.`,
      };
    }
    return null;
  }
  // booking
  if (item.status === "requested") {
    if (sla.state === "over" || sla.hoursLeft <= 6) {
      return {
        item,
        action: "send_quote",
        verb: "Send quote invoice",
        draft: `Email the quote-invoice to ${item.name} (24h SLA ${sla.state === "over" ? "BREACHED" : "due"}).`,
      };
    }
    return null;
  }
  if (item.status === "quote_sent") {
    return null; // waiting on bride; not auto-actionable
  }
  return null;
}

/**
 * Scan all items; for each that needs an action and isn't already queued,
 * insert an approval_needed notification. Returns the number of new tasks queued.
 * Idempotent-ish: callers pass already-queued ids to avoid duplicates.
 */
export async function queueDueActions(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  items: PipelineItem[],
  alreadyQueued: Set<string>,
  insert: (env: any, row: any, f?: typeof fetch) => Promise<void>,
  f: typeof fetch = fetch,
  now = Date.now(),
): Promise<number> {
  let queued = 0;
  for (const item of items) {
    const key = `${item.kind}:${item.id}:${nextAutomatedAction(item, now)?.action ?? ""}`;
    if (alreadyQueued.has(key)) continue;
    const pending = nextAutomatedAction(item, now);
    if (!pending) continue;
    await insert(env, {
      type: "approval_needed",
      title: `Approve: ${pending.verb}`,
      body: pending.draft,
      link: item.detailHref,
      booking_id: item.kind === "booking" ? item.id : undefined,
      payload: {
        kind: item.kind,
        target_id: item.id,
        action: pending.action,
        verb: pending.verb,
        draft: pending.draft,
      },
    }, f);
    queued++;
  }
  return queued;
}
