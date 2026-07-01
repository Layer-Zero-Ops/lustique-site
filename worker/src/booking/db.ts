/**
 * Supabase data-access via PostgREST + fetch — no SDK, matching the Worker's fetch-only style.
 * Keyed by secret-NAME env (SUPABASE_URL / SUPABASE_SERVICE_KEY) so the data home is a
 * deploy-time choice (spec §2). `fetch` is injectable for unit tests.
 */
export interface DbEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const rest = (env: DbEnv, path: string) => `${env.SUPABASE_URL}/rest/v1/${path}`;
export const headers = (env: DbEnv): HeadersInit => ({
  apikey: env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  "content-type": "application/json",
});

/** Read one business_settings value by key, or null if unset/unreadable. */
export async function getBusinessSetting(env: DbEnv, key: string, f: typeof fetch = fetch): Promise<string | null> {
  const r = await f(rest(env, `business_settings?key=eq.${encodeURIComponent(key)}&select=value`), { headers: headers(env) });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ value: string }>;
  return rows[0]?.value ?? null;
}

/** Upsert one business_settings key/value pair. */
export async function setBusinessSetting(env: DbEnv, key: string, value: string, f: typeof fetch = fetch): Promise<void> {
  const r = await f(rest(env, "business_settings?on_conflict=key"), {
    method: "POST",
    headers: { ...headers(env), prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`setBusinessSetting ${r.status}: ${await r.text()}`);
}

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
  quote_lines: Array<{ label: string; amount: number }> | null;
}

const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at,wave_customer_id,wave_invoice_id," +
  "quote_sent_at,accepted_at,quote_lines";

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
 * Uses Prefer:count=exact (portable across all PostgREST versions).
 * Count is returned in the Content-Range header as "first-last/total" or "* /total".
 */
export async function countBookingsOnDate(
  env: DbEnv,
  weddingDate: string, // "YYYY-MM-DD"
  f: typeof fetch = fetch,
): Promise<number> {
  const dead = "expired,declined,cancelled,rejected,invoice_expired";
  const r = await f(
    rest(env, `bookings?select=id&limit=0&wedding_date=eq.${encodeURIComponent(weddingDate)}&status=not.in.(${dead})`),
    { headers: { ...headers(env), Prefer: "count=exact" } },
  );
  if (!r.ok) throw new Error(`countBookingsOnDate ${r.status}`);
  const range = r.headers.get("content-range") ?? "";
  const total = parseInt(range.split("/")[1] ?? "0", 10);
  return isNaN(total) ? 0 : total;
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

/** S9: invoice page — quote_lines now included in CONFIRM_COLS. */
export async function getBookingByIdForInvoice(
  env: DbEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow | null> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&select=${CONFIRM_COLS}`), { headers: headers(env) });
  if (!r.ok) throw new Error(`getBookingByIdForInvoice ${r.status}`);
  const rows = (await r.json()) as ConfirmBookingRow[];
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

/** Upsert the slots capacity for a blocked_dates row (0 = hard-blocked, N = soft cap). */
export async function setBlockedDateSlots(
  env: DbEnv,
  date: string,
  slots: number,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "blocked_dates?on_conflict=date"), {
    method: "POST",
    headers: { ...headers(env), prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ date, slots }),
  });
  if (!r.ok) throw new Error(`setBlockedDateSlots ${r.status}: ${await r.text()}`);
}

/** Quote_sent bookings whose quote_sent_at is older than cutoffISO (7-day expiry sweep). */
export async function listExpiredQuotes(
  env: DbEnv,
  cutoffISO: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow[]> {
  const q = `bookings?status=eq.quote_sent&quote_sent_at=lt.${encodeURIComponent(cutoffISO)}&select=${CONFIRM_COLS}`;
  const r = await f(rest(env, q), { headers: headers(env) });
  if (!r.ok) throw new Error(`listExpiredQuotes ${r.status}`);
  return (await r.json()) as ConfirmBookingRow[];
}

/** All bookings for the accounting dashboard — every status, key financial columns. */
export async function listAccountingRows(
  env: DbEnv,
  f: typeof fetch = fetch,
): Promise<import("./accounting").AccountingRow[]> {
  const cols = [
    "id", "reference", "bride_name", "bride_email", "occasion", "wedding_date",
    "status", "total_cents", "deposit_net_cents", "balance_net_cents",
    "deposit_paid_at", "settled_at", "created_at",
  ].join(",");
  const r = await f(rest(env, `bookings?select=${cols}&order=wedding_date.asc`), { headers: headers(env) });
  if (!r.ok) throw new Error(`listAccountingRows ${r.status}`);
  return (await r.json()) as import("./accounting").AccountingRow[];
}

/** Bookings due a balance reminder: deposit_paid, not yet reminded, real balance, wedding within window. */
export async function listBookingsDueForReviewEmail(
  env: DbEnv,
  cutoffYMD: string,
  f: typeof fetch = fetch,
): Promise<Array<Pick<ConfirmBookingRow, "id" | "reference" | "bride_name" | "bride_email" | "wedding_date">>> {
  const q =
    `bookings?status=eq.settled&review_email_sent_at=is.null&wedding_date=lt.${cutoffYMD}` +
    `&select=id,reference,bride_name,bride_email,wedding_date`;
  const r = await f(rest(env, q), { headers: headers(env) });
  if (!r.ok) throw new Error(`listBookingsDueForReviewEmail ${r.status}`);
  return (await r.json()) as Array<Pick<ConfirmBookingRow, "id" | "reference" | "bride_name" | "bride_email" | "wedding_date">>;
}

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

export interface EnquiryRow {
  name: string;
  email: string;
  phone: string;
  occasion?: string;
  event_date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: unknown;
  ip?: string;
}

/** Persist a /api/enquiry submission so no lead is lost even if email delivery fails. */
export async function persistEnquiry(
  env: DbEnv,
  row: EnquiryRow,
  f: typeof fetch = fetch,
): Promise<{ id: string }> {
  const r = await f(rest(env, "enquiries?select=id"), {
    method: "POST",
    headers: { ...headers(env), prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`persistEnquiry ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<{ id: string }>;
  return rows[0]!;
}

export interface NotificationRow {
  type: string;
  title: string;
  body?: string;
  link: string;
  booking_id?: string;
  payload?: Record<string, unknown>;
}

/** Write a notification row — rings the admin dashboard bell (polled every 60s). */
export async function insertNotification(
  env: DbEnv,
  row: NotificationRow,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "notifications"), {
    method: "POST",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ recipient: "admin", payload: {}, ...row }),
  });
  if (!r.ok) throw new Error(`insertNotification ${r.status}: ${await r.text()}`);
}

