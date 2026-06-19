/**
 * Supabase data-access via PostgREST + fetch — no SDK, matching the Worker's fetch-only style.
 * Keyed by secret-NAME env (SUPABASE_URL / SUPABASE_SERVICE_KEY) so the data home is a
 * deploy-time choice (spec §2). `fetch` is injectable for unit tests.
 */
export interface DbEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

const rest = (env: DbEnv, path: string) => `${env.SUPABASE_URL}/rest/v1/${path}`;
const headers = (env: DbEnv): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  "content-type": "application/json",
});

/** Insert a booking; on idempotency_key conflict, return the existing row (no duplicate). */
export async function insertBooking(
  env: DbEnv,
  row: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<{ id: string; reference: string }> {
  const r = await f(rest(env, "bookings?on_conflict=idempotency_key&select=id,reference"), {
    method: "POST",
    headers: { ...headers(env), prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertBooking ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<{ id: string; reference: string }>;
  if (rows.length) return rows[0]!;
  // ignore-duplicates returned [] → the key already existed; fetch the original.
  return getBookingByIdempotencyKey(env, String(row.idempotency_key), f);
}

export async function getBookingByIdempotencyKey(
  env: DbEnv,
  key: string,
  f: typeof fetch = fetch,
): Promise<{ id: string; reference: string }> {
  const r = await f(rest(env, `bookings?idempotency_key=eq.${encodeURIComponent(key)}&select=id,reference`), {
    headers: headers(env),
  });
  if (!r.ok) throw new Error(`getBookingByIdempotencyKey ${r.status}`);
  const rows = (await r.json()) as Array<{ id: string; reference: string }>;
  const row = rows[0];
  if (!row) throw new Error(`getBookingByIdempotencyKey: row not found for key ${key}`);
  return row;
}

/** PATCH a booking by id; returns the updated row. */
export async function updateBookingStatus(
  env: DbEnv,
  id: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateBookingStatus ${r.status}: ${await r.text()}`);
  return ((await r.json()) as Array<Record<string, unknown>>)[0]!;
}

export async function insertPayment(
  env: DbEnv,
  row: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<{ id: string }> {
  const r = await f(rest(env, "payments?select=id"), {
    method: "POST",
    headers: { ...headers(env), prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertPayment ${r.status}: ${await r.text()}`);
  return ((await r.json()) as Array<{ id: string }>)[0]!;
}

/** S7: look up a pending payment by Yoco checkout ID (webhook idempotency + status check). */
export async function findPaymentByCheckoutId(
  env: DbEnv,
  checkoutId: string,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(rest(env, `payments?yoco_checkout_id=eq.${encodeURIComponent(checkoutId)}&select=*`), {
    headers: headers(env),
  });
  if (!r.ok) throw new Error(`findPaymentByCheckoutId ${r.status}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}

/** S7: mark a payment paid, record the Yoco payment ID and raw webhook payload. */
export async function markPaymentPaid(
  env: DbEnv,
  paymentRowId: string,
  yocoPaymentId: string,
  raw: unknown,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `payments?id=eq.${encodeURIComponent(paymentRowId)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ yoco_payment_id: yocoPaymentId, status: "paid", paid_at: new Date().toISOString(), raw }),
  });
  if (!r.ok) throw new Error(`markPaymentPaid ${r.status}: ${await r.text()}`);
}

/** The webhook's idempotency lookup: has this Yoco payment already been recorded paid? */
export async function findPaymentByYocoId(
  env: DbEnv,
  yocoPaymentId: string,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(rest(env, `payments?yoco_payment_id=eq.${encodeURIComponent(yocoPaymentId)}&select=*`), {
    headers: headers(env),
  });
  if (!r.ok) throw new Error(`findPaymentByYocoId ${r.status}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}

/** Wave 0: mark a payment failed; idempotent (PATCH by id regardless of current status). */
export async function markPaymentFailed(
  env: DbEnv,
  paymentRowId: string,
  raw: unknown,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `payments?id=eq.${encodeURIComponent(paymentRowId)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", failed_at: new Date().toISOString(), raw }),
  });
  if (!r.ok) throw new Error(`markPaymentFailed ${r.status}: ${await r.text()}`);
}

/** Wave 0: stamp failure_notified_at so we don't re-send the EFT fallback email. */
export async function markPaymentFailureNotified(
  env: DbEnv,
  paymentRowId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `payments?id=eq.${encodeURIComponent(paymentRowId)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ failure_notified_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`markPaymentFailureNotified ${r.status}: ${await r.text()}`);
}

/** Wave 0: find pending payments older than olderThanIso for the stale-payment sweep. */
export async function findStalePayments(
  env: DbEnv,
  olderThanIso: string,
  f: typeof fetch = fetch,
): Promise<Array<Record<string, unknown>>> {
  const r = await f(
    rest(env, `payments?status=eq.pending&created_at=lt.${encodeURIComponent(olderThanIso)}&select=*`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`findStalePayments ${r.status}`);
  return (await r.json()) as Array<Record<string, unknown>>;
}

export async function insertAudit(
  env: DbEnv,
  row: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "audit_log"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertAudit ${r.status}: ${await r.text()}`);
}

