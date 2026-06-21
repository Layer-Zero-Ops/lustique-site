// worker/src/booking/dashboard.ts
// Wave C — Admin dashboard: magic-link auth flow + Inbox + C.2 views.
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
  .notif-bell{width:100%;padding:.4rem .9rem;font:inherit;font-size:.82rem;font-weight:600;color:#5c3d47;background:none;border:none;cursor:pointer;text-align:left;border-radius:8px;display:flex;align-items:center;gap:.5rem;}
  .notif-bell:hover{background:#f7f3ef;}
  .notif-count{display:none;background:#8a3a52;color:#fff;border-radius:20px;font-size:.7rem;font-weight:700;padding:.1em .5em;min-width:1.3em;text-align:center;}
</style></head><body>
<nav class="sidebar">
  <div class="logo">Lustique ✦</div>
  ${nav}
  <div style="position:relative;margin-top:.4rem;" id="notif-wrap">
    <button class="notif-bell" id="notif-bell" aria-label="Notifications" aria-haspopup="true">
      <span>🔔</span><span>Notifications</span><span class="notif-count" id="notif-badge"></span>
    </button>
    <div id="notif-dropdown" role="menu" style="display:none;position:absolute;bottom:calc(100% + .4rem);left:0;width:290px;background:#fff;border:1.5px solid #ede7e0;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.12);z-index:50;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .9rem;border-bottom:1px solid #ede7e0;">
        <span style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;">Notifications</span>
        <button onclick="markAllRead()" style="font:inherit;font-size:.75rem;font-weight:700;color:#8a3a52;background:none;border:none;cursor:pointer;padding:0;">Mark all read</button>
      </div>
      <div id="notif-list" style="max-height:300px;overflow-y:auto;"></div>
    </div>
  </div>
  <div class="meta">${esc(user.name)}</div>
  <form method="POST" action="/api/admin/auth/logout">
    <button type="submit" class="logout">Sign out</button>
  </form>
</nav>
<main class="main">
  <h1>${esc(title)}</h1>
  ${inner}
</main>
<script>
(function(){
  var bell=document.getElementById('notif-bell');
  var badge=document.getElementById('notif-badge');
  var dropdown=document.getElementById('notif-dropdown');
  var list=document.getElementById('notif-list');
  function poll(){
    fetch('/api/admin/notifications')
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){
        if(!d)return;
        if(d.count>0){badge.textContent=d.count;badge.style.display='inline-block';}
        else{badge.style.display='none';}
        renderItems(d.items);
      }).catch(function(){});
  }
  function renderItems(items){
    list.textContent='';
    if(!items||!items.length){
      var e=document.createElement('div');
      e.style.cssText='padding:.8rem .9rem;font-size:.82rem;color:#8a7d72;';
      e.textContent='No new notifications ❆';
      list.appendChild(e);return;
    }
    items.forEach(function(n){
      var a=document.createElement('a');
      a.href=n.link||'#';
      a.style.cssText='display:block;padding:.65rem .9rem;border-bottom:1px solid #f3ede8;text-decoration:none;color:#2b2b2b;';
      a.addEventListener('click',function(){markRead(n.id);});
      var t=document.createElement('div');
      t.style.cssText='font-weight:600;font-size:.85rem;';
      t.textContent=n.title;a.appendChild(t);
      if(n.body){var b=document.createElement('div');b.style.cssText='font-size:.78rem;color:#8a7d72;margin-top:.15rem;';b.textContent=n.body;a.appendChild(b);}
      list.appendChild(a);
    });
  }
  window.markRead=function(id){
    fetch('/api/admin/notifications/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(){setTimeout(poll,300);}).catch(function(){});
  };
  window.markAllRead=function(){
    fetch('/api/admin/notifications/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})})
      .then(function(){dropdown.style.display='none';setTimeout(poll,300);}).catch(function(){});
  };
  bell.addEventListener('click',function(e){
    e.stopPropagation();
    dropdown.style.display=dropdown.style.display==='none'?'block':'none';
  });
  document.addEventListener('click',function(){dropdown.style.display='none';});
  poll();
  setInterval(poll,60000);
}());
</script>
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
<meta name="robots" content="noindex"><title>Admin Login — Lustique Co.</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#FAF6F0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;font-family:Arial,sans-serif;}
  .card{background:#fff;border:1px solid #E8D5B7;max-width:420px;width:100%;padding:52px 44px 44px;}
  .logo{display:block;margin:0 auto 36px;width:108px;}
  .divider{height:1px;width:60px;background:#E8D5B7;margin:0 auto 36px;}
  h1{margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;font-style:italic;color:#5C4332;text-align:center;line-height:1.35;}
  p.sub{margin:0 0 32px;font-size:13px;line-height:1.75;color:#8A7060;text-align:center;}
  label{display:block;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#A89080;margin-bottom:8px;}
  input{width:100%;font:14px/1.4 Arial,sans-serif;color:#3A2E26;border:1px solid #E8D5B7;border-radius:2px;padding:12px 14px;outline:none;background:#FAF6F0;transition:border-color .15s;}
  input:focus{border-color:#5C4332;background:#fff;}
  button{margin-top:24px;display:block;width:100%;background:#EFD2C5;color:#5C4332;border:1px solid #5C4332;border-radius:24px;padding:14px;font:500 10px/1 Arial,sans-serif;letter-spacing:0.2em;text-transform:uppercase;cursor:pointer;transition:background .15s;}
  button:hover{background:#e8c4b3;}
  .msg{margin-bottom:20px;padding:10px 14px;background:#f0faf4;border:1px solid #b7dfc8;font-size:13px;color:#2d6a4f;}
  .stamp{margin-top:36px;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#C8B8AC;text-align:center;}
  .peony{position:fixed;bottom:-60px;right:-40px;width:340px;opacity:0.18;mix-blend-mode:multiply;pointer-events:none;user-select:none;z-index:0;}
  .card{position:relative;z-index:1;}
</style></head><body>
<img src="https://lustiqueco.co.za/assets/peony.png" alt="" class="peony">
<div class="card">
  <img src="https://lustiqueco.co.za/assets/logo.png" alt="Lustique Co." class="logo">
  <div class="divider"></div>
  <h1>Welcome back, Zandeline.</h1>
  <p class="sub">We'll send a private link straight to your inbox.</p>
  ${msg ? `<div class="msg">${msg}</div>` : ""}
  <form method="POST" action="/api/admin/login">
    <label for="email">Email address</label>
    <input id="email" type="email" name="email" autocomplete="email" required autofocus placeholder="info@lustiqueco.co.za">
    <button type="submit">Send login link</button>
  </form>
</div>
<p class="stamp">Pretoria &middot; South Africa</p>
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
<meta name="robots" content="noindex"><title>Check your email — Lustique Co.</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#FAF6F0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;font-family:Arial,sans-serif;}
  .card{background:#fff;border:1px solid #E8D5B7;max-width:420px;width:100%;padding:52px 44px 44px;text-align:center;}
  .logo{display:block;margin:0 auto 36px;width:108px;}
  .divider{height:1px;background:#E8D5B7;margin:0 0 36px;}
  h1{margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;font-style:italic;color:#5C4332;line-height:1.35;}
  p{margin:0 0 0;font-size:13px;line-height:1.85;color:#3A2E26;}
  .back{display:inline-block;margin-top:32px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8A7060;text-decoration:none;border-bottom:1px solid #E8D5B7;padding-bottom:2px;}
  .stamp{margin-top:36px;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#C8B8AC;text-align:center;}
</style></head><body>
<div class="card">
  <img src="https://lustiqueco.co.za/assets/logo.png" alt="Lustique Co." class="logo">
  <div class="divider"></div>
  <h1>Check your inbox.</h1>
  <p>A login link is on its way to <strong style="color:#5C4332;">${esc(email)}</strong>.<br>Click the link in that email to open your dashboard.<br>It expires in one hour and can only be used once.</p>
  <a href="/api/admin/login" class="back">← Back to login</a>
</div>
<p class="stamp">Pretoria &middot; South Africa</p>
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

// ── Wave C.3 — Notifications types ───────────────────────────────────────────

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string;
  booking_id: string | null;
  created_at: string;
}

// ── Wave C.2 shared helpers ───────────────────────────────────────────────────

function supabaseHeaders(env: DashboardEnv): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

function supabaseUrl(env: DashboardEnv, path: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${path}`;
}

async function getAuthEnvUser(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch,
): Promise<AdminUser | null> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  return getAdminSession(req, authEnv, fetchFn);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

// ── handleAdminBookingDetail ──────────────────────────────────────────────────

interface BookingDetail {
  id: string;
  reference: string;
  status: string;
  bride_name: string;
  bride_email: string;
  bride_phone: string;
  wedding_date: string;
  town: string | null;
  province: string | null;
  venue: string | null;
  party_size: number;
  total_cents: number;
  deposit_pct: number | null;
  deposit_net_cents: number;
  balance_net_cents: number;
  occasion: string;
  quote_lines: Array<{ label: string; amount: number }>;
  created_at: string;
  quote_sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  invoice_expired_at: string | null;
  availability_conflict: boolean;
  notes: string | null;
}

interface PaymentRow {
  id: string;
  kind: string;
  status: string;
  net_cents: number;
  payable_cents: number;
  yoco_checkout_id: string | null;
  yoco_payment_id: string | null;
  pay_url: string | null;
  created_at: string;
  paid_at: string | null;
}

interface QuoteRevision {
  id: string;
  old_total_cents: number;
  new_total_cents: number;
  revised_by: string;
  created_at: string;
}

interface RejectionRow {
  id: string;
  rejected_by: string;
  reason_code: string | null;
  reason_text: string | null;
  created_at: string;
}

/**
 * GET /api/admin/booking/:id — booking detail + inline quote editor
 * POST /api/admin/quote/:id  — update total_cents, bump quote_revision
 */
export async function handleAdminBookingDetail(
  req: Request,
  env: DashboardEnv,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const hdr = supabaseHeaders(env);

  if (req.method === "POST") {
    // Parse the new total from the form
    let newTotalCents = 0;
    try {
      const fd = await req.formData();
      const raw = (fd.get("total_zar") as string | null) ?? "";
      newTotalCents = Math.round(parseFloat(raw.replace(/[^0-9.]/g, "")) * 100);
    } catch {
      return htmlResponse(`<p>Invalid form. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 400);
    }
    if (!newTotalCents || newTotalCents < 100) {
      return htmlResponse(`<p>Amount too low. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 400);
    }

    // Fetch current totals
    const cur = await fetchFn(
      supabaseUrl(env, `bookings?id=eq.${encodeURIComponent(id)}&select=total_cents,deposit_pct,deposit_net_cents,balance_net_cents`),
      { headers: hdr },
    );
    if (!cur.ok) return htmlResponse(`<p>Fetch error. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 502);
    const rows = (await cur.json()) as Array<{ total_cents: number; deposit_pct: number | null; deposit_net_cents: number; balance_net_cents: number }>;
    if (!rows.length) return htmlResponse(`<p>Not found. <a href="/api/admin/dashboard">Back</a></p>`, 404);
    const prev = rows[0]!;

    // Recalculate deposit/balance if deposit_pct is set (bride has chosen)
    let depositNetCents = prev.deposit_net_cents;
    let balanceNetCents = prev.balance_net_cents;
    if (prev.deposit_pct) {
      depositNetCents = Math.floor(newTotalCents * prev.deposit_pct / 100);
      balanceNetCents = newTotalCents - depositNetCents;
    } else {
      balanceNetCents = newTotalCents - depositNetCents;
    }

    // PATCH the booking
    const patch = await fetchFn(
      supabaseUrl(env, `bookings?id=eq.${encodeURIComponent(id)}`),
      {
        method: "PATCH",
        headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ total_cents: newTotalCents, deposit_net_cents: depositNetCents, balance_net_cents: balanceNetCents }),
      },
    );
    if (!patch.ok) return htmlResponse(`<p>Update failed. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 502);

    // Record revision
    await fetchFn(supabaseUrl(env, "quote_revisions"), {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        booking_id: id,
        old_total_cents: prev.total_cents,
        new_total_cents: newTotalCents,
        revised_by: user.email,
      }),
    });

    return new Response(null, { status: 302, headers: { Location: `/api/admin/booking/${id}?saved=1` } });
  }

  // GET — fetch booking + related data
  const [bRes, pRes, qrRes, rjRes] = await Promise.all([
    fetchFn(
      supabaseUrl(
        env,
        `bookings?id=eq.${encodeURIComponent(id)}&select=id,reference,status,bride_name,bride_email,bride_phone,wedding_date,town,province,venue,party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents,occasion,quote_lines,created_at,quote_sent_at,accepted_at,rejected_at,invoice_expired_at,availability_conflict,notes`,
      ),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `payments?booking_id=eq.${encodeURIComponent(id)}&select=id,kind,status,net_cents,payable_cents,yoco_checkout_id,yoco_payment_id,pay_url,created_at,paid_at&order=created_at.asc`),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `quote_revisions?booking_id=eq.${encodeURIComponent(id)}&select=id,old_total_cents,new_total_cents,revised_by,created_at&order=created_at.desc`),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `rejections?booking_id=eq.${encodeURIComponent(id)}&select=id,rejected_by,reason_code,reason_text,created_at&order=created_at.desc`),
      { headers: hdr },
    ),
  ]);

  if (!bRes.ok) return htmlResponse(`<p>Fetch error. <a href="/api/admin/dashboard">Back</a></p>`, 502);
  const bookings = (await bRes.json()) as BookingDetail[];
  if (!bookings.length) return htmlResponse(adminShell("Not found", user, `<p>Booking not found.</p>`), 404);
  const b = bookings[0]!;
  const payments: PaymentRow[] = pRes.ok ? ((await pRes.json()) as PaymentRow[]) : [];
  const revisions: QuoteRevision[] = qrRes.ok ? ((await qrRes.json()) as QuoteRevision[]) : [];
  const rejections: RejectionRow[] = rjRes.ok ? ((await rjRes.json()) as RejectionRow[]) : [];

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";

  const quoteLines = (b.quote_lines || [])
    .map((l) => `<tr><td>${esc(l.label)}</td><td style="text-align:right;">${formatZAR(l.amount)}</td></tr>`)
    .join("\n");

  const paymentsHtml = payments.length
    ? `<table><thead><tr><th>Kind</th><th>Status</th><th>Net</th><th>Payable</th><th>Method</th><th>Paid at</th></tr></thead><tbody>
        ${payments.map((p) => `<tr>
          <td>${esc(p.kind)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${formatZAR(p.net_cents)}</td>
          <td>${formatZAR(p.payable_cents)}</td>
          <td>${p.yoco_payment_id ? "Yoco" : p.yoco_checkout_id ? "Yoco (pending)" : "EFT"}</td>
          <td>${fmtDateTime(p.paid_at)}</td>
        </tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No payments recorded.</p>`;

  const revisionsHtml = revisions.length
    ? `<table><thead><tr><th>Old total</th><th>New total</th><th>By</th><th>When</th></tr></thead><tbody>
        ${revisions.map((r) => `<tr><td>${formatZAR(r.old_total_cents)}</td><td>${formatZAR(r.new_total_cents)}</td><td>${esc(r.revised_by)}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No revisions.</p>`;

  const rejectionsHtml = rejections.length
    ? `<table><thead><tr><th>By</th><th>Code</th><th>Note</th><th>When</th></tr></thead><tbody>
        ${rejections.map((r) => `<tr><td>${esc(r.rejected_by)}</td><td>${esc(r.reason_code ?? "—")}</td><td>${esc(r.reason_text ?? "—")}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No rejections.</p>`;

  const editableStatuses = ["requested", "quote_sent"];
  const canEdit = editableStatuses.includes(b.status);
  const editForm = canEdit
    ? `<form method="POST" action="/api/admin/quote/${esc(id)}" style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;">
        <label style="font-size:.82rem;font-weight:700;color:#8a7d72;">New total (R)</label>
        <input name="total_zar" type="number" min="1" step="0.01" value="${(b.total_cents / 100).toFixed(2)}"
          style="width:140px;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;" required>
        <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.4em 1em;cursor:pointer;">Save revision</button>
      </form>`
    : `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">Quote editing locked — status is <strong>${esc(b.status)}</strong>.</p>`;

  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;">✓ Quote updated.</div>` : ""}
    <a href="/api/admin/dashboard" style="font-size:.82rem;color:#8a3a52;">← Inbox</a>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:1rem;">
      <div>
        <h2>Bride</h2>
        <table><tbody>
          <tr><td style="color:#8a7d72;padding-right:1rem;">Name</td><td>${esc(b.bride_name)}</td></tr>
          <tr><td style="color:#8a7d72;">Email</td><td><a href="mailto:${esc(b.bride_email)}" style="color:#8a3a52;">${esc(b.bride_email)}</a></td></tr>
          <tr><td style="color:#8a7d72;">Phone</td><td>${esc(b.bride_phone)}</td></tr>
          <tr><td style="color:#8a7d72;">Wedding</td><td>${esc(b.wedding_date)}</td></tr>
          <tr><td style="color:#8a7d72;">Town</td><td>${esc(b.town ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Province</td><td>${esc(b.province ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Venue</td><td>${esc(b.venue ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Party</td><td>${b.party_size}</td></tr>
          <tr><td style="color:#8a7d72;">Occasion</td><td>${esc(b.occasion)}</td></tr>
        </tbody></table>
      </div>
      <div>
        <h2>Booking</h2>
        <table><tbody>
          <tr><td style="color:#8a7d72;padding-right:1rem;">Reference</td><td>${esc(b.reference)}</td></tr>
          <tr><td style="color:#8a7d72;">Status</td><td>${statusBadge(b.status)}${conflictFlag(b.availability_conflict)}</td></tr>
          <tr><td style="color:#8a7d72;">Requested</td><td>${fmtDateTime(b.created_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Quote sent</td><td>${fmtDateTime(b.quote_sent_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Accepted</td><td>${fmtDateTime(b.accepted_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Deposit %</td><td>${b.deposit_pct != null ? `${b.deposit_pct}%` : "—"}</td></tr>
          <tr><td style="color:#8a7d72;">Total</td><td><strong>${formatZAR(b.total_cents)}</strong></td></tr>
          <tr><td style="color:#8a7d72;">Deposit</td><td>${formatZAR(b.deposit_net_cents)}</td></tr>
          <tr><td style="color:#8a7d72;">Balance</td><td>${formatZAR(b.balance_net_cents)}</td></tr>
        </tbody></table>
      </div>
    </div>
    <h2>Quote lines</h2>
    <table><thead><tr><th>Service</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${quoteLines || `<tr><td colspan="2" class="empty">—</td></tr>`}</tbody></table>
    <h2>Edit total</h2>
    ${editForm}
    <h2>Payments</h2>${paymentsHtml}
    <h2>Revisions</h2>${revisionsHtml}
    <h2>Rejections</h2>${rejectionsHtml}
    ${b.notes ? `<h2>Notes</h2><p style="white-space:pre-wrap;">${esc(b.notes)}</p>` : ""}
  `;

  return htmlResponse(adminShell(`${b.reference} — Detail`, user, inner));
}

// ── handleAdminQuotes ─────────────────────────────────────────────────────────

interface QuoteSentBooking {
  id: string;
  reference: string;
  bride_name: string;
  bride_email: string;
  wedding_date: string;
  town: string | null;
  party_size: number;
  total_cents: number;
  quote_sent_at: string | null;
}

/** GET /api/admin/quotes — sent-quotes view: quote_sent bookings awaiting bride response */
export async function handleAdminQuotes(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const res = await fetchFn(
    supabaseUrl(
      env,
      `bookings?status=eq.quote_sent&select=id,reference,bride_name,bride_email,wedding_date,town,party_size,total_cents,quote_sent_at&order=wedding_date.asc`,
    ),
    { headers: supabaseHeaders(env) },
  );
  const bookings: QuoteSentBooking[] = res.ok ? ((await res.json()) as QuoteSentBooking[]) : [];

  const now = Date.now();
  const rows = bookings.length
    ? bookings.map((b) => {
        const sentMs = b.quote_sent_at ? new Date(b.quote_sent_at).getTime() : now;
        const expiresMs = sentMs + 7 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((expiresMs - now) / 86400000));
        const urgent = daysLeft <= 2;
        return `<tr>
          <td><a class="row-link" href="/api/admin/booking/${esc(b.id)}">${esc(b.reference)}</a></td>
          <td>${esc(b.bride_name)}</td>
          <td><a href="mailto:${esc(b.bride_email)}" style="color:#8a3a52;">${esc(b.bride_email)}</a></td>
          <td>${esc(b.wedding_date)}</td>
          <td>${esc(b.town ?? "—")}</td>
          <td>${b.party_size}</td>
          <td>${formatZAR(b.total_cents)}</td>
          <td>${fmtDate(b.quote_sent_at)}</td>
          <td style="color:${urgent ? "#c53030" : "#276749"};font-weight:700;">${daysLeft}d left</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="9" class="empty">no quotes awaiting response ✦</td></tr>`;

  const table = `<table>
    <thead><tr>
      <th>Reference</th><th>Bride</th><th>Email</th><th>Wedding</th><th>Town</th>
      <th>Party</th><th>Total</th><th>Sent</th><th>Expires</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return htmlResponse(adminShell("Sent Quotes", user, table));
}

// ── handleAdminPayments ───────────────────────────────────────────────────────

interface PaymentWithBooking {
  id: string;
  kind: string;
  status: string;
  net_cents: number;
  payable_cents: number;
  yoco_checkout_id: string | null;
  yoco_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
  bookings: { reference: string; bride_name: string; wedding_date: string } | null;
}

/** GET /api/admin/payments — all payments with booking context */
export async function handleAdminPayments(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const res = await fetchFn(
    supabaseUrl(
      env,
      `payments?select=id,kind,status,net_cents,payable_cents,yoco_checkout_id,yoco_payment_id,created_at,paid_at,bookings(reference,bride_name,wedding_date)&order=created_at.desc`,
    ),
    { headers: supabaseHeaders(env) },
  );
  const payments: PaymentWithBooking[] = res.ok ? ((await res.json()) as PaymentWithBooking[]) : [];

  const rows = payments.length
    ? payments.map((p) => {
        const bk = p.bookings;
        const method = p.yoco_payment_id ? "Yoco" : p.yoco_checkout_id ? "Yoco pending" : "EFT";
        return `<tr>
          <td>${esc(bk?.reference ?? "—")}</td>
          <td>${esc(bk?.bride_name ?? "—")}</td>
          <td>${esc(bk?.wedding_date ?? "—")}</td>
          <td>${esc(p.kind)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${formatZAR(p.net_cents)}</td>
          <td>${formatZAR(p.payable_cents)}</td>
          <td>${esc(method)}</td>
          <td>${fmtDateTime(p.paid_at)}</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="9" class="empty">no payments recorded yet ✦</td></tr>`;

  const table = `<table>
    <thead><tr>
      <th>Reference</th><th>Bride</th><th>Wedding</th><th>Kind</th><th>Status</th>
      <th>Net</th><th>Payable</th><th>Method</th><th>Paid at</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return htmlResponse(adminShell("Payments", user, table));
}

// ── handleAdminRejections ─────────────────────────────────────────────────────

interface RejectionWithBooking {
  id: string;
  rejected_by: string;
  reason_code: string | null;
  reason_text: string | null;
  created_at: string;
  bookings: { id: string; reference: string; bride_name: string; wedding_date: string; status: string } | null;
}

/** GET /api/admin/rejections — all bride + admin rejections with booking links */
export async function handleAdminRejections(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const res = await fetchFn(
    supabaseUrl(
      env,
      `rejections?select=id,rejected_by,reason_code,reason_text,created_at,bookings(id,reference,bride_name,wedding_date,status)&order=created_at.desc`,
    ),
    { headers: supabaseHeaders(env) },
  );
  const rejections: RejectionWithBooking[] = res.ok ? ((await res.json()) as RejectionWithBooking[]) : [];

  const rows = rejections.length
    ? rejections.map((r) => {
        const bk = r.bookings;
        return `<tr>
          <td>${bk ? `<a class="row-link" href="/api/admin/booking/${esc(bk.id)}">${esc(bk.reference)}</a>` : "—"}</td>
          <td>${esc(bk?.bride_name ?? "—")}</td>
          <td>${esc(bk?.wedding_date ?? "—")}</td>
          <td>${bk ? statusBadge(bk.status) : "—"}</td>
          <td>${esc(r.rejected_by)}</td>
          <td>${esc(r.reason_code ?? "—")}</td>
          <td>${esc(r.reason_text ?? "—")}</td>
          <td>${fmtDateTime(r.created_at)}</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="8" class="empty">no rejections recorded ✦</td></tr>`;

  const table = `<table>
    <thead><tr>
      <th>Reference</th><th>Bride</th><th>Wedding</th><th>Status</th>
      <th>Rejected by</th><th>Code</th><th>Note</th><th>When</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return htmlResponse(adminShell("Rejections", user, table));
}

// ── handleAdminCalendar ───────────────────────────────────────────────────────

interface CalendarBooking {
  wedding_date: string;
  status: string;
}

interface BlockedDate {
  date: string;
  slots: number;
}

/** GET /api/admin/calendar — month grid + slots editor; POST — set slots for a date */
export async function handleAdminCalendar(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const url = new URL(req.url);
  const hdr = supabaseHeaders(env);

  // POST — set slots for a date
  if (req.method === "POST") {
    let date = "";
    let slots = 0;
    try {
      const fd = await req.formData();
      date = (fd.get("date") as string | null)?.trim() ?? "";
      slots = parseInt((fd.get("slots") as string | null) ?? "0", 10);
    } catch {
      return htmlResponse(`<p>Invalid form. <a href="/api/admin/calendar">Back</a></p>`, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return htmlResponse(`<p>Invalid date. <a href="/api/admin/calendar">Back</a></p>`, 400);
    }
    await fetchFn(supabaseUrl(env, "blocked_dates?on_conflict=date"), {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ date, slots: Math.max(0, slots) }),
    });
    const month = date.slice(0, 7);
    return new Response(null, { status: 302, headers: { Location: `/api/admin/calendar?month=${month}&saved=1` } });
  }

  // GET — parse target month
  const monthParam = url.searchParams.get("month") ?? "";
  let year: number;
  let month: number;
  const now = new Date();
  if (/^\d{4}-\d{2}$/.test(monthParam)) {
    [year, month] = monthParam.split("-").map(Number) as [number, number];
  } else {
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }

  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay.getUTCDate()).padStart(2, "0")}`;

  const [bRes, bdRes] = await Promise.all([
    fetchFn(
      supabaseUrl(
        env,
        `bookings?wedding_date=gte.${monthStart}&wedding_date=lte.${monthEnd}&status=in.(requested,quote_sent,accepted,deposit_paid)&select=wedding_date,status`,
      ),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `blocked_dates?date=gte.${monthStart}&date=lte.${monthEnd}&select=date,slots&order=date.asc`),
      { headers: hdr },
    ),
  ]);

  const bookings: CalendarBooking[] = bRes.ok ? ((await bRes.json()) as CalendarBooking[]) : [];
  const blockedDates: BlockedDate[] = bdRes.ok ? ((await bdRes.json()) as BlockedDate[]) : [];

  // Build day-count map
  const countByDay = new Map<string, number>();
  for (const b of bookings) {
    const d = b.wedding_date.slice(0, 10);
    countByDay.set(d, (countByDay.get(d) ?? 0) + 1);
  }
  const slotsByDay = new Map<string, number>();
  for (const bd of blockedDates) {
    slotsByDay.set(bd.date.slice(0, 10), bd.slots);
  }

  // Month grid
  const daysInMonth = lastDay.getUTCDate();
  const startDow = firstDay.getUTCDay(); // 0=Sun
  const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthLabel = firstDay.toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

  let cells = "";
  // pad empty cells for start of week
  for (let i = 0; i < startDow; i++) {
    cells += `<td style="background:#f7f3ef;"></td>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const count = countByDay.get(dateStr) ?? 0;
    const slots = slotsByDay.get(dateStr) ?? null;
    const isBlocked = slots === 0;
    const overCapacity = slots !== null && slots > 0 && count >= slots;
    const bg = isBlocked ? "#fde8e8" : overCapacity ? "#fef3cd" : count > 0 ? "#edfcf2" : "#fff";
    const indicator = isBlocked
      ? `<div style="font-size:.65rem;color:#c53030;font-weight:700;">BLOCKED</div>`
      : count > 0
      ? `<div style="font-size:.75rem;color:${overCapacity ? "#c53030" : "#276749"};font-weight:700;">${count} booked${slots !== null ? ` / ${slots}` : ""}</div>`
      : "";
    cells += `<td style="vertical-align:top;padding:.4rem;background:${bg};border:1px solid #ede7e0;min-width:70px;">
      <div style="font-weight:700;font-size:.85rem;">${d}</div>
      ${indicator}
    </td>`;
  }
  // pad end of last row
  const total = startDow + daysInMonth;
  const endPad = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < endPad; i++) {
    cells += `<td style="background:#f7f3ef;"></td>`;
  }

  // Build rows of 7
  const cellArr = cells.split("</td>").filter(Boolean).map((c) => c + "</td>");
  let rows = "";
  for (let i = 0; i < cellArr.length; i += 7) {
    rows += `<tr>${cellArr.slice(i, i + 7).join("")}</tr>`;
  }

  const saved = url.searchParams.get("saved") === "1";
  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;">✓ Capacity updated.</div>` : ""}
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
      <a href="/api/admin/calendar?month=${prevMonth}" style="color:#8a3a52;text-decoration:none;font-weight:700;">← prev</a>
      <strong style="font-size:1rem;">${esc(monthLabel)}</strong>
      <a href="/api/admin/calendar?month=${nextMonth}" style="color:#8a3a52;text-decoration:none;font-weight:700;">next →</a>
    </div>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr>
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<th style="font-size:.8rem;color:#8a7d72;padding:.3rem .4rem;border-bottom:2px solid #ede7e0;">${d}</th>`).join("")}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2 style="margin-top:1.8rem;">Set day capacity</h2>
    <form method="POST" action="/api/admin/calendar" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;">
      <label style="font-size:.82rem;font-weight:700;color:#8a7d72;">Date (YYYY-MM-DD)</label>
      <input name="date" type="date" required pattern="\\d{4}-\\d{2}-\\d{2}"
        style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;">
      <label style="font-size:.82rem;font-weight:700;color:#8a7d72;">Slots (0 = hard block)</label>
      <input name="slots" type="number" min="0" max="99" value="0"
        style="width:80px;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;">
      <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.4em 1em;cursor:pointer;">Save</button>
    </form>
  `;

  return htmlResponse(adminShell(`Calendar — ${esc(monthLabel)}`, user, inner));
}

// ── handleAdminTemplates ──────────────────────────────────────────────────────

interface MessageTemplate {
  key: string;
  name: string;
  subject: string;
  body_html: string;
  enabled: boolean;
  send_offset_days: number | null;
  updated_at: string;
}

/**
 * GET  /api/admin/templates           — list all templates
 * GET  /api/admin/templates/:key      — edit form for one template
 * POST /api/admin/templates/:key      — save subject + body_html + enabled
 */
export async function handleAdminTemplates(
  req: Request,
  env: DashboardEnv,
  templateKey: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const hdr = supabaseHeaders(env);
  const url = new URL(req.url);

  // POST /api/admin/templates/:key — save changes
  if (req.method === "POST" && templateKey) {
    let subject = "";
    let bodyHtml = "";
    let enabled = false;
    try {
      const fd = await req.formData();
      subject = ((fd.get("subject") as string | null) ?? "").trim();
      bodyHtml = (fd.get("body_html") as string | null) ?? "";
      enabled = (fd.get("enabled") as string | null) === "1";
    } catch {
      return htmlResponse(`<p>Invalid form. <a href="/api/admin/templates">Back</a></p>`, 400);
    }
    if (!subject) return htmlResponse(`<p>Subject required. <a href="/api/admin/templates/${esc(templateKey)}">Back</a></p>`, 400);

    await fetchFn(supabaseUrl(env, `message_templates?key=eq.${encodeURIComponent(templateKey)}`), {
      method: "PATCH",
      headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ subject, body_html: bodyHtml, enabled, updated_at: new Date().toISOString() }),
    });

    return new Response(null, { status: 302, headers: { Location: `/api/admin/templates/${templateKey}?saved=1` } });
  }

  // GET /api/admin/templates/:key — edit form
  if (req.method === "GET" && templateKey) {
    const res = await fetchFn(
      supabaseUrl(env, `message_templates?key=eq.${encodeURIComponent(templateKey)}&select=key,name,subject,body_html,enabled,send_offset_days,updated_at`),
      { headers: hdr },
    );
    const rows: MessageTemplate[] = res.ok ? ((await res.json()) as MessageTemplate[]) : [];
    if (!rows.length) return htmlResponse(adminShell("Template not found", user, `<p>Template <code>${esc(templateKey)}</code> not found. <a href="/api/admin/templates">Back</a></p>`), 404);
    const t = rows[0]!;
    const saved = url.searchParams.get("saved") === "1";

    const inner = `
      ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;">✓ Template saved.</div>` : ""}
      <a href="/api/admin/templates" style="font-size:.82rem;color:#8a3a52;">← All templates</a>
      <p style="font-size:.82rem;color:#8a7d72;margin:.5rem 0 1rem;">Key: <code>${esc(t.key)}</code> · Last updated: ${fmtDateTime(t.updated_at)}</p>
      <form method="POST" action="/api/admin/templates/${esc(t.key)}" style="display:flex;flex-direction:column;gap:1rem;max-width:700px;">
        <div>
          <label style="display:block;font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.35rem;">Subject</label>
          <input name="subject" type="text" value="${esc(t.subject)}" required
            style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .75em;">
        </div>
        <div>
          <label style="display:block;font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.35rem;">Body HTML</label>
          <textarea name="body_html" rows="10"
            style="width:100%;font:13px/1.5 monospace;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .75em;resize:vertical;">${esc(t.body_html)}</textarea>
        </div>
        <div>
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.88rem;color:#5c3d47;cursor:pointer;">
            <input type="checkbox" name="enabled" value="1"${t.enabled ? " checked" : ""}>
            Enabled (when unchecked the in-code fallback fires instead)
          </label>
        </div>
        <div>
          <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.55em 1.2em;cursor:pointer;">Save template</button>
        </div>
      </form>
      <h2 style="margin-top:2rem;">Preview (rendered HTML)</h2>
      <div style="border:1.5px solid #ede7e0;border-radius:8px;padding:1rem;background:#fff;max-width:700px;">
        <iframe srcdoc="${esc(t.body_html)}" sandbox="" style="width:100%;min-height:200px;border:none;"></iframe>
      </div>
    `;
    return htmlResponse(adminShell(`Template: ${esc(t.name)}`, user, inner));
  }

  // GET /api/admin/templates — list all
  const res = await fetchFn(
    supabaseUrl(env, "message_templates?select=key,name,subject,enabled,send_offset_days,updated_at&order=key.asc"),
    { headers: hdr },
  );
  const templates: MessageTemplate[] = res.ok ? ((await res.json()) as MessageTemplate[]) : [];

  const rows2 = templates.length
    ? templates.map((t) => `<tr>
        <td><a class="row-link" href="/api/admin/templates/${esc(t.key)}">${esc(t.key)}</a></td>
        <td>${esc(t.name)}</td>
        <td>${esc(t.subject)}</td>
        <td>${t.enabled ? `<span class="badge badge-deposit_paid">yes</span>` : `<span class="badge badge-invoice_expired">no</span>`}</td>
        <td>${t.send_offset_days != null ? `${t.send_offset_days}d` : "—"}</td>
        <td>${fmtDateTime(t.updated_at)}</td>
      </tr>`).join("\n")
    : `<tr><td colspan="6" class="empty">no templates found ✦</td></tr>`;

  const table = `<table>
    <thead><tr>
      <th>Key</th><th>Name</th><th>Subject</th><th>Enabled</th><th>Offset</th><th>Updated</th>
    </tr></thead>
    <tbody>${rows2}</tbody>
  </table>`;

  return htmlResponse(adminShell("Email Templates", user, table));
}

// ── handleAdminNotifications (Wave C.3) ──────────────────────────────────────

/**
 * GET /api/admin/notifications
 * Returns JSON: { count: N, items: [...] }
 * JWT-gated — browser fetches this from the notifications bell every 60s.
 */
export async function handleAdminNotifications(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const res = await fetchFn(
    supabaseUrl(
      env,
      `notifications?recipient=eq.admin&read_at=is.null&order=created_at.desc`,
    ),
    { headers: supabaseHeaders(env) },
  );

  const items: NotificationRow[] = res.ok
    ? ((await res.json()) as NotificationRow[])
    : [];

  return new Response(JSON.stringify({ count: items.length, items }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ── handleAdminNotificationsRead (Wave C.3) ───────────────────────────────────

/**
 * POST /api/admin/notifications/read
 * Body: { id: "uuid" } — mark one as read.
 * Body: {}             — mark all admin notifications as read.
 * JWT-gated.
 */
export async function handleAdminNotificationsRead(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let id: string | null = null;
  try {
    const body = (await req.json()) as { id?: string };
    const candidate = body.id ?? null;
    // Accept only UUID-shaped IDs to prevent injection via filter param
    if (candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
      id = candidate;
    }
  } catch { /* no body or invalid JSON — mark all */ }

  const filter = id
    ? `notifications?id=eq.${encodeURIComponent(id)}`
    : `notifications?recipient=eq.admin&read_at=is.null`;

  await fetchFn(supabaseUrl(env, filter), {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(env),
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
