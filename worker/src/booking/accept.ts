/**
 * GET + POST /api/booking/accept — bride's deposit selection + T3 transition (Wave A).
 *
 * GET  — render deposit-selection page (25 / 50 / 100%). Prefetch-safe: no mutations.
 * POST — verify accept token → T3 (quote_sent → accepted) → create Yoco checkout
 *         → insert pending payment row → redirect to Yoco checkout URL.
 *
 * On Yoco failure: redirect to EFT-fallback page (EFT details shown, Zandeline notified).
 * Token is HMAC-signed (purpose="accept"); booking status enforces idempotency.
 */
import { getBookingById, transitionBooking, insertPayment, type ConfirmBookingRow, type DbEnv } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyActionToken, signActionToken } from "./token";
import { splitDeposit } from "@lustique/pricing";

export interface BookingAcceptEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  YOCO_SECRET_KEY: string;
}

interface EftSettings {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
}

const MARK_PAID_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

type AcceptLoad =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadQuoteSentBooking(env: BookingAcceptEnv, token: string, f: typeof fetch): Promise<AcceptLoad> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "accept");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "quote_sent") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

async function getEftSettings(env: BookingAcceptEnv, f: typeof fetch): Promise<EftSettings> {
  const r = await f(
    `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`getEftSettings ${r.status}`);
  const rows = (await r.json()) as Array<{ key: string; value: string }>;
  const m = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  return {
    bankName: m["eft_bank_name"] ?? "",
    accountHolder: m["eft_account_holder"] ?? "",
    accountNumber: m["eft_account_number"] ?? "",
    branchCode: m["eft_branch_code"] ?? "",
  };
}

async function brevoEmail(
  env: BookingAcceptEnv,
  to: { email: string; name?: string },
  subject: string,
  html: string,
  f: typeof fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." }, to: [to], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:560px;margin:5vh auto 3rem;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 .4rem;color:#8a3a52;}
.sub{color:#8a7d72;font-size:.92rem;margin:0 0 1.6rem;}
.total{font-size:1.3rem;font-weight:700;color:#2b2b2b;margin:1.2rem 0 1.6rem;}
.deposit-options{display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.6rem;}
.deposit-opt{display:flex;align-items:flex-start;gap:.8rem;border:1.5px solid #c9bfb8;border-radius:10px;padding:.85rem 1rem;cursor:pointer;}
.deposit-opt:has(input:checked){border-color:#8a3a52;background:#fdf5f7;}
.deposit-opt input{margin-top:.2rem;accent-color:#8a3a52;}
.opt-label{font-weight:600;color:#2b2b2b;}
.opt-amt{font-size:.92rem;color:#6b5d52;}
.btn{display:block;width:100%;font:inherit;font-size:1rem;font-weight:600;border:0;border-radius:9px;padding:.9em;cursor:pointer;background:#8a3a52;color:#fff;margin-top:.4rem;}
.btn:hover{background:#7a3048;}
.muted{color:#8a7d72;font-size:.85rem;margin-top:1rem;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the link from your deposit invoice email, or contact info@lustiqueco.co.za.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Secure-date links are valid for 14 days. Please contact info@lustiqueco.co.za and we'll send a fresh one.</p>");
const handledHtml = () =>
  pageShell("Already accepted", "<h1>This booking has already been accepted</h1><p>Nothing more to do — we'll be in touch soon!</p>");

function acceptPageBody(b: ConfirmBookingRow, token: string): string {
  const total = b.total_cents;
  const dep25 = Math.round(total * 25 / 100);
  const dep50 = Math.round(total * 50 / 100);

  return `<h1>Secure your date</h1>
<p class="sub">We&#8217;re so excited to be part of your day! Choose your non-refundable booking fee to secure <strong>${esc(b.wedding_date)}</strong>.</p>
<p class="total">Your total: ${zar(total)}</p>
<form method="POST" action="/api/booking/accept">
<input type="hidden" name="token" value="${esc(token)}">
<div class="deposit-options">
  <label class="deposit-opt">
    <input type="radio" name="depositPct" value="25" required>
    <div><div class="opt-label">25% booking fee — ${zar(dep25)}</div><div class="opt-amt">Balance of ${zar(total - dep25)} payable closer to your day</div></div>
  </label>
  <label class="deposit-opt">
    <input type="radio" name="depositPct" value="50">
    <div><div class="opt-label">50% booking fee — ${zar(dep50)}</div><div class="opt-amt">Balance of ${zar(total - dep50)} payable closer to your day</div></div>
  </label>
  <label class="deposit-opt">
    <input type="radio" name="depositPct" value="100">
    <div><div class="opt-label">Pay in full — ${zar(total)}</div><div class="opt-amt">Nothing more to pay — all done ✓</div></div>
  </label>
</div>
<button class="btn" type="submit">Continue to payment →</button>
</form>
<p class="muted">Secure card payment via Yoco · EFT also accepted — details on the next page.</p>`;
}

/** GET — render deposit-selection page. Prefetch-safe: no mutations. */
export async function renderAcceptPage(
  env: BookingAcceptEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadQuoteSentBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Accept your booking", acceptPageBody(loaded.booking, token)));
}

/** POST — T3: quote_sent → accepted → Yoco checkout → redirect. */
export async function handleAccept(
  env: BookingAcceptEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const depositPctRaw = Number(form?.get("depositPct"));
  const origin = env.ALLOWED_ORIGIN || "";

  if (!token) return htmlResponse(invalidHtml(), 400);
  if (![25, 50, 100].includes(depositPctRaw)) {
    return htmlResponse(pageShell("Choose a booking fee", "<h1>Please choose a booking fee</h1><p>Go back and select 25%, 50%, or pay in full.</p>"), 400);
  }

  const depositPct = depositPctRaw as 25 | 50 | 100;
  const loaded = await loadQuoteSentBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const now = new Date().toISOString();
  const { depositNetCents, balanceNetCents } = splitDeposit(b.total_cents, depositPct);

  // T3: quote_sent → accepted (atomic; no-op if already moved on)
  const updated = await transitionBooking(env, b.id, "quote_sent", {
    status: "accepted",
    accepted_at: now,
    deposit_pct: depositPct,
    deposit_net_cents: depositNetCents,
    balance_net_cents: balanceNetCents,
  }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  await writeAudit(env, { bookingId: b.id, eventType: "accept.accepted", payload: { reference: b.reference, depositPct, depositNetCents } }, fetchImpl).catch(() => {});

  // Create Yoco checkout; on failure show EFT page.
  let yocoRedirectUrl = "";
  try {
    const r = await fetchImpl("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.YOCO_SECRET_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${b.id}-deposit`,
      },
      body: JSON.stringify({
        amount: depositNetCents,
        currency: "ZAR",
        successUrl: `${origin}/booking-deposit-paid.html?ref=${encodeURIComponent(b.reference)}`,
        cancelUrl: `${origin}/api/booking/accept?token=${encodeURIComponent(token)}`,
        metadata: { bookingId: b.id, reference: b.reference },
      }),
    });
    if (!r.ok) throw new Error(`Yoco ${r.status}`);
    const checkout = (await r.json()) as { id: string; redirectUrl: string };
    await insertPayment(env, {
      booking_id: b.id,
      kind: "deposit",
      net_cents: depositNetCents,
      payable_cents: depositNetCents,
      yoco_checkout_id: checkout.id,
      pay_url: checkout.redirectUrl,
      status: "pending",
    }, fetchImpl);
    yocoRedirectUrl = checkout.redirectUrl;
  } catch (e) {
    await writeAudit(env, { bookingId: b.id, eventType: "accept.checkout-failed", payload: { reference: b.reference, error: String(e) } }, fetchImpl).catch(() => {});
  }

  // Notify Zandeline (mark-paid link for when EFT lands)
  try {
    const markPaidToken = await signActionToken(b.id, new Date(Date.now() + MARK_PAID_TTL_MS), env.SIGNING_SECRET, "deposit");
    const markPaidUrl = `${origin}/api/booking/mark-paid?token=${encodeURIComponent(markPaidToken)}`;
    await brevoEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Bride chose booking fee — awaiting payment · ${b.bride_name} · ${b.wedding_date}`,
      `<p><strong>${esc(b.bride_name)}</strong> chose her booking fee — awaiting payment for <strong>${esc(b.wedding_date)}</strong>.</p>
<p>Deposit: <strong>${zar(depositNetCents)}</strong> (${depositPct}%) · Ref: <strong>${esc(b.reference)}</strong>${yocoRedirectUrl ? " · Card payment link sent." : " · No card link — EFT only."}</p>
<p style="margin:1.2rem 0;"><a href="${esc(markPaidUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the EFT lands — mark deposit received</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the deposit reflects. Link valid 90 days.</p>`,
      fetchImpl,
    );
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "accept.notify-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  // If Yoco checkout created: redirect to card payment.
  if (yocoRedirectUrl) {
    return new Response(null, { status: 303, headers: { location: yocoRedirectUrl } });
  }

  // Yoco failed: show EFT details inline.
  try {
    const eft = await getEftSettings(env, fetchImpl);
    return htmlResponse(pageShell("Pay by EFT", `<h1>Pay your booking fee by EFT</h1>
<p>Card payment is temporarily unavailable. Please pay your booking fee by EFT — your date will be secured once we confirm receipt.</p>
<table style="border-collapse:collapse;margin:1.2rem 0;font-size:.95rem;">
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Amount</td><td><strong>${zar(depositNetCents)}</strong></td></tr>
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Bank</td><td>${esc(eft.bankName)}</td></tr>
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Account name</td><td>${esc(eft.accountHolder)}</td></tr>
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Account no.</td><td>${esc(eft.accountNumber)}</td></tr>
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Branch code</td><td>${esc(eft.branchCode)}</td></tr>
<tr><td style="color:#8a7d72;padding:3px 16px 3px 0;white-space:nowrap;">Reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p>Email proof of payment to <a href="mailto:info@lustiqueco.co.za" style="color:#8a3a52;">info@lustiqueco.co.za</a> and we'll confirm your date within 24 hours.</p>
<p>Blessings,<br/>The Lustique Co. team</p>`));
  } catch {
    return htmlResponse(pageShell("Contact us", `<h1>One more step</h1><p>Your booking (ref <strong>${esc(b.reference)}</strong>) is reserved. Please email <a href="mailto:info@lustiqueco.co.za" style="color:#8a3a52;">info@lustiqueco.co.za</a> to arrange your deposit payment.</p>`));
  }
}
