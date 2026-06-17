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
import { getBookingById, transitionBooking, listBookingsDueForBalanceReminder, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { signActionToken, verifyActionToken } from "./token";
import { workingDaysBefore } from "./util";
import { recordPayment, type WaveEnv } from "../lib/wave";

export interface BookingBalanceEnv extends AuditEnv, WaveEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  EFT_BANK: string;
  EFT_ACCOUNT_NAME: string;
  EFT_ACCOUNT_NO: string;
  EFT_BRANCH_CODE: string;
}

const BALANCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

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

async function brevoEmail(
  env: BookingBalanceEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." },
      to: [to], subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

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
<tr><td class="k">Balance</td><td><strong>${zar(b.balance_net_cents)}</strong></td></tr>
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
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>🎉 Your balance is in — <strong>${esc(b.wedding_date)}</strong> is fully paid and all set. We can't wait to be part of your day.</p>
<p>We've received your balance of <strong>${zar(b.balance_net_cents)}</strong> (ref ${esc(b.reference)}). Nothing further is needed from you.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
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
    await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
      "You're all set — fully paid 🎉 · Lustique Co.", fullyPaidEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(balanceRecordedHtml(b));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function balanceReminderEmailHtml(env: BookingBalanceEnv, b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Your wedding on <strong>${esc(b.wedding_date)}</strong> is coming up — your remaining balance of <strong>${zar(b.balance_net_cents)}</strong> is now due. Please pay by EFT using the details below.</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Balance due</td><td><strong>${zar(b.balance_net_cents)}</strong></td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(env.EFT_BANK)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(env.EFT_ACCOUNT_NAME)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(env.EFT_ACCOUNT_NO)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(env.EFT_BRANCH_CODE)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(b.reference)}</strong> as your reference so we can match the payment. Once it reflects we'll send your all-paid confirmation.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function balanceAdminEmailHtml(b: ConfirmBookingRow, markUrl: string): string {
  return `<p><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — balance reminder sent. She owes <strong>${zar(b.balance_net_cents)}</strong> (ref <strong>${esc(b.reference)}</strong>) by EFT.</p>
<p style="margin:1.2rem 0;"><a href="${esc(markUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the balance lands — mark received &amp; complete her booking</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the money reflects. This completes the booking and emails her the all-paid confirmation. Link valid 90 days.</p>`;
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
  for (const b of due) {
    try {
      const token = await signActionToken(b.id, new Date(today.getTime() + BALANCE_TTL_MS), env.SIGNING_SECRET, "balance");
      const markUrl = `${origin}/api/booking/mark-balance-paid?token=${encodeURIComponent(token)}`;
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "Your balance is due — Lustique Co.", balanceReminderEmailHtml(env, b), fetchImpl);
      await brevoEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" },
        `Balance reminder sent · ${b.bride_name} · ${b.wedding_date}`, balanceAdminEmailHtml(b, markUrl), fetchImpl);
      const stamped = await transitionBooking(env, b.id, "deposit_paid", { balance_reminder_sent_at: today.toISOString() }, fetchImpl);
      if (stamped) {
        await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.sent", payload: { reference: b.reference, balanceNetCents: b.balance_net_cents } }, fetchImpl);
      }
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }
}
