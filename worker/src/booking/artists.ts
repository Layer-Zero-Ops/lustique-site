// worker/src/booking/artists.ts
// Wave D4 — Artist allocation handlers + db helpers.
// Uses a local ArtistsHandlerEnv to avoid circular import with dashboard.ts.

import { getAdminSession, loginRedirect, type AuthEnv } from "./auth";
import { writeAudit } from "./audit";

// ── Local env interface — no import from dashboard.ts ────────────────────────

interface ArtistsHandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ArtistRow {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  specialisms: string[];
}

export interface BookingArtistRow {
  id: string;
  booking_id: string;
  artist_id: string;
  lead: boolean;
  confirmed_at: string | null;
  created_at: string;
  artists: { name: string; email: string | null };
}

// ── PostgREST helpers ─────────────────────────────────────────────────────────

function rest(env: ArtistsHandlerEnv, path: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${path}`;
}

function svcHeaders(env: ArtistsHandlerEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function listArtists(
  env: ArtistsHandlerEnv,
  f: typeof fetch = fetch,
): Promise<ArtistRow[]> {
  const r = await f(
    rest(env, "artists?active=eq.true&select=id,name,email,active,specialisms"),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`listArtists ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as ArtistRow[];
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export async function listBookingArtists(
  env: ArtistsHandlerEnv,
  bookingId: string,
  f: typeof fetch = fetch,
): Promise<BookingArtistRow[]> {
  const r = await f(
    rest(
      env,
      `booking_artists?booking_id=eq.${encodeURIComponent(bookingId)}&select=id,booking_id,artist_id,lead,confirmed_at,created_at,artists(name,email)&order=lead.desc`,
    ),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`listBookingArtists ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as BookingArtistRow[];
  return rows.sort((a, b) => {
    if (a.lead !== b.lead) return a.lead ? -1 : 1;
    return a.artists.name.localeCompare(b.artists.name, "en");
  });
}

async function insertBookingArtist(
  env: ArtistsHandlerEnv,
  bookingId: string,
  artistId: string,
  lead: boolean,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "booking_artists"), {
    method: "POST",
    headers: { ...svcHeaders(env), prefer: "return=minimal" },
    body: JSON.stringify({ booking_id: bookingId, artist_id: artistId, lead }),
  });
  if (!r.ok) throw new Error(`insertBookingArtist ${r.status}: ${await r.text()}`);
}

async function deleteBookingArtist(
  env: ArtistsHandlerEnv,
  bookingId: string,
  artistId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(
    rest(
      env,
      `booking_artists?booking_id=eq.${encodeURIComponent(bookingId)}&artist_id=eq.${encodeURIComponent(artistId)}`,
    ),
    {
      method: "DELETE",
      headers: { ...svcHeaders(env), prefer: "return=minimal" },
    },
  );
  if (!r.ok) throw new Error(`deleteBookingArtist ${r.status}: ${await r.text()}`);
}

async function getBookingStatus(
  env: ArtistsHandlerEnv,
  bookingId: string,
  f: typeof fetch = fetch,
): Promise<{ id: string; status: string } | null> {
  const r = await f(
    rest(env, `bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,status&limit=1`),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`getBookingStatus ${r.status}`);
  const rows = (await r.json()) as Array<{ id: string; status: string }>;
  return rows.length ? rows[0]! : null;
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

const ASSIGNABLE_STATUSES = ["quote_sent", "accepted", "deposit_paid", "settled"];

function errorRedirect(bookingId: string, message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/api/admin/booking/${encodeURIComponent(bookingId)}?error=${encodeURIComponent(message)}`,
    },
  });
}

function successRedirect(bookingId: string, returnTo?: string): Response {
  const dest =
    returnTo && returnTo.startsWith("/api/admin/")
      ? returnTo
      : `/api/admin/booking/${encodeURIComponent(bookingId)}?saved=1`;
  return new Response(null, { status: 302, headers: { Location: dest } });
}

function errorRedirectTo(bookingId: string, message: string, returnTo?: string): Response {
  const base =
    returnTo && returnTo.startsWith("/api/admin/")
      ? returnTo
      : `/api/admin/booking/${encodeURIComponent(bookingId)}`;
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}?error=${encodeURIComponent(message)}` },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAssignArtist(
  req: Request,
  env: ArtistsHandlerEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  const user = await getAdminSession(req, authEnv, fetchFn);
  if (!user) return loginRedirect();

  let artistId: string;
  let lead: boolean;
  let returnTo: string | undefined;
  try {
    const fd = await req.formData();
    artistId = ((fd.get("artist_id") as string | null) ?? "").trim();
    const leadRaw = ((fd.get("lead") as string | null) ?? "false").trim();
    lead = leadRaw === "true";
    returnTo = (fd.get("returnTo") as string | null) ?? undefined;
  } catch {
    return errorRedirect(bookingId, "Invalid form data");
  }

  if (!artistId) return errorRedirectTo(bookingId, "Missing artist_id", returnTo);
  if (!UUID_RE.test(artistId)) return errorRedirectTo(bookingId, "Invalid artist_id", returnTo);

  let booking: { id: string; status: string } | null;
  try {
    booking = await getBookingStatus(env, bookingId, fetchFn);
  } catch {
    return errorRedirectTo(bookingId, "Could not fetch booking", returnTo);
  }
  if (!booking) return errorRedirectTo(bookingId, "Booking not found", returnTo);
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    return errorRedirectTo(bookingId, `Cannot assign artists when status is ${booking.status}`, returnTo);
  }

  try {
    await insertBookingArtist(env, bookingId, artistId, lead, fetchFn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    return errorRedirectTo(
      bookingId,
      msg.includes("23505") || msg.includes("duplicate") ? "Artist already assigned" : "Assignment failed",
      returnTo,
    );
  }

  await writeAudit(
    env,
    { bookingId, eventType: "artist_assigned", payload: { artistId, lead, assignedBy: user.email } },
    fetchFn,
  );

  return successRedirect(bookingId, returnTo);
}

export async function handleRemoveArtist(
  req: Request,
  env: ArtistsHandlerEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  const user = await getAdminSession(req, authEnv, fetchFn);
  if (!user) return loginRedirect();

  let artistId: string;
  let returnTo: string | undefined;
  try {
    const fd = await req.formData();
    artistId = ((fd.get("artist_id") as string | null) ?? "").trim();
    returnTo = (fd.get("returnTo") as string | null) ?? undefined;
  } catch {
    return errorRedirect(bookingId, "Invalid form data");
  }

  if (!artistId) return errorRedirectTo(bookingId, "Missing artist_id", returnTo);
  if (!UUID_RE.test(artistId)) return errorRedirectTo(bookingId, "Invalid artist_id", returnTo);

  let booking: { id: string; status: string } | null;
  try {
    booking = await getBookingStatus(env, bookingId, fetchFn);
  } catch {
    return errorRedirectTo(bookingId, "Could not fetch booking", returnTo);
  }
  if (!booking) return errorRedirectTo(bookingId, "Booking not found", returnTo);
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    return errorRedirectTo(bookingId, `Cannot remove artists when status is ${booking.status}`, returnTo);
  }

  try {
    await deleteBookingArtist(env, bookingId, artistId, fetchFn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return errorRedirectTo(bookingId, msg, returnTo);
  }

  await writeAudit(
    env,
    { bookingId, eventType: "artist_removed", payload: { artistId, removedBy: user.email } },
    fetchFn,
  );

  return successRedirect(bookingId, returnTo);
}
