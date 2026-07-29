// worker/src/booking/calendar.ts

import { esc, fmtDate } from "../lib/email";
import { signActionToken } from "./token";

// Storage key: "cal_<bookingId>"
export type CalendarEvent = {
  bookingId: string;
  reference: string;
  brideName: string;
  weddingDate: string;
  venue: string;
  town: string;
  province: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function calKey(bookingId: string): string {
  return `cal_${bookingId}`;
}

export async function createBookingCalendarEvent(
  env: unknown,
  booking: {
    id: string;
    reference: string;
    bride_name: string;
    wedding_date: string;
    venue: string;
    town: string;
    province: string;
    status: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const kv = (env as Record<string, unknown> | null)?.KV as
    | { get: (key: string) => Promise<string | null>; put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void> }
    | undefined;
  if (!kv) return false;

  const now = new Date().toISOString();
  let existing: CalendarEvent | null = null;
  try {
    const raw = await env.KV.get(calKey(String(booking.id)));
    if (raw) existing = JSON.parse(raw) as CalendarEvent;
  } catch {
    // stale/empty row — fall through to overwrite
  }

  const event: CalendarEvent = {
    bookingId: String(booking.id),
    reference: String(booking.reference),
    brideName: String(booking.bride_name),
    weddingDate: String(booking.wedding_date),
    venue: String(booking.venue),
    town: String(booking.town),
    province: String(booking.province),
    status: existing?.status ?? String(booking.status),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await env.KV.put(
    calKey(String(booking.id)),
    JSON.stringify(event),
    { expirationTtl: 60 * 60 * 24 * 366 }, // ~1 year retention
  );

  return true;
}

export async function getCalendarEvent(
  env: { KV?: { get: (key: string) => Promise<string | null> } },
  bookingId: string,
): Promise<CalendarEvent | null> {
  if (!env.KV) return null;
  try {
    const raw = await env.KV.get(calKey(bookingId));
    if (!raw) return null;
    return JSON.parse(raw) as CalendarEvent;
  } catch {
    return null;
  }
}

export function renderIcs(
  booking: {
    reference: string;
    bride_name: string;
    wedding_date: string;
    venue: string;
    town: string;
    province: string;
  },
  origin: string,
  portalToken: string,
): string {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const dtStart = String(booking.wedding_date).replace(/-/g, "");
  const uid = `${booking.reference}@lustiqueco.co.za`;
  const url = `${origin}/api/booking/portal?token=${encodeURIComponent(portalToken)}`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lustique Co//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtStart}`,
    `SUMMARY:Lustique booking · ${esc(booking.reference)} · ${esc(booking.bride_name)}`,
    `LOCATION:${esc(booking.venue + ", " + booking.town + ", " + booking.province)}`,
    `URL:${url}`,
    "DESCRIPTION:Wedding date secured with Lustique Co.",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function icsAttachment(
  booking: {
    reference: string;
    bride_name: string;
    wedding_date: string;
    venue: string;
    town: string;
    province: string;
  },
  origin: string,
  portalToken: string,
): { filename: string; mime: string; body: string } {
  const filename = `lustique-${String(booking.reference).replace(/[^a-zA-Z0-9-_]/g, "-")}.ics`;
  return {
    filename,
    mime: "text/calendar; charset=utf-8; method=REQUEST",
    body: renderIcs(booking, origin, portalToken),
  };
}

export async function handleCalendarFeed(
  req: Request,
  env: { ICAL_KEY?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_KEY?: string; SIGNING_SECRET?: string },
  f: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!key || key !== env.ICAL_KEY) return new Response("Not found", { status: 401 });

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return new Response("Not found", { status: 401 });

  const r = await f(
    `${env.SUPABASE_URL}/rest/v1/bookings?select=reference,bride_name,wedding_date,town,venue,party_size,updated_at&status=in.(deposit_paid,settled)&order=wedding_date.asc`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<{
    reference: string;
    bride_name: string;
    wedding_date: string;
    town: string | null;
    venue: string | null;
    party_size: number;
    updated_at: string;
    id: string;
  }>;

  const calendarLines = rows
    .map((booking) =>
      renderIcs(
        booking,
        url.origin,
        signActionToken({ bookingId: booking.id, kind: "portal" }, env.SIGNING_SECRET ?? "", 60 * 60),
      ),
    )
    .filter(Boolean);

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lustique Co//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
    ...calendarLines.flatMap((event) => event.split("\r\n")),
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=43200",
    },
  });
}
