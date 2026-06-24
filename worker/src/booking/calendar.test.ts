import { describe, it, expect, vi } from "vitest";
import { generateIcal, handleCalendarFeed, listActiveBookingsForCalendar } from "./calendar";

const FAKE_NOW = "2026-06-22T10:00:00.000Z";

const booking = {
  reference: "LUS-2026-AAA111",
  bride_name: "Anke van der Berg",
  wedding_date: "2026-11-14",
  town: "Hartbeespoort",
  venue: "Red Ivory",
  party_size: 4,
  updated_at: "2026-06-20T08:00:00.000Z",
};

const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  ICAL_KEY: "secret-ical-key",
};

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ── generateIcal ─────────────────────────────────────────────────────────────

describe("generateIcal", () => {
  it("produces valid iCal envelope", () => {
    const out = generateIcal([], FAKE_NOW);
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).toContain("END:VCALENDAR");
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("CALSCALE:GREGORIAN");
  });

  it("uses CRLF line endings", () => {
    const out = generateIcal([], FAKE_NOW);
    expect(out).toContain("\r\n");
    expect(out.split("\r\n").length).toBeGreaterThan(1);
  });

  it("emits one VEVENT per booking with correct fields", () => {
    const out = generateIcal([booking], FAKE_NOW);
    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toContain("END:VEVENT");
    expect(out).toContain("UID:LUS-2026-AAA111@lustiqueco.co.za");
    expect(out).toContain("DTSTART;VALUE=DATE:20261114");
    expect(out).toContain("DTEND;VALUE=DATE:20261115");
    expect(out).toContain("SUMMARY:Anke van der Berg — LUS-2026-AAA111");
    expect(out).toContain("LOCATION:Red Ivory, Hartbeespoort");
    expect(out).toContain("Party size: 4");
  });

  it("sets DTEND to the day after DTSTART (all-day event convention)", () => {
    const eoy = generateIcal([{ ...booking, wedding_date: "2026-12-31" }], FAKE_NOW);
    expect(eoy).toContain("DTSTART;VALUE=DATE:20261231");
    expect(eoy).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("emits DTSTAMP using the provided now value", () => {
    const out = generateIcal([booking], FAKE_NOW);
    expect(out).toContain("DTSTAMP:20260622T100000Z");
  });

  it("handles bookings with no venue or town gracefully", () => {
    const minimal = { ...booking, venue: null, town: null };
    const out = generateIcal([minimal], FAKE_NOW);
    expect(out).not.toContain("LOCATION:");
    expect(out).toContain("BEGIN:VEVENT");
  });

  it("escapes special characters in bride name and venue", () => {
    const tricky = { ...booking, bride_name: "O'Brien, Lisa; test\\path", venue: null, town: null };
    const out = generateIcal([tricky], FAKE_NOW);
    // Commas and semicolons must be escaped in iCal text values
    expect(out).toContain("O'Brien\\, Lisa\\; test\\\\path");
  });

  it("emits correct REFRESH-INTERVAL header", () => {
    const out = generateIcal([], FAKE_NOW);
    expect(out).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H");
    expect(out).toContain("X-PUBLISHED-TTL:PT12H");
  });
});

// ── listActiveBookingsForCalendar ─────────────────────────────────────────────

describe("listActiveBookingsForCalendar", () => {
  it("queries only confirmed (deposit_paid/settled) bookings ordered by wedding_date", async () => {
    const f = vi.fn().mockResolvedValue(res([booking]));
    const rows = await listActiveBookingsForCalendar(env, f as unknown as typeof fetch);
    expect(rows).toHaveLength(1);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("status=in.(deposit_paid,settled)");
    expect(url).toContain("order=wedding_date.asc");
    expect(url).toContain("select=reference,bride_name,wedding_date,town,venue,party_size,updated_at");
  });

  it("returns empty array when no active bookings exist", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    const rows = await listActiveBookingsForCalendar(env, f as unknown as typeof fetch);
    expect(rows).toHaveLength(0);
  });

  it("throws on non-OK response", async () => {
    const f = vi.fn().mockResolvedValue(res({ message: "boom" }, 500));
    await expect(listActiveBookingsForCalendar(env, f as unknown as typeof fetch)).rejects.toThrow("500");
  });
});

// ── handleCalendarFeed ────────────────────────────────────────────────────────

describe("handleCalendarFeed", () => {
  const getReq = (path: string) => new Request(`https://worker${path}`);
  const nowFn = () => FAKE_NOW;

  it("returns 401 when no key is provided", async () => {
    const f = vi.fn();
    const r = await handleCalendarFeed(getReq("/api/calendar.ics"), env, f as unknown as typeof fetch, nowFn);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 401 when key is wrong", async () => {
    const f = vi.fn();
    const r = await handleCalendarFeed(getReq("/api/calendar.ics?key=wrong"), env, f as unknown as typeof fetch, nowFn);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 401 when ICAL_KEY is not configured", async () => {
    const f = vi.fn();
    const noKey = { ...env, ICAL_KEY: undefined };
    const r = await handleCalendarFeed(getReq("/api/calendar.ics?key=secret-ical-key"), noKey, f as unknown as typeof fetch, nowFn);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 200 iCal with correct content-type on valid key", async () => {
    const f = vi.fn().mockResolvedValue(res([booking]));
    const r = await handleCalendarFeed(getReq("/api/calendar.ics?key=secret-ical-key"), env, f as unknown as typeof fetch, nowFn);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/calendar");
    const body = await r.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("LUS-2026-AAA111");
  });

  it("sets cache-control to 12h private", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    const r = await handleCalendarFeed(getReq("/api/calendar.ics?key=secret-ical-key"), env, f as unknown as typeof fetch, nowFn);
    expect(r.headers.get("cache-control")).toContain("max-age=43200");
  });
});
