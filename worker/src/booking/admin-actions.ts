// worker/src/booking/admin-actions.ts
// Wave D5 — JWT-gated admin action handlers.
// 4 POST handlers: Send Quote, Decline, Mark Deposit Paid, Mark Balance Paid.
// Local AdminActionsEnv avoids circular imports; DashboardEnv satisfies it structurally.

import { getAdminSession, loginRedirect, type AuthEnv } from "./auth";
import { getBookingById, transitionBooking, transitionRequestedBooking, insertNotification, type ConfirmBookingRow } from "./db";
import { writeAudit } from "./audit";
import { signActionToken } from "./token";
import {
  esc,
  fmtDate,
  fmtZAR,
  ep,
  em,
  emailShell,
  emailTable,
  emailBtn,
  emailBtnLink,
  emailNote,
  firstN,
  sendEmail,
} from "../lib/email";

export interface AdminActionsEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function errorRedirect(bookingId: string, message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/api/admin/booking/${encodeURIComponent(bookingId)}?error=${encodeURIComponent(message)}`,
    },
  });
}

function successRedirect(bookingId: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/api/admin/booking/${encodeURIComponent(bookingId)}?saved=1` },
  });
}

async function authedSession(
  req: Request,
  env: AdminActionsEnv,
  fetchFn: typeof fetch,
): Promise<{ email: string } | Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  const user = await getAdminSession(req, authEnv, fetchFn);
  return user ?? loginRedirect();
}

// ── Email templates ───────────────────────────────────────────────────────────

function depositInvoiceEmailHtml(
  b: ConfirmBookingRow,
  secureUrl: string,
  invoiceUrl: string,
): string {
  const dep25 = fmtZAR(Math.round(b.total_cents * 0.25));
  const dep50 = fmtZAR(Math.round(b.total_cents * 0.50));
  const depFull = fmtZAR(b.total_cents);
  return emailShell({
    heading: `You&#8217;re all set to secure your date, ${firstN(b.bride_name)}.`,
    body:
      ep(
        `We&#8217;ve reviewed your request and we&#8217;re delighted to hold ${em(fmtDate(b.wedding_date))} for you. Choose your deposit on the next step to lock it in.`,
      ) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Bridal party", val: `${b.party_size} look${b.party_size !== 1 ? "s" : ""}` },
        { key: "Total", val: fmtZAR(b.total_cents), bold: true },
        { key: "Booking fee options", val: `25% · ${dep25}  ·  50% · ${dep50}  ·  Full · ${depFull}` },
        { key: "Your reference", val: b.reference, ref: true },
      ]),
    btnZone:
      emailBtn(secureUrl, "Secure your date →") +
      emailBtnLink(invoiceUrl, "View &amp; print your invoice"),
    footerNote: `This link is valid for 14 days. Questions? Write to us at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a>.`,
  });
}

function declineEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `Thank you for thinking of us, ${firstN(b.bride_name)}.`,
    body:
      ep(
        `We&#8217;re so grateful you considered Lustique for ${em(fmtDate(b.wedding_date))}. Sadly, we&#8217;re not able to take this booking &#8212; most often because the date is already fully committed with our artists.`,
      ) + ep(`We&#8217;re truly sorry to miss your day.`),
    btnZone: emailNote(`If your plans change or another date opens up, we&#8217;d love to hear from you.`),
    footerNote: `Reach us any time at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a> &#8212; we&#8217;ll do our best to help.`,
  });
}

function depositSecuredEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `Your date is secured, ${firstN(b.bride_name)}.`,
    body:
      ep(
        `Your booking fee is in &#8212; ${em(fmtDate(b.wedding_date))} is officially yours. We can&#8217;t wait to be part of your day.`,
      ) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Booking fee received", val: fmtZAR(b.deposit_net_cents), bold: true },
        { key: "Balance remaining", val: fmtZAR(b.balance_net_cents) },
        { key: "Your reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll send a balance reminder closer to your day &#8212; there&#8217;s nothing more to do right now.`),
  });
}

