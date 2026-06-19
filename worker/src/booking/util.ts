/** Pure booking helpers (no I/O) — easy to test, reused across the booking endpoints. */

/** Easter Sunday for a given year (Meeus/Jones/Butcher algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** SA public holidays for a given year as a Set of "YYYY-MM-DD" strings. */
function saHolidays(year: number): Set<string> {
  const fixed = [
    `${year}-01-01`, // New Year's Day
    `${year}-03-21`, // Human Rights Day
    `${year}-04-27`, // Freedom Day
    `${year}-05-01`, // Workers' Day
    `${year}-06-16`, // Youth Day
    `${year}-08-09`, // National Women's Day
    `${year}-09-24`, // Heritage Day
    `${year}-12-16`, // Day of Reconciliation
    `${year}-12-25`, // Christmas Day
    `${year}-12-26`, // Day of Goodwill
  ];
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * 86_400_000);
  const familyDay = new Date(easter.getTime() + 86_400_000);
  return new Set([...fixed, ymd(goodFriday), ymd(familyDay)]);
}

/**
 * The date `n` working days (Mon–Fri, excl. SA public holidays) before `from`.
 * Used for the balance-reminder lead time.
 */
export function workingDaysBefore(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let remaining = n;
  const cache = new Map<number, Set<string>>();
  const holidays = (year: number) => {
    if (!cache.has(year)) cache.set(year, saHolidays(year));
    return cache.get(year)!;
  };
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;                          // weekend
    if (holidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10))) continue; // public holiday
    remaining--;
  }
  return d;
}

/** Human booking reference from the uuid + year, e.g. LUS-2026-1A2B3C. Deterministic, quotable. */
export const makeReference = (id: string, year: number): string =>
  `LUS-${year}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
