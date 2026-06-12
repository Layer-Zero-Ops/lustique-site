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
  deposit_pct: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  confirm_token_expires_at: string;
  confirm_token_used_at: string | null;
}

const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at";

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

/**
 * Guarded transition: PATCH the booking only while it is still `requested`.
 * The `&status=eq.requested` filter makes this an atomic compare-and-set — if the
 * row has already moved on (double-submit, scanner, prior decline), 0 rows update
 * and we return null.
 */
export async function transitionRequestedBooking(
  env: DbEnv,
  id: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&status=eq.requested`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`transitionRequestedBooking ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}

/** Daily keep-warm: a tiny read resets the free-tier 7-day pause clock (spec §2). */
export async function keepWarm(env: DbEnv, f: typeof fetch = fetch): Promise<void> {
  await f(rest(env, "bookings?select=id&limit=1"), { headers: headers(env) });
}

/**
 * Count active bookings (not expired/declined/cancelled) on a given wedding date.
 * Used for the same-date warning in Zandeline's confirm email (spec §10).
 * PostgREST aggregate: select=count() returns [{ count: "N" }].
 */
export async function countBookingsOnDate(
  env: DbEnv,
  weddingDate: string, // "YYYY-MM-DD"
  f: typeof fetch = fetch,
): Promise<number> {
  const r = await f(
    rest(
      env,
      `bookings?select=count()&wedding_date=eq.${encodeURIComponent(weddingDate)}&status=not.in.(expired,declined,cancelled)`,
    ),
    { headers: headers(env) },
  );
  if (!r.ok) throw new Error(`countBookingsOnDate ${r.status}`);
  const rows = (await r.json()) as Array<{ count: string }>;
  return parseInt(rows[0]?.count ?? "0", 10);
}