/** The columns the confirm gate needs from a booking row. */
export interface ConfirmBookingRow {
  id: string;
  reference: string;
  status: string;
  bride_name: string;
  bride_email: string;
  wedding_date: string;
  venue: string | null;
  town: string | null;
  province: string | null;
  party_size: number;
  total_cents: number;
  deposit_pct: number | null;
  deposit_net_cents: number;
  balance_net_cents: number;
  confirm_token_expires_at: string;
  confirm_token_used_at: string | null;
  wave_customer_id: string | null;
  wave_invoice_id: string | null;
  quote_sent_at: string | null;
  accepted_at: string | null;
}

const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at,wave_customer_id,wave_invoice_id," +
  "quote_sent_at,accepted_at";

/** Look a booking up by its stored confirm_token_hash. Returns null if none. */
export async function getBookingByTokenHash(
  env: DbEnv,
  hash: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow | null> {
  const r = await f(
    rest(env, `bookings?confirm_token_hash=eq.${encodeURIComponent(hash)}&select=${CONFIRM_COLS}`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`getBookingByTokenHash ${r.status}`);
  const rows = (await r.json()) as ConfirmBookingRow[];
  return rows.length ? rows[0]! : null;
}

/** Look a booking up by id (same columns as the confirm gate needs). */
export async function getBookingById(
  env: DbEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow | null> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&select=${CONFIRM_COLS}`), { headers: headers(env) });
  if (!r.ok) throw new Error(`getBookingById ${r.status}`);
  const rows = (await r.json()) as ConfirmBookingRow[];
  return rows.length ? rows[0]! : null;
}

/**
 * Guarded transition: PATCH only while status === fromStatus (atomic compare-and-set).
 * Returns the updated row, or null if 0 rows matched (already moved on).
 */
export async function transitionBooking(
  env: DbEnv,
  id: string,
  fromStatus: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(
    rest(env, `bookings?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}`),
    { method: "PATCH", headers: { ...headers(env), prefer: "return=representation" }, body: JSON.stringify(patch) },
  );
  if (!r.ok) throw new Error(`transitionBooking ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}

/** S3 confirm/decline guard — thin wrapper over the generalized transition. */
export function transitionRequestedBooking(
  env: DbEnv,
  id: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  return transitionBooking(env, id, "requested", patch, f);
}

/** Daily keep-warm: a tiny read resets the free-tier 7-day pause clock (spec §2). */
export async function keepWarm(env: DbEnv, f: typeof fetch = fetch): Promise<void> {
  await f(rest(env, "bookings?select=id&limit=1"), { headers: headers(env) });
}

/**
 * Count active bookings (not in any terminal status) on a given wedding date.
 * Used for the same-date warning and capacity soft-block.
 * PostgREST aggregate: select=count() returns [{ count: "N" }].
 */
export async function countBookingsOnDate(
  env: DbEnv,
  weddingDate: string, // "YYYY-MM-DD"
  f: typeof fetch = fetch,
): Promise<number> {
  const dead = "expired,declined,cancelled,rejected,invoice_expired";
  const r = await f(
    rest(env, `bookings?select=count()&wedding_date=eq.${encodeURIComponent(weddingDate)}&status=not.in.(${dead})`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`countBookingsOnDate ${r.status}`);
  const rows = (await r.json()) as Array<{ count: string }>;
  return parseInt(rows[0]?.count ?? "0", 10);
}

export interface DateAvailability {
  hardBlocked: boolean;
  slots: number;          // Infinity if no blocked_dates row; 0 if hard-blocked; N if soft cap
  bookingCount: number;
  conflict: boolean;      // bookingCount >= slots (only meaningful when !hardBlocked && slots < Infinity)
}

/**
 * Wave A: replaces the boolean isDateBlocked.
 * Returns conflict metadata so request.ts can soft-block instead of hard-409.
 *
 * Decision tree:
 *   no row              → { hardBlocked:false, slots:Infinity, bookingCount:0, conflict:false }
 *   row with slots=0    → { hardBlocked:true, ... }  → caller returns 409
 *   row with slots>0    → check active bookingCount → conflict=true if at or over cap
 */
export async function getDateAvailability(
  env: DbEnv,
  date: string,
  f: typeof fetch = fetch,
): Promise<DateAvailability> {
  const br = await f(rest(env, `blocked_dates?date=eq.${encodeURIComponent(date)}&select=slots&limit=1`), {
    headers: headers(env),
  });
  if (!br.ok) throw new Error(`getDateAvailability ${br.status}`);
  const rows = (await br.json()) as Array<{ slots: number }>;

  if (rows.length === 0) return { hardBlocked: false, slots: Infinity, bookingCount: 0, conflict: false };

  const slots = Number(rows[0]!.slots);
  if (slots === 0) return { hardBlocked: true, slots: 0, bookingCount: 0, conflict: false };

  const bookingCount = await countBookingsOnDate(env, date, f);
  return { hardBlocked: false, slots, bookingCount, conflict: bookingCount >= slots };
}

/** Insert a structured rejection record (bride declines quote or admin declines booking). */
export async function insertRejection(
  env: DbEnv,
  row: { booking_id: string; rejected_by: "admin" | "bride"; reason_code?: string; reason_text?: string },
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "rejections"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertRejection ${r.status}: ${await r.text()}`);
}

/** S6b review page: ConfirmBookingRow + quote_lines for the editable breakdown. */
export interface ReviewBookingRow extends ConfirmBookingRow {
  quote_lines: Array<{ label: string; amount: number }>;
}

const REVIEW_COLS = CONFIRM_COLS + ",quote_lines";

export async function getBookingByTokenHashForReview(
  env: DbEnv,
  hash: string,
  f: typeof fetch = fetch,
): Promise<ReviewBookingRow | null> {
  const r = await f(
    rest(env, `bookings?confirm_token_hash=eq.${encodeURIComponent(hash)}&select=${REVIEW_COLS}`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`getBookingByTokenHashForReview ${r.status}`);
  const rows = (await r.json()) as ReviewBookingRow[];
  return rows.length ? rows[0]! : null;
}

/** Check if a date is blocked by admin (S6 availability gate). */
export async function isDateBlocked(
  env: DbEnv,
  date: string, // "YYYY-MM-DD"
  f: typeof fetch = fetch,
): Promise<boolean> {
  const r = await f(rest(env, `blocked_dates?date=eq.${encodeURIComponent(date)}&select=date&limit=1`), {
    headers: headers(env),
  });
  if (!r.ok) throw new Error(`isDateBlocked ${r.status}`);
  const rows = (await r.json()) as Array<{ date: string }>;
  return rows.length > 0;
}

/** S9: invoice page needs quote_lines + all confirm fields. */
export async function getBookingByIdForInvoice(
  env: DbEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<(ConfirmBookingRow & { quote_lines: Array<{ label: string; amount: number }> }) | null> {
  const cols = CONFIRM_COLS + ",quote_lines";
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&select=${cols}`), { headers: headers(env) });
  if (!r.ok) throw new Error(`getBookingByIdForInvoice ${r.status}`);
  const rows = (await r.json()) as Array<ConfirmBookingRow & { quote_lines: Array<{ label: string; amount: number }> }>;
  return rows.length ? rows[0]! : null;
}

