/**
 * reviewEmailSweep — daily cron: 48h after wedding_date, email the bride
 * a thank-you + Google review request (Email 8).
 */
import { listBookingsDueForReviewEmail, transitionBooking, type DbEnv } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { esc, fmtDate, ep, em, emailShell, emailBtn, emailNote, firstN, sendEmail } from "../lib/email";

export interface ReviewEmailEnv extends DbEnv, AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function getGoogleReviewUrl(env: DbEnv, f: typeof fetch): Promise<string> {
  const r = await f(
    `${env.SUPABASE_URL}/rest/v1/business_settings?key=eq.google_review_url&select=value`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`getGoogleReviewUrl ${r.status}`);
  const rows = (await r.json()) as Array<{ value: string }>;
  return rows[0]?.value ?? "";
}

function reviewEmailHtml(b: { bride_name: string; wedding_date: string }, googleUrl: string): string {
  return emailShell({
    preheader: `It was an honour to be there on ${fmtDate(b.wedding_date)} — a quick review would mean the world to us.`,
    heading: `Thank you, ${firstN(b.bride_name)}.`,
    body: ep(`It was an honour to be part of ${em(fmtDate(b.wedding_date))} — we hope your day was everything you dreamed of. If you have a moment, it would mean the world to us to hear about your experience.`) +
      ep(`Reviews help other brides find us, and every word of feedback helps us grow.`),
    btnZone: emailBtn(esc(googleUrl), "Leave us a Google review"),
    footerNote: emailNote("Only takes a minute — we truly appreciate it."),
  });
}

export async function reviewEmailSweep(
  env: ReviewEmailEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<void> {
  const today = now();
  // 48 h after wedding_date = bookings whose wedding_date < today - 1 day
  const cutoff = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const cutoffYMD = ymd(cutoff);

  const due = await listBookingsDueForReviewEmail(env, cutoffYMD, fetchImpl);
  if (due.length === 0) return;

  const googleUrl = await getGoogleReviewUrl(env, fetchImpl);

  for (const b of due) {
    try {
      await sendEmail(
        env,
        { email: b.bride_email, name: b.bride_name },
        "Thank you — we'd love your review · Lustique Co.",
        reviewEmailHtml(b, googleUrl),
        fetchImpl,
      );
      await transitionBooking(env, b.id, "settled", { review_email_sent_at: today.toISOString() }, fetchImpl);
      await writeAudit(env, { bookingId: b.id, eventType: "review.email.sent", payload: { reference: b.reference } }, fetchImpl);
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "review.email.failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }
}
