/**
 * GET + POST /api/booking/reject — 410 stub.
 *
 * The bride no longer declines via a link (booking flow reframed as direct deposit invoice).
 * Old emailed reject tokens return a polite 410 so stranded links don't error silently.
 * Routes remain registered in index.ts to handle any pre-change tokens gracefully.
 */
import type { AuditEnv } from "./audit";

export interface BookingRejectEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}

function pageShell(title: string, inner: string): string {
  const esc = (s = "") =>
    s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Co.</title><style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:520px;margin:6vh auto;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.4rem;margin:0 0 .8rem;color:#8a3a52;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

const GONE_HTML = pageShell(
  "Link no longer in use",
  "<h1>This link is no longer in use</h1><p>If you&#8217;d like to make a change to your booking, please email <a href=\"mailto:info@lustiqueco.co.za\" style=\"color:#8a3a52;\">info@lustiqueco.co.za</a> and we&#8217;ll be happy to help.</p>",
);

/** GET — 410 stub. All reject links now return this. */
export async function renderRejectPage(
  _env: BookingRejectEnv,
  _req: Request,
  _fetchImpl?: typeof fetch,
): Promise<Response> {
  return new Response(GONE_HTML, { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** POST — 410 stub. No DB transition, no email. */
export async function handleReject(
  _env: BookingRejectEnv,
  _req: Request,
  _fetchImpl?: typeof fetch,
): Promise<Response> {
  return new Response(GONE_HTML, { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });
}
