// worker/src/booking/review.ts
/**
 * GET + POST /api/booking/review — Zandeline's booking review & approval page (S6b).
 *
 * Replaces the bare confirm/decline gate: Zandeline sees the full quote breakdown,
 * can adjust the final total, then clicks "Approve & Send" to email the bride her
 * EFT deposit invoice in one step. Decline path mirrors the confirm gate.
 *
 * Uses the same 14-day confirm token (signToken / hashToken) already in the email.
 * The old /api/booking/confirm route remains for backwards-compat but new emails link here.
 *
 * GET  = render-only (prefetch-safe — no mutations, spec §12)
 * POST = verify → optional amount override → guarded transition → emails → redirect
 */
import { getBookingByTokenHashForReview, transitionRequestedBooking, insertPayment, type ReviewBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { verifyToken, hashToken, signActionToken } from "./token";
import { splitDeposit } from "@lustique/pricing";

export interface BookingReviewEnv extends AuditEnv {
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

async function getEftSettings(env: BookingReviewEnv, f: typeof fetch): Promise<EftSettings> {
  const url = `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`;
  const r = await f(url, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
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

const MARK_PAID_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA")}`;

type LoadResult =
  | { ok: true; booking: ReviewBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadBooking(env: BookingReviewEnv, token: string, f: typeof fetch): Promise<LoadResult> {
  const v = await verifyToken(token, env.SIGNING_SECRET);
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingByTokenHashForReview(env, await hashToken(token), f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "requested" || booking.confirm_token_used_at) {
    return { ok: false, reason: "handled" };
  }
  return { ok: true, booking };
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:600px;margin:5vh auto 3rem;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.5rem;margin:0 0 .5rem;color:#8a3a52;}h2{font-size:.95rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#8a7d72;margin:1.4rem 0 .4rem;}
table{border-collapse:collapse;margin:.3rem 0;width:100%;}td{padding:3px 0;vertical-align:top;}
td.k{color:#8a7d72;white-space:nowrap;padding-right:14px;width:1%;}
.invoice{background:#f7f3ef;border-radius:10px;padding:1rem 1.2rem;margin:1.4rem 0 .6rem;}
.invoice label{display:block;font-weight:600;margin-bottom:.4rem;font-size:.95rem;color:#6b5d52;}
.invoice input[type=number]{font:inherit;font-size:1.2rem;font-weight:600;width:100%;box-sizing:border-box;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;margin-top:.25rem;background:#fff;color:#2b2b2b;}
.invoice input[type=number]:focus{outline:2px solid #8a3a52;border-color:#8a3a52;}
.preview{margin:.6rem 0 0;color:#6b5d52;font-size:.94rem;}
.btn-approve{display:block;width:100%;font:inherit;font-size:1rem;font-weight:600;border:0;border-radius:9px;padding:.85em;cursor:pointer;background:#8a3a52;color:#fff;margin-top:1rem;}
.btn-approve:hover{background:#7a3048;}
.decline-wrap{text-align:center;margin-top:.8rem;}
.btn-decline{font:inherit;font-size:.9rem;font-weight:600;border:1.5px solid #c9bfb8;border-radius:9px;padding:.5em 1.4em;cursor:pointer;background:none;color:#6b5d52;}
.muted{color:#8a7d72;font-size:.88rem;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the most recent link from the booking request email.</p>");
const expiredHtml = () =>
  pageShell("Link expired", "<h1>This link has expired</h1><p>Confirm links are valid for 14 days. Ask the bride to re-submit.</p>");
const handledHtml = () =>
  pageShell("Already handled", "<h1>This booking has already been handled</h1><p>Nothing more to do here.</p>");

function reviewPageBody(b: ReviewBookingRow, token: string): string {
  const where = [b.venue, b.town, b.province].filter(Boolean).join(", ") || "—";
  const totalRand = Math.round(b.total_cents / 100);
  const depositRand = Math.round(b.deposit_net_cents / 100);
  const balanceRand = Math.round(b.balance_net_cents / 100);
  const lineRows = (b.quote_lines ?? [])
    .map((l) => `<tr><td class="k">${esc(l.label)}</td><td>R ${Number(l.amount).toLocaleString("en-ZA")}</td></tr>`)
    .join("");

  return `<h1>Review booking request</h1>
<p class="muted">Check the details below and adjust the total if needed, then approve to send ${esc(b.bride_name)} her deposit invoice.</p>
<h2>Booking details</h2>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong><br><span class="muted">${esc(b.bride_email)}</span></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Venue</td><td>${esc(where)}</td></tr>
<tr><td class="k">Party</td><td>${b.party_size} looks</td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
${lineRows ? `<h2>Quote breakdown</h2><table>${lineRows}</table>` : ""}
<form method="POST" action="/api/booking/review">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="action" value="confirm">
<div class="invoice">
  <label>Final total (R)<input id="totalInput" type="number" name="overrideTotal" value="${totalRand}" min="1" step="1" required></label>
  <p class="preview">Deposit (${b.deposit_pct}%): <strong id="depositPreview">R ${depositRand.toLocaleString("en-ZA")}</strong> &nbsp;&middot;&nbsp; Balance: <strong id="balancePreview">R ${balanceRand.toLocaleString("en-ZA")}</strong></p>
</div>
<button class="btn-approve" type="submit">Approve &amp; send deposit invoice</button>
</form>
<div class="decline-wrap">
<form method="POST" action="/api/booking/review">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="action" value="decline">
<button class="btn-decline" type="submit">Decline booking</button>
</form>
</div>
<p class="muted" style="margin-top:1.6rem;">This link is single-use and expires 14 days after the request.</p>
<script>(function(){
var t=document.getElementById('totalInput'),d=document.getElementById('depositPreview'),b=document.getElementById('balancePreview'),pct=${b.deposit_pct};
function u(){var tot=Math.max(0,parseInt(t.value,10)||0),dep=Math.round(tot*pct/100),bal=tot-dep;d.textContent='R\\u00a0'+dep.toLocaleString('en-ZA');b.textContent='R\\u00a0'+bal.toLocaleString('en-ZA');}
t&&t.addEventListener('input',u);
}());</script>`;
}

async function brevoEmail(
  env: BookingReviewEnv,
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

/** S7: create a Yoco checkout and return { id, redirectUrl }. */
async function createYocoCheckout(
  secretKey: string,
  depositCents: number,
  bookingId: string,
  reference: string,
  origin: string,
  f: typeof fetch,
): Promise<{ id: string; redirectUrl: string }> {
  const r = await f("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${bookingId}-deposit`,
    },
    body: JSON.stringify({
      amount: depositCents,
      currency: "ZAR",
      successUrl: `${origin}/booking-deposit-paid.html?ref=${encodeURIComponent(reference)}`,
      cancelUrl: `${origin}/quote?payment=cancelled`,
      metadata: { bookingId, reference },
    }),
  });
  if (!r.ok) throw new Error(`Yoco checkout ${r.status}: ${await r.text()}`);
  return r.json() as Promise<{ id: string; redirectUrl: string }>;
}

/** Deposit invoice email: Yoco "Pay Now" as primary, EFT as fallback. */
function depositEmailHtml(
  eft: EftSettings,
  b: ReviewBookingRow,
  depositCents: number,
  balanceCents: number,
  yocoUrl: string,
): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Wonderful news — <strong>${esc(b.wedding_date)}</strong> is available! Pay your deposit to officially secure your date.</p>
<p style="margin:1.6rem 0;text-align:center;">
  <a href="${esc(yocoUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.8em 2em;border-radius:9px;text-decoration:none;font-weight:700;font-size:1.05rem;">Pay deposit now — ${zar(depositCents)}</a>
</p>
<p style="text-align:center;font-size:.88rem;color:#8a7d72;margin-top:-.6rem;">Secure card payment via Yoco · takes about 30 seconds</p>
<hr style="border:0;border-top:1px solid #ede7e0;margin:1.6rem 0;">
<p style="font-weight:600;color:#6b5d52;margin:0 0 .5rem;">Prefer to pay by EFT?</p>
<table style="border-collapse:collapse;font:14px/1.7 system-ui,sans-serif;margin:0 0 .8rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Deposit due</td><td><strong>${zar(depositCents)}</strong> (${b.deposit_pct}%)</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Bank</td><td>${esc(eft.bankName)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Account name</td><td>${esc(eft.accountHolder)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Account no.</td><td>${esc(eft.accountNumber)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Branch code</td><td>${esc(eft.branchCode)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;white-space:nowrap;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.88rem;color:#8a7d72;">If paying by EFT, please email proof of payment to <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a> — your date won't be secured until we confirm receipt. The balance of ${zar(balanceCents)} is payable closer to your day.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function declineEmailHtml(b: ReviewBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Thank you so much for thinking of Lustique for <strong>${esc(b.wedding_date)}</strong>.</p>
<p>Sadly we're not able to take this booking — most often that's because the date is already fully committed with our artists. We're truly sorry to miss your day.</p>
<p>If your plans shift or you'd like to explore another date, we'd love to hear from you at <a href="mailto:info@lustiqueco.co.za">info@lustiqueco.co.za</a>.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

/** GET — render-only. Never mutates (spec §12 prefetch safety). */
export async function renderReviewPage(
  env: BookingReviewEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Review booking", reviewPageBody(loaded.booking, token)));
}

/** POST — verify, optionally patch amounts, guarded transition, emails, redirect. */
export async function handleReview(
  env: BookingReviewEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const action = String(form?.get("action") ?? "confirm");
  const origin = env.ALLOWED_ORIGIN || "";
  const decline = action === "decline";

  if (!token || (action !== "confirm" && action !== "decline")) {
    return htmlResponse(invalidHtml(), 400);
  }

  const loaded = await loadBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const now = new Date().toISOString();

  if (decline) {
    const updated = await transitionRequestedBooking(
      env, b.id,
      { status: "declined", declined_at: now, confirm_token_used_at: now },
      fetchImpl,
    );
    if (!updated) return htmlResponse(handledHtml(), 200);
    try {
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
        "An update on your Lustique booking", declineEmailHtml(b), fetchImpl);
      await writeAudit(env, { bookingId: b.id, eventType: "confirm.declined", payload: { reference: b.reference } }, fetchImpl);
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action: "decline" } }, fetchImpl).catch(() => {});
    }
    return new Response(null, { status: 303, headers: { location: `${origin}/booking-declined.html?ref=${encodeURIComponent(b.reference)}` } });
  }

  // Approve: resolve final amounts — honour override if Zandeline changed the total.
  const overrideTotalRaw = String(form?.get("overrideTotal") ?? "");
  const overrideTotalRand = parseInt(overrideTotalRaw, 10);
  const useOverride =
    !Number.isNaN(overrideTotalRand) &&
    overrideTotalRand > 0 &&
    overrideTotalRand * 100 !== b.total_cents;

  const finalTotalCents = useOverride ? overrideTotalRand * 100 : b.total_cents;
  const { depositNetCents: finalDepositCents, balanceNetCents: finalBalanceCents } = useOverride
    ? splitDeposit(finalTotalCents, b.deposit_pct as 25 | 50 | 100)
    : { depositNetCents: b.deposit_net_cents, balanceNetCents: b.balance_net_cents };

  const patch: Record<string, unknown> = {
    status: "confirmed",
    confirmed_at: now,
    confirm_token_used_at: now,
    ...(useOverride ? { total_cents: finalTotalCents, deposit_net_cents: finalDepositCents, balance_net_cents: finalBalanceCents } : {}),
  };

  const updated = await transitionRequestedBooking(env, b.id, patch, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);

  const markPaidToken = await signActionToken(b.id, new Date(Date.now() + MARK_PAID_TTL_MS), env.SIGNING_SECRET, "deposit");
  const markPaidUrl = `${origin}/api/booking/mark-paid?token=${encodeURIComponent(markPaidToken)}`;

  // Create Yoco checkout + insert pending payment row before emailing the bride.
  // If Yoco is down we fall through to EFT-only email (fallback already in the template).
  let yocoUrl = "";
  try {
    const checkout = await createYocoCheckout(env.YOCO_SECRET_KEY, finalDepositCents, b.id, b.reference, origin, fetchImpl);
    await insertPayment(env, {
      booking_id: b.id,
      kind: "deposit",
      net_cents: finalDepositCents,
      payable_cents: finalDepositCents,
      yoco_checkout_id: checkout.id,
      pay_url: checkout.redirectUrl,
      status: "pending",
    }, fetchImpl);
    yocoUrl = checkout.redirectUrl;
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.checkout-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  try {
    const eft = await getEftSettings(env, fetchImpl);
    await brevoEmail(
      env,
      { email: b.bride_email, name: b.bride_name },
      "Your date is available — secure it with your deposit · Lustique Co.",
      depositEmailHtml(eft, b, finalDepositCents, finalBalanceCents, yocoUrl),
      fetchImpl,
    );
    await brevoEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Approved — awaiting EFT · ${b.bride_name} · ${b.wedding_date}`,
      `<p><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — approved. EFT deposit details sent (${zar(finalDepositCents)}, ref <strong>${esc(b.reference)}</strong>).</p>
<p style="margin:1.2rem 0;"><a href="${esc(markPaidUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the EFT lands — mark deposit received</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the deposit reflects in the account. Link valid 90 days.</p>`,
      fetchImpl,
    );
    await writeAudit(
      env,
      { bookingId: b.id, eventType: "confirm.confirmed", payload: { reference: b.reference, totalCents: finalTotalCents, override: useOverride } },
      fetchImpl,
    );
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "confirm.email-failed", payload: { reference: b.reference, action: "confirm" } }, fetchImpl).catch(() => {});
  }

  return new Response(null, { status: 303, headers: { location: `${origin}/booking-confirmed.html?ref=${encodeURIComponent(b.reference)}` } });
}
