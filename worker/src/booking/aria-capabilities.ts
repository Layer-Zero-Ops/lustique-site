// worker/src/booking/aria-capabilities.ts
// Phase 8 — Aria's capability registry + risk gating.
// Each capability is a business function Aria can perform. Risk tiers decide
// whether it runs automatically (low) or waits for Zandeline's approval (med/high).
// Pure logic here is TDD-able; side effects live in the executor (aria-chat.ts).

export type Risk = "low" | "med" | "high";

export interface Capability {
  id: string;
  label: string;
  risk: Risk;
  /** Human-readable description of what Aria will do. */
  description: string;
}

// The catalogue of what Aria is allowed to do. Edit this to grant/revoke powers.
export const CAPABILITIES: Capability[] = [
  // LOW — safe, reversible, internal. Runs automatically.
  { id: "tidy-dashboard", label: "Tidy dashboard", risk: "low", description: "Archive resolved enquiries + past bookings older than 120 days." },
  { id: "archive-item", label: "Archive inbox item", risk: "low", description: "Hide a selected inbox item from the unified inbox." },
  { id: "draft-reply", label: "Draft an email reply", risk: "low", description: "Compose a reply for Zandeline to review (not sent)." },
  { id: "summarise", label: "Summarise a booking/enquiry", risk: "low", description: "Produce a plain-language summary of a lead or booking." },
  { id: "request-review", label: "Request a review (nudge)", risk: "low", description: "Queue a post-wedding review request for a settled booking." },

  // MED — visible impact, reversible, but Zandeline should know. Logs + notifies; auto-runs but notifies.
  { id: "mark-deposit-paid", label: "Mark deposit paid", risk: "med", description: "Record a deposit as paid from an EFT proof." },
  { id: "generate-invoice", label: "Generate invoice", risk: "med", description: "Create a booking/invoice record from an enquiry." },
  { id: "reschedule", label: "Reschedule a booking", risk: "med", description: "Change a booking's event date." },
  { id: "update-status", label: "Update enquiry/booking status", risk: "med", description: "Move a lead through the pipeline." },

  // HIGH — money or external send. Must be explicitly approved before executing.
  { id: "send-email", label: "Send an email", risk: "high", description: "Send a drafted email to a client." },
  { id: "send-confirmation", label: "Send booking confirmation", risk: "high", description: "Send a contract + confirmation link to a bride." },
  { id: "issue-refund", label: "Issue a refund", risk: "high", description: "Refund a payment (money leaves the business)." },
  { id: "delete-record", label: "Delete a record", risk: "high", description: "Soft-delete an enquiry/booking from the dashboard." },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id);
}

export interface RiskDecision {
  tier: Risk;
  auto: boolean;        // low → true; med → true (notify); high → false
  requiresApproval: boolean; // high → true
  notify: boolean;      // med/high → true
}

export function assessRisk(capabilityId: string): RiskDecision {
  const c = BY_ID.get(capabilityId);
  if (!c) return { tier: "high", auto: false, requiresApproval: true, notify: true };
  switch (c.risk) {
    case "low":
      return { tier: "low", auto: true, requiresApproval: false, notify: false };
    case "med":
      return { tier: "med", auto: true, requiresApproval: false, notify: true };
    case "high":
      return { tier: "high", auto: false, requiresApproval: true, notify: true };
  }
}

/** Map a free-text request to a capability id, or null if none matches. */
export function classifyIntent(text: string): string | null {
  const t = text.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["tidy-dashboard", /tidy|clean up|archive old|declutter/],
    ["request-review", /review request|nudge|ask for a review|testimonial/],
    ["generate-invoice", /invoice|quote|booking record/],
    ["mark-deposit-paid", /deposit.{0,10}paid|paid.{0,10}deposit|eft proof|received payment/],
    ["send-confirmation", /confirm|contract|booking link/],
    ["send-email", /send (an |the )?email|reply to|email .*client/],
    ["reschedule", /reschedule|change.{0,10}date|move the date/],
    ["issue-refund", /refund/],
    ["delete-record", /delete|remove/],
    ["summarise", /summarise|summary|what.{0,10}status|overview/],
    ["draft-reply", /draft|compose|write a reply/],
    ["update-status", /mark as|update status|move to/],
  ];
  for (const [id, re] of rules) if (re.test(t)) return id;
  return null;
}
