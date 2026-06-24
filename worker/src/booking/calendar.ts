import type { DbEnv } from "./db";
import { rest, headers } from "./db";

export interface CalendarEnv extends DbEnv {
  ICAL_KEY?: string;
}

interface CalBooking {
  reference: string;
  bride_name: string;
  wedding_date: string; // "YYYY-MM-DD"
  town: string | null;
  venue: string | null;
  party_size: number;
  updated_at: string;
}

export async function listActiveBookingsForCalendar(
  env: DbEnv,
  f: typeof fetch = fetch,
): Promise<CalBooking[]> {
  // Only include paid/confirmed bookings in the ical feed — the date is truly locked in.
  // Pending bookings (requested/quote_sent/accepted) are visible in the admin calendar only.
  const url =
    rest(env, "bookings") +
    `?select=reference,bride_name,wedding_date,town,venue,party_size,updated_at` +
    `&status=in.(deposit_paid,settled)` +
    `&order=wedding_date.asc`;
  const r = await f(url, { headers: headers(env) });
  if (!r.ok) throw new Error(`listActiveBookingsForCalendar ${r.status}`);
  return (await r.json()) as CalBooking[];
}

/** RFC 5545 line-folding: lines over 75 octets are split at 74 + CRLF + space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const chars = [...line];
  const out: string[] = [];
  let current = "";
  for (const ch of chars) {
    const next = current + ch;
    if (enc.encode(next).length > 74) {
      out.push(current);
      current = " " + ch;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out.join("\r\n");
}

/** Escape special characters in iCal text values (RFC 5545 §3.3.11). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Advance a YYYY-MM-DD date string by one day (for DTEND of all-day events). */
function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function toICalDate(date: string): string {
  return date.replace(/-/g, "");
}

/** Convert an ISO timestamp to iCal DTSTAMP format (YYYYMMDDTHHmmssZ). */
function toDtstamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "T");
}

export function generateIcal(bookings: CalBooking[], now: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lustique Co.//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lustique Co. — Bookings",
    "X-WR-TIMEZONE:Africa/Johannesburg",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];

  for (const b of bookings) {
    const summary = `${esc(b.bride_name)} — ${esc(b.reference)}`;
    const locationParts = [b.venue, b.town].filter(Boolean).map((s) => esc(s!));
    const desc = [
      `Party size: ${b.party_size}`,
      b.venue ? `Venue: ${esc(b.venue)}` : null,
      b.town ? `Town: ${esc(b.town)}` : null,
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${esc(b.reference)}@lustiqueco.co.za`);
    lines.push(`DTSTAMP:${toDtstamp(now)}`);
    lines.push(`DTSTART;VALUE=DATE:${toICalDate(b.wedding_date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(b.wedding_date)}`);
    lines.push(`SUMMARY:${summary}`);
    if (locationParts.length) lines.push(`LOCATION:${locationParts.join(", ")}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);
    lines.push(`LAST-MODIFIED:${toDtstamp(b.updated_at)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export async function handleCalendarFeed(
  req: Request,
  env: CalendarEnv,
  f: typeof fetch = fetch,
  nowFn: () => string = () => new Date().toISOString(),
): Promise<Response> {
  const key = new URL(req.url).searchParams.get("key");

  if (!env.ICAL_KEY || key !== env.ICAL_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const bookings = await listActiveBookingsForCalendar(env, f);
  const ical = generateIcal(bookings, nowFn());

  return new Response(ical, {
    status: 200,
    headers: {
      "content-type": "text/calendar;charset=UTF-8",
      "content-disposition": 'attachment; filename="lustique-bookings.ics"',
      // Allow clients to cache for 12h — matches REFRESH-INTERVAL in the feed
      "cache-control": "private, max-age=43200",
    },
  });
}