// ── Wave ID updaters (S8) ─────────────────────────────────────────────────────

/** Store Wave customer + invoice IDs on a booking after Wave invoice is created. */
export async function updateBookingWaveIds(
  env: DbEnv,
  id: string,
  waveCustomerId: string,
  waveInvoiceId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ wave_customer_id: waveCustomerId, wave_invoice_id: waveInvoiceId }),
  });
  if (!r.ok) throw new Error(`updateBookingWaveIds ${r.status}: ${await r.text()}`);
}

/** Store Wave payment/transaction ID on a payment row after Wave payment is recorded. */
export async function updatePaymentWaveId(
  env: DbEnv,
  paymentRowId: string,
  wavePaymentId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `payments?id=eq.${encodeURIComponent(paymentRowId)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ wave_payment_id: wavePaymentId }),
  });
  if (!r.ok) throw new Error(`updatePaymentWaveId ${r.status}: ${await r.text()}`);
}

// ── Blocked dates admin (S8) ──────────────────────────────────────────────────

/** List all blocked dates sorted ascending — for the admin UI. */
export async function listBlockedDates(
  env: DbEnv,
  f: typeof fetch = fetch,
): Promise<Array<{ date: string; reason: string | null }>> {
  const r = await f(rest(env, "blocked_dates?select=date,reason&order=date.asc"), {
    headers: headers(env),
  });
  if (!r.ok) throw new Error(`listBlockedDates ${r.status}`);
  return r.json() as Promise<Array<{ date: string; reason: string | null }>>;
}

/** Add a date to the blocked_dates table. Ignores duplicate (upsert on PK). */
export async function addBlockedDate(
  env: DbEnv,
  date: string,
  reason: string | null,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "blocked_dates?on_conflict=date"), {
    method: "POST",
    headers: { ...headers(env), prefer: "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify({ date, reason }),
  });
  if (!r.ok) throw new Error(`addBlockedDate ${r.status}: ${await r.text()}`);
}

/** Remove a date from blocked_dates. No-op if not present. */
export async function removeBlockedDate(
  env: DbEnv,
  date: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `blocked_dates?date=eq.${encodeURIComponent(date)}`), {
    method: "DELETE",
    headers: { ...headers(env), prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`removeBlockedDate ${r.status}: ${await r.text()}`);
}

/** Bookings due a balance reminder: deposit_paid, not yet reminded, real balance, wedding within window. */
export async function listBookingsDueForBalanceReminder(
  env: DbEnv,
  todayYMD: string,
  windowEndYMD: string,
  f: typeof fetch = fetch,
): Promise<Array<ConfirmBookingRow & { balance_reminder_sent_at: string | null }>> {
  const q =
    `bookings?status=eq.deposit_paid&balance_reminder_sent_at=is.null&balance_net_cents=gt.0` +
    `&wedding_date=gte.${todayYMD}&wedding_date=lte.${windowEndYMD}` +
    `&select=${CONFIRM_COLS},balance_reminder_sent_at`;
  const r = await f(rest(env, q), { headers: headers(env) });
  if (!r.ok) throw new Error(`listBookingsDueForBalanceReminder ${r.status}`);
  return (await r.json()) as Array<ConfirmBookingRow & { balance_reminder_sent_at: string | null }>;
}
