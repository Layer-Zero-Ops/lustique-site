import { esc } from "../lib/email";
import { signActionToken } from "./token";

// ── helpers ──────────────────────────────────────────────────────────────────

function calKey(bookingId: string): string {
  return `cal_${bookingId}`;
}

function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[,;]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

// ── iCal generation ──────────────────────────────────────────────────────────

export function generateIcal(
  bookings: Array<{
    reference: string;
    bride_name: string;
    wedding_date: string;
    venue: string | null;
    town: string | null;
    party_size?: number;
  }>,
  now: string,
): string {
  const events = bookings
    .map((b) => {
      const dtStart = String(b.wedding_date).replace(/-/g, "");
      const uid = `${b.reference}@lustiqueco.co.za`;
      const location = b.venue && b.town ? `${b.venue}, ${b.town}` : undefined;
      const description = b.party_size ? `Party size: ${b.party_size}` : undefined;
      const lines = [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now.replace(/[-:]/g, "").split(".")[0]}Z`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${addDays(dtStart, 1)}`,
        `SUMMARY:${escapeIcalText(`${b.bride_name} — ${b.reference}`)}`,
        "STATUS:CONFIRMED",
      ];
      if (location) lines.push(`LOCATION:${location.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "")}`);
      if (description) lines.push(`DESCRIPTION:${escapeIcalText(description)}`);
      lines.push("END:VEVENT");
      return lines.join("\r\n");
    })
    .filter(Boolean);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lustique Co//EN",
    "CALSCALE:GREGORIAN",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function addDays(dateStr: string, days: number): string {
  const normalized = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  const d = new Date(`${normalized}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// ── Supabase data fetch ──────────────────────────────────────────────────────

export async function listActiveBookingsForCalendar(
  env: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_KEY?: string;
  },
  f: typeof fetch = fetch,
): Promise<
  Array<{
    reference: string;
    bride_name: string;
    wedding_date: string;
    town: string | null;
    venue: string | null;
    party_size: number;
    updated_at: string;
    id: string;
  }>
> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return [];
  }

  const url = `${env.SUPABASE_URL}/rest/v1/bookings?select=reference,bride_name,wedding_date,town,venue,party_size,updated_at&status=in.(deposit_paid,settled)&order=wedding_date.asc`;
  const r = await f(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status}: ${text}`);
  }

  return (await r.json()) as Array<{
    reference: string;
    bride_name: string;
    wedding_date: string;
    town: string | null;
    venue: string | null;
    party_size: number;
    updated_at: string;
    id: string;
  }>;
}

// ── feed handler ─────────────────────────────────────────────────────────────

export async function handleCalendarFeed(
  req: Request,
  env: {
    ICAL_KEY?: string;
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_KEY?: string;
    SIGNING_SECRET?: string;
  },
  f: typeof fetch = fetch,
  nowFn = () => new Date().toISOString(),
): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";

  if (!key || key !== env.ICAL_KEY) return new Response("Not found", { status: 401 });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)
    return new Response("Not found", { status: 401 });

  const rows = await listActiveBookingsForCalendar(env, f);

  const now = nowFn();
  const dtStamp = typeof now === "string" ? now : new Date(now).toISOString();
  const dtStampIcal = dtStamp.replace(/[-:]/g, "").split(".")[0] + "Z";

  const calendarLines = await Promise.all(
    rows.map(async (booking) => {
      const portalToken = env.SIGNING_SECRET
        ? await signActionToken(
            booking.id,
            new Date(Date.now() + 60 * 60 * 1000),
            env.SIGNING_SECRET,
            "portal",
          )
        : null;

      const dtStart = String(booking.wedding_date).replace(/-/g, "");
      const dtEnd = addDays(dtStart, 1);
      const uid = `${booking.reference}@lustiqueco.co.za`;
      const location = booking.venue && booking.town ? `${booking.venue}, ${booking.town}` : undefined;
      const description = booking.party_size ? `Party size: ${booking.party_size}` : undefined;

      const lines = [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtStampIcal}`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:Lustique booking · ${escapeIcalText(booking.reference)} · ${escapeIcalText(booking.bride_name)}`,
        "STATUS:CONFIRMED",
      ];
      if (location) lines.push(`LOCATION:${escapeIcalText(location)}`);
      if (description) lines.push(`DESCRIPTION:${escapeIcalText(description)}`);
      lines.push("END:VEVENT");

      return lines.join("\r\n");
    }),
  ).then((events) => events.filter(Boolean));

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

// ── KV-backed calendar event store ───────────────────────────────────────────

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

export async function createBookingCalendarEvent(
  env: { KV?: { get: (key: string) => Promise<string | null>; put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void> } },
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
  if (!env.KV) return false;

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
    { expirationTtl: 60 * 60 * 24 * 366 },
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