function fullyPaidEmailHtml(b: ConfirmBookingRow): string {
  return emailShell({
    heading: `All settled, ${firstN(b.bride_name)}.`,
    body:
      ep(
        `Your balance is in &#8212; ${em(fmtDate(b.wedding_date))} is fully paid and we are ready for your day. There&#8217;s nothing more to do.`,
      ) +
      emailTable([
        { key: "Date", val: fmtDate(b.wedding_date) },
        { key: "Balance received", val: fmtZAR(b.balance_net_cents), bold: true },
        { key: "Your reference", val: b.reference, ref: true },
      ]),
    btnZone: emailNote(`We&#8217;ll be in touch closer to your day with final details.`),
  });
}

// ── Handler constants ─────────────────────────────────────────────────────────

const QUOTE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — bumped from 7 (no quote-urgency pressure)
const INVOICE_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;

// ── Handlers ──────────────────────────────────────────────────────────────────

/** POST /api/admin/booking/:id/send-quote — requested → quote_sent, email bride + team. */
export async function handleAdminSendQuote(
  req: Request,
  env: AdminActionsEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const session = await authedSession(req, env, fetchFn);
  if (session instanceof Response) return session;

  let booking: ConfirmBookingRow | null;
  try {
    booking = await getBookingById(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (booking.status !== "requested") {
    return errorRedirect(bookingId, `Cannot send quote — status is ${booking.status}`);
  }

  const now = new Date().toISOString();
  const updated = await transitionRequestedBooking(
    env,
    bookingId,
    { status: "quote_sent", quote_sent_at: now, confirm_token_used_at: now },
    fetchFn,
  );
  if (!updated) return errorRedirect(bookingId, "Booking already handled — refresh and check status");

  const origin = env.ALLOWED_ORIGIN || "";
  const acceptToken = await signActionToken(
    booking.id,
    new Date(Date.now() + QUOTE_TTL_MS),
    env.SIGNING_SECRET,
    "accept",
  );
  const invoiceToken = await signActionToken(
    booking.id,
    new Date(Date.now() + INVOICE_TTL_MS),
    env.SIGNING_SECRET,
    "invoice",
  );
  const acceptUrl = `${origin}/api/booking/accept?token=${encodeURIComponent(acceptToken)}`;
  const invoiceUrl = `${origin}/api/booking/invoice?token=${encodeURIComponent(invoiceToken)}`;

  try {
    await sendEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      `Secure your date — ${fmtDate(booking.wedding_date)} · Lustique Co.`,
      depositInvoiceEmailHtml(booking, acceptUrl, invoiceUrl),
      fetchFn,
    );
    await sendEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Deposit invoice sent — ${booking.bride_name} · ${booking.wedding_date}`,
      `<p style="font:14px/1.6 system-ui,sans-serif;margin:0 0 .5rem;"><strong>${esc(booking.bride_name)}</strong> — ${esc(booking.wedding_date)} — deposit invoice sent via admin dashboard (${fmtZAR(booking.total_cents)}, ref <strong>${esc(booking.reference)}</strong>).</p>
<p><a href="${esc(invoiceUrl)}" style="color:#8a3a52;">View invoice →</a></p>`,
      fetchFn,
    );
    await writeAudit(
      env,
      {
        bookingId: booking.id,
        eventType: "admin.quote-sent",
        payload: { reference: booking.reference, sentBy: session.email },
      },
      fetchFn,
    );
  } catch {
    await writeAudit(
      env,
      { bookingId: booking.id, eventType: "admin.quote-email-failed", payload: { reference: booking.reference } },
      fetchFn,
    ).catch(() => {});
  }

  return successRedirect(bookingId);
}

/** POST /api/admin/booking/:id/decline-booking — requested → declined, email bride. */
export async function handleAdminDeclineBooking(
  req: Request,
  env: AdminActionsEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const session = await authedSession(req, env, fetchFn);
  if (session instanceof Response) return session;

  let booking: ConfirmBookingRow | null;
  try {
    booking = await getBookingById(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (booking.status !== "requested") {
    return errorRedirect(bookingId, `Cannot decline — status is ${booking.status}`);
  }

  const now = new Date().toISOString();
  const updated = await transitionRequestedBooking(
    env,
    bookingId,
    { status: "declined", declined_at: now, confirm_token_used_at: now },
    fetchFn,
  );
  if (!updated) return errorRedirect(bookingId, "Booking already handled — refresh and check status");

  try {
    await sendEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      "An update on your Lustique booking — Lustique Co.",
      declineEmailHtml(booking),
      fetchFn,
    );
    await writeAudit(
      env,
      {
        bookingId: booking.id,
        eventType: "admin.declined",
        payload: { reference: booking.reference, declinedBy: session.email },
      },
      fetchFn,
    );
  } catch {
    await writeAudit(
      env,
      { bookingId: booking.id, eventType: "admin.decline-email-failed", payload: { reference: booking.reference } },
      fetchFn,
    ).catch(() => {});
  }

  return successRedirect(bookingId);
}

/** POST /api/admin/booking/:id/mark-deposit — accepted → deposit_paid, email bride. */
export async function handleAdminMarkDepositPaid(
  req: Request,
  env: AdminActionsEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const session = await authedSession(req, env, fetchFn);
  if (session instanceof Response) return session;

  let booking: ConfirmBookingRow | null;
  try {
    booking = await getBookingById(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (booking.status !== "accepted" && booking.status !== "confirmed") {
    return errorRedirect(bookingId, `Cannot mark deposit — status is ${booking.status}`);
  }

  const now = new Date().toISOString();
  // Try "accepted" first; fall back to legacy "confirmed" for old bookings.
  const updated =
    (await transitionBooking(env, bookingId, "accepted", { status: "deposit_paid", deposit_paid_at: now }, fetchFn)) ??
    (await transitionBooking(env, bookingId, "confirmed", { status: "deposit_paid", deposit_paid_at: now }, fetchFn));
  if (!updated) return errorRedirect(bookingId, "Deposit already marked — refresh and check status");

  insertNotification(env, {
    type: "deposit_paid",
    title: `Booking fee received — ${booking.bride_name}`,
    body: `${booking.reference} · ${booking.wedding_date} (marked by admin)`,
    link: `/api/admin/booking/${booking.id}`,
    booking_id: booking.id,
    payload: { reference: booking.reference, markedBy: session.email },
  }, fetchFn).catch(() => {});

  try {
    await sendEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      "Your date is secured · Lustique Co.",
      depositSecuredEmailHtml(booking),
      fetchFn,
    );
    await writeAudit(
      env,
      {
        bookingId: booking.id,
        eventType: "admin.deposit-marked",
        payload: { reference: booking.reference, markedBy: session.email },
      },
      fetchFn,
    );
  } catch {
    await writeAudit(
      env,
      { bookingId: booking.id, eventType: "admin.deposit-email-failed", payload: { reference: booking.reference } },
      fetchFn,
    ).catch(() => {});
  }

  return successRedirect(bookingId);
}

/** POST /api/admin/booking/:id/mark-balance — deposit_paid → settled, email bride. */
export async function handleAdminMarkBalancePaid(
  req: Request,
  env: AdminActionsEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const session = await authedSession(req, env, fetchFn);
  if (session instanceof Response) return session;

  let booking: ConfirmBookingRow | null;
  try {
    booking = await getBookingById(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (booking.status !== "deposit_paid") {
    return errorRedirect(bookingId, `Cannot mark balance — status is ${booking.status}`);
  }

  const now = new Date().toISOString();
  const updated = await transitionBooking(
    env,
    bookingId,
    "deposit_paid",
    { status: "settled", settled_at: now },
    fetchFn,
  );
  if (!updated) return errorRedirect(bookingId, "Balance already marked — refresh and check status");

  try {
    await sendEmail(
      env,
      { email: booking.bride_email, name: booking.bride_name },
      "All settled — fully paid · Lustique Co.",
      fullyPaidEmailHtml(booking),
      fetchFn,
    );
    await writeAudit(
      env,
      {
        bookingId: booking.id,
        eventType: "admin.balance-marked",
        payload: { reference: booking.reference, markedBy: session.email },
      },
      fetchFn,
    );
  } catch {
    await writeAudit(
      env,
      { bookingId: booking.id, eventType: "admin.balance-email-failed", payload: { reference: booking.reference } },
      fetchFn,
    ).catch(() => {});
  }

  return successRedirect(bookingId);
}