export interface EnquiryCrmRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  occasion: string | null;
  event_date: string | null;
  town: string | null;
  estimate: string | null;
  message: string | null;
  details: unknown;
  status: string;
  notes: string | null;
  contacted_at: string | null;
  booking_id: string | null;
}

const ENQUIRY_COLS =
  "id,created_at,name,email,phone,occasion,event_date,town,estimate,message,details,status,notes,contacted_at,booking_id";

export async function listEnquiries(
  env: DbEnv,
  statusFilter: string | null = null,
  f: typeof fetch = fetch,
): Promise<EnquiryCrmRow[]> {
  let q = `enquiries?select=${ENQUIRY_COLS}&order=created_at.desc`;
  if (statusFilter) q += `&status=eq.${encodeURIComponent(statusFilter)}`;
  const r = await f(rest(env, q), { headers: headers(env) });
  if (!r.ok) throw new Error(`listEnquiries ${r.status}`);
  return (await r.json()) as EnquiryCrmRow[];
}

export async function getEnquiryById(
  env: DbEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<EnquiryCrmRow | null> {
  const r = await f(
    rest(env, `enquiries?id=eq.${encodeURIComponent(id)}&select=${ENQUIRY_COLS}`),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`getEnquiryById ${r.status}`);
  const rows = (await r.json()) as EnquiryCrmRow[];
  return rows[0] ?? null;
}

export async function updateEnquiry(
  env: DbEnv,
  id: string,
  patch: { status?: string; notes?: string; contacted_at?: string | null; booking_id?: string | null },
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `enquiries?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateEnquiry ${r.status}: ${await r.text()}`);
}
