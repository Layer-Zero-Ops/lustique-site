/**
 * GET + POST /api/booking/mark-balance-paid — the balance-settle gate (S5).
 *
 * GET  = render-only page (Zandeline sees the balance + "Mark received" button).
 *        Prefetch-safe: no mutation on GET.
 * POST = verify token → guarded `deposit_paid → settled` → email bride → 200.
 *
 * balanceSweep() runs inside scheduled() — 14 working days before the wedding,
 * emails the bride her EFT balance details and sends Zandeline the mark-balance-paid link.
 */
import { getBookingById, transitionBooking, listBookingsDueForBalanceReminder, insertNotification, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { signActionToken, verifyActionToken } from "./token";
import { workingDaysBefore } from "./util";
import { recordPayment, type WaveEnv } from "../lib/wave";
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailNote, firstN, sendEmail, getEftSettings, type EftSettings } from "../lib/email";

export interface BookingBalanceEnv extends AuditEnv, WaveEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

const BALANCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:540px;margin:6vh auto;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 1rem;color:#8a3a52;}
table{border-collapse:collapse;margin:1rem 0;width:100%;}td{padding:4px 0;vertical-align:top;}
td.k{color:#8a7d72;white-space:nowrap;padding-right:14px;width:1%;}
.actions{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.6rem;}
button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:.75em 1.5em;cursor:pointer;}
.confirm{background:#8a3a52;color:#fff;}
.muted{color:#8a7d72;font-size:.9rem;}</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the most recent link from your email.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Balance links are valid for 90 days. Contact the bride directly if needed.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This booking has already been handled</h1><p>It's no longer in a pending balance state — there's nothing more to do here.</p>");

type Load = { ok: true; booking: ConfirmBookingRow } | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadDepositPaidBooking(env: BookingBalanceEnv, token: string, f: typeof fetch): Promise<Load> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "balance");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "deposit_paid") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

function markBalancePaidPageBody(b: ConfirmBookingRow, token: string): string {
  return `<h1>Record balance received</h1>
<p>Confirm you've received <strong>${esc(b.bride_name)}</strong>'s balance payment. This completes her booking and emails her the all-paid confirmation.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Balance</td><td><strong>${fmtZAR(b.balance_net_cents)}</strong></td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/mark-balance-paid"><input type="hidden" name="token" value="${esc(token)}"><button class="confirm" type="submit">Balance received — complete her booking</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">Only do this once the money reflects in the account.</p>`;
}

/** GET — render-only balance-received page. Never mutates (prefetch-safe). */
export async function renderMarkBalancePaidPage(
  env: BookingBalanceEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadDepositPaidBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Record balance", markBalancePaidPageBody(loaded.booking, token)));
}

const balanceRecordedHtml = (b: ConfirmBookingRow) =>
  pageShell("Balance recorded", `<h1>Balance recorded ✓</h1><p><strong>${esc(b.bride_name)}</strong>'s booking for <strong>${esc(b.wedding_date)}</strong> is now fully paid, and she's been emailed her all-paid confirmation. You can close this tab.</p>`);

function fullyPaidEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `All settled, ${esc(firstN(b.bride_name))}.`,
    body: ep(`Your balance is in — ${em(fmtDate(b.wedding_date))} is fully paid and we are ready for your day. There&#8217;s nothing more to do.`) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Balance received", val: fmtZAR(b.balance_net_cents), bold: true },
        { key: "Your reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll be in touch closer to your day with final details.`),
  });
}

