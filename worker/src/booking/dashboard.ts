// worker/src/booking/dashboard.ts
// Wave C — Admin dashboard: magic-link auth flow + Inbox view.
// All routes require the Phase-1 auth spine (SUPABASE_JWT_SECRET bound as a Worker secret).

import {
  getAdminSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  loginRedirect,
  AUTH_COOKIE,
  type AuthEnv,
  type AdminUser,
} from "./auth";
import type { Env } from "../index";

// Env used by dashboard handlers — Env + auth fields
export interface DashboardEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}

// ── Booking shape returned from Supabase for the Inbox ───────────────────────

interface InboxBooking {
  id: string;
  reference: string;
  status: string;
  bride_name: string;
  wedding_date: string;
  town: string;
  party_size: number;
  total_cents: number;
  created_at: string;
  availability_conflict: boolean;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

/** Shared admin nav shell. Active link is highlighted. */
function adminShell(title: string, user: AdminUser, inner: string): string {
  const nav = [
    { href: "/api/admin/dashboard",  label: "Inbox" },
    { href: "/api/admin/quotes",     label: "Sent Quotes" },
    { href: "/api/admin/payments",   label: "Payments" },
    { href: "/api/admin/rejections", label: "Rejections" },
    { href: "/api/admin/calendar",   label: "Calendar" },
    { href: "/api/admin/templates",  label: "Templates" },
  ]
    .map(
      ({ href, label }) =>
        `<a href="${href}" style="display:block;padding:.45rem .9rem;border-radius:8px;text-decoration:none;color:#5c3d47;font-weight:600;font-size:.85rem;">${esc(label)}</a>`,
    )
    .join("\n");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} — Lustique Admin</title>
<style>
  *,*::before,*::after{box-sizing:border-box;}
  body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;display:flex;min-height:100vh;}
  .sidebar{width:220px;min-height:100vh;background:#fff;border-right:1px solid #ede7e0;padding:1.5rem 1rem;display:flex;flex-direction:column;gap:.3rem;flex-shrink:0;}
  .logo{font-size:1.05rem;font-weight:700;color:#8a3a52;letter-spacing:.03em;margin-bottom:1.2rem;padding:.1rem .9rem;}
  .main{flex:1;padding:2rem 2.5rem;overflow-x:auto;}
  h1{font-size:1.35rem;margin:0 0 1.5rem;color:#2b2b2b;}
  h2{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.6rem 0 .7rem;}
  .meta{font-size:.82rem;color:#8a7d72;padding:.3rem .9rem;margin-top:auto;}
  .logout{display:block;margin-top:.5rem;padding:.35rem .9rem;font:inherit;font-size:.82rem;font-weight:600;color:#8a3a52;background:none;border:1.5px solid #e0c8c8;border-radius:8px;cursor:pointer;text-align:left;}
  .logout:hover{background:#fdf0f0;}
  table{border-collapse:collapse;width:100%;font-size:.9rem;}
  th{text-align:left;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem 0;border-bottom:1.5px solid #ede7e0;}
  td{padding:.55rem .5rem .55rem 0;border-bottom:1px solid #f3ede8;vertical-align:middle;}
  td:first-child{padding-left:0;}
  .badge{display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  .badge-requested{background:#fef9e7;color:#b7791f;}
  .badge-quote_sent{background:#ebf8ff;color:#2b6cb0;}
  .badge-accepted{background:#e9d8fd;color:#553c9a;}
  .badge-deposit_paid{background:#f0fff4;color:#276749;}
  .badge-settled{background:#c6f6d5;color:#22543d;}
  .badge-rejected{background:#fff5f5;color:#c53030;}
  .badge-invoice_expired{background:#f7fafc;color:#718096;}
  .badge-declined{background:#fff5f5;color:#c53030;}
  .badge-cancelled{background:#f7fafc;color:#718096;}
  .conflict{color:#c53030;font-size:.8rem;font-weight:700;margin-left:.4rem;}
  .empty{color:#8a7d72;font-style:italic;padding:2rem 0;}
  a.row-link{color:#8a3a52;text-decoration:none;font-weight:600;}
  a.row-link:hover{text-decoration:underline;}
</style></head><body>
<nav class="sidebar">
  <div class="logo">Lustique ✦</div>
  ${nav}
  <div class="meta">${esc(user.name)}</div>
  <form method="POST" action="/api/admin/auth/logout">
    <button type="submit" class="logout">Sign out</button>
  </form>
</nav>
<main class="main">
  <h1>${esc(title)}</h1>
  ${inner}
</main>
</body></html>`;
}

function formatZAR(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${esc(status)}">${esc(status.replace(/_/g, " "))}</span>`;
}

function conflictFlag(conflict: boolean): string {
  return conflict ? `<span class="conflict" title="Date conflict">⚠</span>` : "";
}

// ── handleAdminLogin ─────────────────────────────────────────────────────────

/** GET /api/admin/login — login form; POST /api/admin/login — send magic link */
export async function handleAdminLogin(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const msg = esc(url.searchParams.get("msg") ?? "");

  if (req.method === "GET") {
    return htmlResponse(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Admin Login — Lustique</title>
<style>
  body{margin:0;font:15px/1.6 system-ui,sans-serif;background:#f7f3ef;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border-radius:14px;padding:2.4rem 2rem;max-width:380px;width:100%;box-shadow:0 6px 30px rgba(0,0,0,.06);}
  h1{font-size:1.3rem;margin:0 0 .4rem;color:#8a3a52;}
  p.sub{font-size:.88rem;color:#8a7d72;margin:0 0 1.6rem;}
  label{display:block;font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.35rem;}
  input{width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .75em;outline:none;}
  input:focus{border-color:#8a3a52;}
  button{margin-top:1rem;width:100%;font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.65em 1em;cursor:pointer;font-size:.95rem;}
  button:hover{background:#7a2e44;}
  .msg{margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;}
</style></head><body>
<div class="card">
  <h1>Lustique ✦</h1>
  <p class="sub">Admin dashboard — enter your email to receive a login link.</p>
  ${msg ? `<div class="msg">${msg}</div>` : ""}
  <form method="POST" action="/api/admin/login">
    <label for="email">Email address</label>
    <input id="email" type="email" name="email" autocomplete="email" required autofocus placeholder="you@example.com">
    <button type="submit">Send login link</button>
  </form>
</div>
</body></html>`);
  }

  // POST — parse body and send Supabase OTP
  let email = "";
  try {
    const body = await req.formData();
    email = (body.get("email") as string | null)?.trim() ?? "";
  } catch {
    // fallback: try URL-encoded
    try {
      const text = await req.text();
      email = new URLSearchParams(text).get("email")?.trim() ?? "";
    } catch { /* empty */ }
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return htmlResponse(
      `<p>Invalid email address. <a href="/api/admin/login">Try again</a>.</p>`,
      400,
    );
  }

  // Fire-and-forget: always show "check your email" to avoid user enumeration
  try {
    await fetchFn(`${env.SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ email, create_user: false }),
    });
  } catch { /* network error — still show the check-email page */ }

  return htmlResponse(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Check your email — Lustique Admin</title>
<style>
  body{margin:0;font:15px/1.6 system-ui,sans-serif;background:#f7f3ef;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border-radius:14px;padding:2.4rem 2rem;max-width:380px;width:100%;box-shadow:0 6px 30px rgba(0,0,0,.06);text-align:center;}
  h1{font-size:1.3rem;margin:0 0 .8rem;color:#8a3a52;}
  p{font-size:.92rem;color:#5c3d47;line-height:1.6;}
</style></head><body>
<div class="card">
  <h1>Check your email ✦</h1>
  <p>If <strong>${esc(email)}</strong> is registered, a login link is on its way.<br/>Please check your inbox and click the link to sign in.</p>
  <p style="margin-top:1.5rem;font-size:.82rem;color:#8a7d72;"><a href="/api/admin/login" style="color:#8a3a52;">← Back to login</a></p>
</div>
</body></html>`);
}

// ── handleAdminAuthCallback ──────────────────────────────────────────────────

/**
 * GET /api/admin/auth/callback?token_hash=...&type=email
 * Exchanges the Supabase token_hash for an access_token, sets the session cookie,
 * and redirects to the dashboard.
 *
 * Requires the Supabase email template to use {{.TokenHash}} so the link lands
 * on this endpoint with the hash as a query param (not URL fragment). See RUNBOOK.
 */
export async function handleAdminAuthCallback(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";

  if (!tokenHash) return loginRedirect("invalid-link");

  let accessToken: string;
  try {
    const res = await fetchFn(`${env.SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token_hash: tokenHash, type }),
    });
    if (!res.ok) return loginRedirect("expired-link");
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return loginRedirect("expired-link");
    accessToken = data.access_token;
  } catch {
    return loginRedirect("error");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/api/admin/dashboard",
      "Set-Cookie": sessionCookieHeader(accessToken),
    },
  });
}

// ── handleAdminAuthLogout ────────────────────────────────────────────────────

/** POST /api/admin/auth/logout — clear session cookie and redirect to login */
export async function handleAdminAuthLogout(
  _req: Request,
  _env: DashboardEnv,
): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/api/admin/login",
      "Set-Cookie": clearSessionCookieHeader(),
    },
  });
}

// ── handleAdminDashboard ─────────────────────────────────────────────────────

/** GET /api/admin/dashboard — Inbox view: pending requests + pipeline snapshot */
export async function handleAdminDashboard(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };

  const user = await getAdminSession(req, authEnv, fetchFn);
  if (!user) return loginRedirect();

  // Fetch active bookings: requested + quote_sent (waiting on Zandeline) + accepted + deposit_paid
  const ACTIVE_STATUSES = ["requested", "quote_sent", "accepted", "deposit_paid"].join(",");
  const bookingsRes = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/bookings` +
      `?select=id,reference,status,bride_name,wedding_date,town,party_size,total_cents,created_at,availability_conflict` +
      `&status=in.(${ACTIVE_STATUSES})` +
      `&order=wedding_date.asc`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const bookings: InboxBooking[] = bookingsRes.ok
    ? ((await bookingsRes.json()) as InboxBooking[])
    : [];

  const rows = bookings.length
    ? bookings
        .map(
          (b) => `<tr>
  <td><a class="row-link" href="/api/admin/booking/${esc(b.id)}">${esc(b.reference)}</a></td>
  <td>${esc(b.bride_name)}</td>
  <td>${esc(b.wedding_date)}</td>
  <td>${esc(b.town)}</td>
  <td>${b.party_size}</td>
  <td>${formatZAR(b.total_cents)}</td>
  <td>${statusBadge(b.status)}${conflictFlag(b.availability_conflict)}</td>
</tr>`,
        )
        .join("\n")
    : `<tr><td colspan="7" class="empty">no pending requests — all clear ✦</td></tr>`;

  const table = `<table>
<thead><tr>
  <th>Reference</th><th>Bride</th><th>Wedding date</th><th>Town</th>
  <th>Party</th><th>Quote</th><th>Status</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;

  return htmlResponse(adminShell("Inbox", user, table));
}
