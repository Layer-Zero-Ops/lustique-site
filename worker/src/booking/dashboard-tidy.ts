// worker/src/booking/dashboard-tidy.ts
// Phase 7 — Aria's dashboard tidy worker (the "keeps it clean" assistant).
// Pure decision logic so it is TDD-able. The Worker calls these to decide what
// to soft-archive and what to flag for human attention.

export interface TidyEnquiry {
  id: string;
  status: string;
  created_at: string;
  deleted_at: string | null;
  flagged_review?: boolean; // has an enquiry_review notification (captcha failed)
}

export interface TidyBooking {
  id: string;
  status: string;
  wedding_date: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface TidyPlan {
  archive_enquiry_ids: string[]; // resolved + old + not flagged
  archive_booking_ids: string[]; // past-client + old + not archived
  flag_ids: string[]; // needs human attention (captcha-failed, still unresolved old)
  summary: string;
}

export interface TidyOptions {
  archiveAfterDays?: number; // default 120
  now?: number;
}

/**
 * Decide which enquiries to soft-archive.
 * Archive when: resolved (converted/closed/declined) AND older than archiveAfterDays
 * AND not flagged for review AND not already deleted.
 * Flag (human attention) when: flagged_review AND still not converted after 7d.
 */
export function planEnquiryTidy(rows: TidyEnquiry[], opts: TidyOptions = {}): { archive: string[]; flag: string[] } {
  const days = opts.archiveAfterDays ?? 120;
  const now = opts.now ?? Date.now();
  const cutoff = now - days * 86400000;
  const archive: string[] = [];
  const flag: string[] = [];
  for (const r of rows) {
    if (r.deleted_at) continue;
    const age = new Date(r.created_at).getTime();
    const resolved = ["converted", "closed", "declined"].includes(r.status);
    if (r.flagged_review && !resolved && now - age > 7 * 86400000) {
      flag.push(r.id);
      continue;
    }
    if (resolved && age < cutoff) archive.push(r.id);
  }
  return { archive, flag };
}

/**
 * Decide which bookings to soft-archive: past-client (settled) AND older than cutoff
 * AND not already archived/deleted.
 */
export function planBookingTidy(rows: TidyBooking[], opts: TidyOptions = {}): string[] {
  const days = opts.archiveAfterDays ?? 120;
  const now = opts.now ?? Date.now();
  const cutoff = now - days * 86400000;
  const out: string[] = [];
  for (const r of rows) {
    if (r.archived_at || r.deleted_at) continue;
    if (r.status === "settled" && new Date(r.wedding_date).getTime() < cutoff) out.push(r.id);
  }
  return out;
}

export function buildTidyPlan(enquiries: TidyEnquiry[], bookings: TidyBooking[], opts: TidyOptions = {}): TidyPlan {
  const e = planEnquiryTidy(enquiries, opts);
  const b = planBookingTidy(bookings, opts);
  const summary =
    `Dashboard tidy: ${e.archive.length} enquiry(s) + ${b.length} booking(s) archived` +
    (e.flag.length ? `; ${e.flag.length} flagged for review` : ".");
  return { archive_enquiry_ids: e.archive, archive_booking_ids: b, flag_ids: e.flag, summary };
}

/** Execute a tidy plan: soft-archive the picked enquiries + bookings. Returns the summary. */
export async function runTidy(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  plan: TidyPlan,
  f: typeof fetch = fetch,
): Promise<string> {
  const hdr = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" };
  for (const id of plan.archive_enquiry_ids) {
    await f(`${env.SUPABASE_URL}/rest/v1/enquiries?id=eq.${id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ archived_at: new Date().toISOString() }) });
  }
  for (const id of plan.archive_booking_ids) {
    await f(`${env.SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ archived_at: new Date().toISOString() }) });
  }
  return plan.summary;
}
