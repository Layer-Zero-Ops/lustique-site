/**
 * GET + POST /api/booking/accept — legacy Wave A deposit-selection page.
 *
 * Superseded by /api/booking/invoice (Accept/Reject + booking-fee picker + contract gate,
 * see invoice.ts). This route is kept only so old emails/bookmarks/open tabs with an
 * "accept" token don't dead-end — it verifies the token, mints a fresh invoice-purpose
 * token for the same booking, and redirects straight to the current invoice page.
 * No booking mutation happens here anymore.
 */
import { verifyActionToken, signActionToken } from "./token";
import type { AuditEnv } from "./audit";

export interface BookingAcceptEnv extends AuditEnv {
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

const INVOICE_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));

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
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const invalidHtml = () =>
  pageShell("Link not valid", "<h1>This link isn't valid</h1><p>Please use the link from your latest invoice email, or contact info@lustiqueco.co.za.</p>");

/** Verify the legacy accept token and redirect to the current invoice page. */
async function redirectToInvoice(
  env: BookingAcceptEnv,
  token: string,
): Promise<Response> {
  if (!token) return htmlResponse(invalidHtml(), 400);
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "accept");
  if (!v) return htmlResponse(invalidHtml(), 400);

  const origin = env.ALLOWED_ORIGIN || "";
  const invoiceToken = await signActionToken(
    v.bookingId,
    new Date(Date.now() + INVOICE_TTL_MS),
    env.SIGNING_SECRET,
    "invoice",
  );
  const invoiceUrl = `${origin}/api/booking/invoice?token=${encodeURIComponent(invoiceToken)}`;
  return new Response(null, { status: 302, headers: { location: invoiceUrl } });
}

/** GET — redirect straight to the invoice page. */
export async function renderAcceptPage(
  env: BookingAcceptEnv,
  req: Request,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return redirectToInvoice(env, token);
}

/** POST — same redirect (old cached pages submit a form here; ignore depositPct, the invoice page asks again). */
export async function handleAccept(
  env: BookingAcceptEnv,
  req: Request,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  return redirectToInvoice(env, token);
}