/** POST — guarded deposit_paid→settled, email the bride "fully paid". */
export async function handleMarkBalancePaid(
  env: BookingBalanceEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return htmlResponse(invalidHtml(), 400);

  const loaded = await loadDepositPaidBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const updated = await transitionBooking(env, b.id, "deposit_paid", { status: "settled", settled_at: new Date().toISOString() }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  // S8: record balance payment in Wave (fire-and-forget).
  if (b.wave_invoice_id && env.WAVE_API_KEY && env.WAVE_BUSINESS_ID && env.WAVE_BANK_ACCOUNT_ID) {
    try {
      await recordPayment(
        env,
        b.wave_invoice_id,
        b.balance_net_cents,
        new Date().toISOString().slice(0, 10),
        `EFT balance · ${b.reference}`,
        fetchImpl,
      );
      await writeAudit(env, { bookingId: b.id, eventType: "wave.balance-recorded", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "wave.balance-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }

  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "All settled — fully paid · Lustique Co.", fullyPaidEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(balanceRecordedHtml(b));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function balanceReminderEmailHtml(eft: EftSettings, b: ConfirmBookingRow, dueDateIso: string): string {
  return emailShell({
    heading: `Your balance is due, ${esc(firstN(b.bride_name))}.`,
    body: ep(`Your wedding on ${em(fmtDate(b.wedding_date))} is almost here. Your balance is due by ${em(fmtDate(dueDateIso))} — please pay by EFT using the details below.`) +
      emailTable([
        { key: "Balance due", val: fmtZAR(b.balance_net_cents), bold: true },
        { key: "Due by", val: fmtDate(dueDateIso), bold: true },
        { key: "Bank", val: eft.bank },
        { key: "Account holder", val: eft.accountHolder },
        { key: "Account no.", val: eft.accountNumber },
        { key: "Branch code", val: eft.branchCode },
        { key: "Payment reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`Please use your payment reference above when making the EFT transfer. Non-payment by the due date results in automatic cancellation.`),
  });
}

function balanceAdminEmailHtml(b: ConfirmBookingRow, markUrl: string): string {
  return `<p style="font:14px/1.6 system-ui,sans-serif;"><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — balance reminder sent. She owes <strong>${fmtZAR(b.balance_net_cents)}</strong> (ref <strong>${esc(b.reference)}</strong>) by EFT.</p>
<p style="margin:1.2rem 0;"><a href="${esc(markUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the balance lands — mark received &amp; complete her booking</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the money reflects. Link valid 90 days.</p>`;
}

/** Daily cron sweep: find deposit_paid bookings due a balance reminder and send them. */
export async function balanceSweep(
  env: BookingBalanceEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<void> {
  const today = now();
  const windowEnd = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
  const origin = env.ALLOWED_ORIGIN || "";
  const candidates = await listBookingsDueForBalanceReminder(env, ymd(today), ymd(windowEnd), fetchImpl);
  const due = candidates.filter(
    (b) => workingDaysBefore(new Date(`${b.wedding_date}T00:00:00Z`), 14).getTime() <= today.getTime(),
  );
  const eft = due.length > 0 ? await getEftSettings(env, fetchImpl) : { bank: "", accountHolder: "", accountNumber: "", branchCode: "" };
  for (const b of due) {
    try {
      const dueDateObj = workingDaysBefore(new Date(`${b.wedding_date}T00:00:00Z`), 14);
      const dueDateIso = ymd(dueDateObj);
      const token = await signActionToken(b.id, new Date(today.getTime() + BALANCE_TTL_MS), env.SIGNING_SECRET, "balance");
      const markUrl = `${origin}/api/booking/mark-balance-paid?token=${encodeURIComponent(token)}`;
      await sendEmail(env, { email: b.bride_email, name: b.bride_name },
        "Your balance is due — Lustique Co.", balanceReminderEmailHtml(eft, b, dueDateIso), fetchImpl);
      await sendEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" },
        `Balance reminder sent · ${b.bride_name} · ${b.wedding_date}`, balanceAdminEmailHtml(b, markUrl), fetchImpl);
      const stamped = await transitionBooking(env, b.id, "deposit_paid", { balance_reminder_sent_at: today.toISOString() }, fetchImpl);
      if (stamped) {
        await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.sent", payload: { reference: b.reference, balanceNetCents: b.balance_net_cents } }, fetchImpl);
        insertNotification(env, {
          type: "balance_due",
          title: `Balance due — ${b.bride_name}`,
          body: `${b.reference} · Wedding ${b.wedding_date}`,
          link: `/api/admin/booking/${b.id}`,
          booking_id: b.id,
          payload: { reference: b.reference, balanceNetCents: b.balance_net_cents },
        }, fetchImpl).catch(() => {});
      }
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }
}
