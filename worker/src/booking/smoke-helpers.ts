import { signToken, hashToken } from "./token";

export interface SmokeSeed {
  id: string;
  confirmToken: string;
  row: Record<string, unknown>;
}

/**
 * Build a valid `requested` booking row with its confirm token + stored hash
 * already wired. id is generated client-side so the token can be minted before
 * insert (S3 resolves the booking by confirm_token_hash). Sentinel 2099 date +
 * "SMOKE TEST" name keep test data isolated and unmistakable.
 */
export async function buildSmokeBooking(
  signingSecret: string,
  brideEmail: string,
  now: Date = new Date(),
): Promise<SmokeSeed> {
  const id = crypto.randomUUID();
  const stamp = now.toISOString();
  const confirmExp = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const confirmToken = await signToken(id, confirmExp, signingSecret);
  const confirm_token_hash = await hashToken(confirmToken);
  const row: Record<string, unknown> = {
    id,
    reference: `SMOKE-${stamp}`,
    idempotency_key: `smoke-${id}`,
    status: "requested",
    occasion: "wedding",
    wedding_date: "2099-12-31",
    bride_name: `SMOKE TEST ${stamp}`,
    bride_email: brideEmail,
    bride_phone: "+27000000000",
    party_size: 1,
    estimate_input: {},
    total_cents: 100000,
    quote_lines: [],
    deposit_pct: 50,
    deposit_net_cents: 50000,
    balance_net_cents: 50000,
    consent_at: stamp,
    confirm_token_hash,
    confirm_token_expires_at: confirmExp.toISOString(),
  };
  return { id, confirmToken, row };
}

export interface StepExpectation {
  label: string;
  status: string;
  timestampField: string;
  successEvent: string;
}

export interface StepActual {
  row: Record<string, unknown> | null;
  auditEvents: Array<{ event_type: string }>;
}

/** Pure evaluation of one transition step. Returns failure messages (empty = pass). */
export function evaluateStep(exp: StepExpectation, actual: StepActual): string[] {
  const fails: string[] = [];
  const row = actual.row;
  if (!row) return [`${exp.label}: booking row not found`];
  if (row.status !== exp.status) fails.push(`${exp.label}: status ${String(row.status)} != ${exp.status}`);
  if (!row[exp.timestampField]) fails.push(`${exp.label}: ${exp.timestampField} not set`);
  const types = actual.auditEvents.map((e) => e.event_type);
  if (!types.includes(exp.successEvent)) {
    fails.push(`${exp.label}: audit missing ${exp.successEvent} (saw ${types.join(",") || "none"})`);
  }
  const failed = types.filter((t) => t.endsWith(".email-failed"));
  if (failed.length) fails.push(`${exp.label}: email-failed audit present (${failed.join(",")})`);
  return fails;
}
