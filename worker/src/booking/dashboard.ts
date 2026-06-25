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
import { listArtists, listBookingArtists, type ArtistRow, type BookingArtistRow } from "./artists";
import type { Env } from "../index";
import { checkRateLimit, RATE_LIMITS } from "../lib/rateLimit";
import { sendEmail, emailShell, ep, em as emFn, esc as emailEsc } from "../lib/email";

// Env used by dashboard handlers — Env + auth fields
export interface DashboardEnv extends Env {
  SUPABASE_JWT_SECRET: string;
  // Wave D3: email-keyed rate limit for POST /api/admin/login (optional — absent in tests that don't need it)
  RL_LOGIN_EMAIL?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
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

/**
 * Shared admin nav shell.
 * currentPath — the request's pathname, used to highlight the active nav item.
 */
export function adminShell(title: string, user: AdminUser, inner: string, currentPath = ""): string {
  function isActive(href: string): boolean {
    if (href === "/api/admin/forms")      return currentPath.startsWith("/api/admin/forms");
    if (href === "/api/admin/enquiries")  return currentPath.startsWith("/api/admin/enquiries");
    if (href === "/api/admin/contacts")   return currentPath.startsWith("/api/admin/contacts");
    if (href === "/api/admin/portfolio")  return currentPath.startsWith("/api/admin/portfolio");
    if (href === "/api/admin/blog")       return currentPath.startsWith("/api/admin/blog");
    if (href === "/api/admin/quotes")     return currentPath.startsWith("/api/admin/quotes");
    if (href === "/api/admin/rejections") return currentPath.startsWith("/api/admin/rejections");
    if (href === "/api/admin/calendar")   return currentPath.startsWith("/api/admin/calendar");
    if (href === "/api/admin/website")    return currentPath.startsWith("/api/admin/website");
    if (href === "/api/admin/templates")  return currentPath.startsWith("/api/admin/templates");
    if (href === "/api/admin/staffing")   return currentPath.startsWith("/api/admin/staffing");
    return currentPath === href;
  }

  function navLink(href: string, label: string, badgeId?: string): string {
    const active = isActive(href);
    const badge = badgeId
      ? `<span id="${badgeId}" style="display:none;background:#8a3a52;color:#fff;border-radius:20px;font-size:.7rem;font-weight:700;padding:.1em .5em;min-width:1.3em;text-align:center;margin-left:auto;line-height:1.5;"></span>`
      : "";
    return `<a href="${href}" style="display:flex;align-items:center;gap:.3rem;padding:.4rem .85rem;border-radius:7px;text-decoration:none;color:${active ? "#8a3a52" : "#5c3d47"};font-weight:${active ? "700" : "500"};font-size:.84rem;${active ? "background:#f7e8ec;" : ""}">${esc(label)}${badge}</a>`;
  }

  function navGroup(label: string, links: ReturnType<typeof navLink>[], defaultOpen: boolean): string {
    const groupId = `ng-${label.toLowerCase()}`;
    return `<div style="margin-top:.6rem;">
  <button class="nav-grp" data-group="${groupId}" aria-expanded="${defaultOpen}"
    style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:.2rem .85rem .3rem;background:none;border:none;cursor:pointer;text-align:left;">
    <span style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#c0a898;">${esc(label)}</span>
    <span class="nav-chev" style="font-size:.58rem;color:#c0a898;transition:transform .2s;transform:${defaultOpen ? "rotate(90deg)" : "none"};">▶</span>
  </button>
  <div id="${groupId}" style="overflow:hidden;transition:max-height .22s ease;max-height:${defaultOpen ? "400px" : "0"};">
    ${links.join("\n")}
  </div>
</div>`;
  }

  const bookingsLinks = [
    navLink("/api/admin/calendar",    "Calendar"),
    navLink("/api/admin/quotes",      "Invoices"),
    navLink("/api/admin/rejections",  "Declined"),
  ];
  const clientsLinks = [
    navLink("/api/admin/forms",      "Forms", "enq-badge"),
    navLink("/api/admin/contacts",   "Contacts"),
    navLink("/api/admin/enquiries",  "CRM"),
  ];
  const contentLinks = [
    navLink("/api/admin/portfolio",  "Portfolio"),
    navLink("/api/admin/website",    "Website"),
    navLink("/api/admin/blog",       "Blog"),
  ];
  const adminLinks = [
    navLink("/api/admin/dashboard",  "Inbox"),
    navLink("/api/admin/staffing",   "Staffing"),
    navLink("/api/admin/templates",  "Templates"),
  ];

  const nav = [
    navGroup("Admin",    adminLinks,    adminLinks.some((_, i) =>
      isActive(["/api/admin/dashboard", "/api/admin/staffing", "/api/admin/templates"][i]!))),
    navGroup("Bookings", bookingsLinks, bookingsLinks.some((_, i) =>
      isActive(["/api/admin/calendar", "/api/admin/quotes", "/api/admin/rejections"][i]!))),
    navGroup("Clients",  clientsLinks,  clientsLinks.some((_, i) =>
      isActive(["/api/admin/forms", "/api/admin/contacts", "/api/admin/enquiries"][i]!))),
    navGroup("Content",  contentLinks,  contentLinks.some((_, i) =>
      isActive(["/api/admin/portfolio", "/api/admin/website", "/api/admin/blog"][i]!))),
  ].join("\n");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="https://lustiqueco.co.za/favicon.svg"><title>${esc(title)} — Lustique Admin</title>
<style>
  *,*::before,*::after{box-sizing:border-box;}
  body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;display:flex;min-height:100vh;}
  .sidebar{width:230px;position:fixed;top:0;left:0;height:100vh;overflow-y:auto;background:#fff;border-right:1px solid #ede7e0;padding:1.5rem .75rem 1.5rem;display:flex;flex-direction:column;flex-shrink:0;}
  .sidebar-logo{display:block;width:72px;margin:0 auto 1.2rem;opacity:.92;}
  .main{flex:1;padding:2rem 2.5rem;overflow-x:auto;margin-left:230px;}
  h1{font-size:1.35rem;margin:0 0 1.5rem;color:#2b2b2b;}
  h2{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;margin:1.6rem 0 .7rem;}
  .sidebar-footer{margin-top:auto;padding-top:1rem;border-top:1px solid #f3ede8;}
  .meta{font-size:.82rem;color:#8a7d72;padding:.3rem .85rem .2rem;}
  .logout{display:block;width:100%;margin-top:.4rem;padding:.35rem .85rem;font:inherit;font-size:.82rem;font-weight:600;color:#8a3a52;background:none;border:1.5px solid #e0c8c8;border-radius:8px;cursor:pointer;text-align:left;}
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
  .notif-bell{width:100%;padding:.35rem .85rem;font:inherit;font-size:.82rem;font-weight:500;color:#5c3d47;background:none;border:none;cursor:pointer;text-align:left;border-radius:7px;display:flex;align-items:center;gap:.5rem;}
  .notif-bell:hover{background:#f7f3ef;}
  .notif-count{display:none;background:#8a3a52;color:#fff;border-radius:20px;font-size:.7rem;font-weight:700;padding:.1em .5em;min-width:1.3em;text-align:center;}
</style></head><body>
<nav class="sidebar">
  <img src="https://lustiqueco.co.za/assets/logo.png" alt="Lustique Co." class="sidebar-logo">
  ${nav}
  <div style="margin-top:.6rem;" id="notif-wrap">
    <button class="notif-bell" id="notif-bell" aria-label="Notifications" aria-haspopup="true">
      <span>🔔</span><span>Notifications</span><span class="notif-count" id="notif-badge"></span>
    </button>
    <div id="notif-dropdown" role="menu" style="display:none;position:fixed;width:290px;background:#fff;border:1.5px solid #ede7e0;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.12);z-index:9999;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .9rem;border-bottom:1px solid #ede7e0;">
        <span style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;">Notifications</span>
        <button onclick="markAllRead()" style="font:inherit;font-size:.75rem;font-weight:700;color:#8a3a52;background:none;border:none;cursor:pointer;padding:0;">Mark all read</button>
      </div>
      <div id="notif-list" style="max-height:300px;overflow-y:auto;"></div>
    </div>
  </div>
  <div class="sidebar-footer">
    <div class="meta">${esc(user.name)}</div>
    <form method="POST" action="/api/admin/auth/logout">
      <button type="submit" class="logout">Sign out</button>
    </form>
  </div>
</nav>
<main class="main">
  <h1>${esc(title)}</h1>
  ${inner}
</main>
<script>
(function(){
  var bell=document.getElementById('notif-bell');
  var badge=document.getElementById('notif-badge');
  var enqBadge=document.getElementById('enq-badge');
  var dropdown=document.getElementById('notif-dropdown');
  var list=document.getElementById('notif-list');
  function poll(){
    fetch('/api/admin/notifications')
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){
        if(!d)return;
        if(d.count>0){badge.textContent=d.count;badge.style.display='inline-block';}
        else{badge.style.display='none';}
        if(enqBadge){
          var ec=d.items.filter(function(n){return n.type==='enquiry_received';}).length;
          if(ec>0){enqBadge.textContent=ec;enqBadge.style.display='inline-block';}
          else{enqBadge.style.display='none';}
        }
        renderItems(d.items);
      }).catch(function(){});
  }
  var NOTIF_ICON={enquiry_received:'💬',deposit_paid:'💳',balance_due:'⏰',contact_added:'👤',invoice_rejected:'❌',balance_paid:'✅',invoice_expired:'📋',booking_requested:'📝'};
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
      a.style.cssText='display:flex;align-items:flex-start;gap:.5rem;padding:.65rem .9rem;border-bottom:1px solid #f3ede8;text-decoration:none;color:#2b2b2b;';
      a.addEventListener('click',function(){markRead(n.id);});
      var icon=document.createElement('span');
      icon.style.cssText='font-size:1rem;line-height:1.3;flex-shrink:0;';
      icon.textContent=NOTIF_ICON[n.type]||'🔔';
      a.appendChild(icon);
      var txt=document.createElement('div');txt.style.cssText='min-width:0;';
      var t=document.createElement('div');
      t.style.cssText='font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      t.textContent=n.title;txt.appendChild(t);
      if(n.body){var b=document.createElement('div');b.style.cssText='font-size:.78rem;color:#8a7d72;margin-top:.15rem;';b.textContent=n.body;txt.appendChild(b);}
      a.appendChild(txt);
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
    var open=dropdown.style.display==='none';
    if(open){
      var r=bell.getBoundingClientRect();
      dropdown.style.left=r.left+'px';
      dropdown.style.top=(r.top-8)+'px';
      dropdown.style.transform='translateY(-100%)';
    }
    dropdown.style.display=open?'block':'none';
  });
  document.addEventListener('click',function(){dropdown.style.display='none';});
  poll();
  setInterval(poll,60000);
}());
(function(){
  var STORE_KEY='lq-nav-groups';
  function saved(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'{}');}catch(e){return{};}}
  function save(k,v){try{var s=saved();s[k]=v;localStorage.setItem(STORE_KEY,JSON.stringify(s));}catch(e){}}
  document.querySelectorAll('.nav-grp').forEach(function(btn){
    var gid=btn.getAttribute('data-group');
    var content=document.getElementById(gid);
    if(!content)return;
    var s=saved();
    if(gid in s){
      var open=s[gid];
      btn.setAttribute('aria-expanded',open);
      content.style.maxHeight=open?'400px':'0';
      var chev=btn.querySelector('.nav-chev');
      if(chev)chev.style.transform=open?'rotate(90deg)':'none';
    }
    btn.addEventListener('click',function(){
      var isOpen=btn.getAttribute('aria-expanded')==='true';
      var next=!isOpen;
      btn.setAttribute('aria-expanded',next);
      content.style.maxHeight=next?'400px':'0';
      var chev=btn.querySelector('.nav-chev');
      if(chev)chev.style.transform=next?'rotate(90deg)':'none';
      save(gid,next);
    });
  });
}());
</script>
</body></html>`;
}

function formatZAR(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STATUS_LABELS: Record<string, string> = {
  requested: "New request",
  quote_sent: "Invoice sent",
  accepted: "Awaiting booking fee",
  deposit_paid: "Booking fee paid",
  settled: "Settled",
  declined: "Declined",
  rejected: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  invoice_expired: "Invoice expired",
};

function statusBadge(status: string): string {
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, " ");
  return `<span class="badge badge-${esc(status)}">${esc(label)}</span>`;
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
<meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="https://lustiqueco.co.za/favicon.svg"><title>Admin Login — Lustique Co.</title>
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
  .peony{position:fixed;bottom:-120px;right:-80px;width:420px;opacity:0.58;mix-blend-mode:multiply;pointer-events:none;user-select:none;z-index:0;}
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
  <details style="margin-top:2rem;">
    <summary style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#A89080;cursor:pointer;list-style:none;text-align:center;">Sign in with password instead</summary>
    <form method="POST" action="/api/admin/auth/password" style="margin-top:1rem;">
      <label for="pw-email">Email address</label>
      <input id="pw-email" type="email" name="email" autocomplete="email" required placeholder="info@lustiqueco.co.za">
      <label for="pw-password" style="margin-top:1rem;">Password</label>
      <input id="pw-password" type="password" name="password" autocomplete="current-password" required placeholder="••••••••">
      <button type="submit">Sign in</button>
    </form>
  </details>
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

  // Wave D3: email-keyed rate limit — blunts distributed OTP abuse across many IPs.
  // Applied after email validation (email is now known) and before the Supabase OTP call.
  // The IP-keyed guard (RL_LOGIN) lives in index.ts and fires before this handler is called.
  if (env.RL_LOGIN_EMAIL) {
    const rl = await checkRateLimit(env.RL_LOGIN_EMAIL, email, RATE_LIMITS.LOGIN_EMAIL);
    if (!rl.success) {
      const resp = htmlResponse(
        `<p>Too many requests. Please try again later. <a href="/api/admin/login">Return to login</a>.</p>`,
        429,
      );
      const headers = new Headers(resp.headers);
      headers.set("retry-after", String(rl.retryAfter));
      return new Response(resp.body, { status: 429, headers });
    }
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
      body: JSON.stringify({
        email,
        create_user: false,
        redirect_to: `${new URL(req.url).origin}/api/admin/auth/callback`,
      }),
    });
  } catch { /* network error — still show the check-email page */ }

  return htmlResponse(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="https://lustiqueco.co.za/favicon.svg"><title>Check your email — Lustique Co.</title>
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

// ── handleAdminPasswordLogin ──────────────────────────────────────────────────

/** POST /api/admin/auth/password — password login alternative to magic link. */
export async function handleAdminPasswordLogin(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  let email = "";
  let password = "";
  try {
    const body = await req.formData();
    email = (body.get("email") as string | null)?.trim() ?? "";
    password = (body.get("password") as string | null) ?? "";
  } catch {
    return loginRedirect("error");
  }

  if (!email || !password) return loginRedirect("invalid-credentials");

  // Rate-limit by email (same budget as OTP to prevent brute-force).
  if (env.RL_LOGIN_EMAIL) {
    const rl = await checkRateLimit(env.RL_LOGIN_EMAIL, email, RATE_LIMITS.LOGIN_EMAIL);
    if (!rl.success) {
      const resp = htmlResponse(
        `<p>Too many attempts. Please wait before trying again. <a href="/api/admin/login">Return to login</a>.</p>`,
        429,
      );
      const headers = new Headers(resp.headers);
      headers.set("retry-after", String(rl.retryAfter));
      return new Response(resp.body, { status: 429, headers });
    }
  }

  let accessToken: string;
  try {
    const res = await fetchFn(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return loginRedirect("invalid-credentials");
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return loginRedirect("invalid-credentials");
    accessToken = data.access_token;
  } catch {
    return loginRedirect("error");
  }

  // Validate the token via Supabase API (avoids local JWT secret dependency).
  let authUser: { id: string; email: string };
  try {
    const userRes = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!userRes.ok) return loginRedirect("invalid-credentials");
    authUser = (await userRes.json()) as { id: string; email: string };
    if (!authUser.id) return loginRedirect("invalid-credentials");
  } catch {
    return loginRedirect("error");
  }

  const profileRes = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${authUser.id}&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    },
  ).catch(() => null);
  if (!profileRes?.ok) return loginRedirect("error");
  const profiles = (await profileRes.json()) as Array<{ role: string }>;
  if (!profiles.length || profiles[0]!.role !== "admin") return loginRedirect("invalid-credentials");

  return new Response(null, {
    status: 302,
    headers: { Location: "/api/admin/dashboard", "Set-Cookie": sessionCookieHeader(accessToken) },
  });
}

// ── handleAdminAuthCallback ──────────────────────────────────────────────────

/**
 * GET /api/admin/auth/callback
 *
 * Handles three flows in order of precedence:
 *
 * 1. ?token_hash=...&type=email  — custom template flow ({{.TokenHash}})
 *    Exchanges token_hash for an access_token via /auth/v1/verify.
 *
 * 2. ?access_token=...           — fragment extraction flow (step 2 below)
 *    Validates the JWT directly and sets the session cookie.
 *
 * 3. No params                   — default Supabase template flow
 *    Supabase redirects here with tokens in the URL fragment (#access_token=...).
 *    Fragments are invisible to the server, so we serve a tiny JS page that reads
 *    window.location.hash and redirects back here with access_token as a query param.
 */
export async function handleAdminAuthCallback(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";
  const accessTokenParam = url.searchParams.get("access_token");

  // Flow 1: token_hash — exchange for access_token via Supabase verify endpoint
  if (tokenHash) {
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
      headers: { Location: "/api/admin/dashboard", "Set-Cookie": sessionCookieHeader(accessToken) },
    });
  }

  // Flow 2: access_token query param — extracted from fragment by the JS page below
  if (accessTokenParam) {
    const userRes = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${accessTokenParam}`,
      },
    });
    if (!userRes.ok) return loginRedirect("expired-link");
    return new Response(null, {
      status: 302,
      headers: { Location: "/api/admin/dashboard", "Set-Cookie": sessionCookieHeader(accessTokenParam) },
    });
  }

  // Flow 3: no params — Supabase default template puts tokens in the URL fragment.
  // Serve a JS extraction page; it reads the fragment and redirects back with ?access_token=
  return new Response(
    `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="https://lustiqueco.co.za/favicon.svg"><title>Signing in — Lustique Co.</title>
</head><body>
<script>
(function(){
  var h=window.location.hash.slice(1);
  var p=new URLSearchParams(h);
  var t=p.get('access_token');
  if(t){window.location.replace('/api/admin/auth/callback?access_token='+encodeURIComponent(t));}
  else{window.location.replace('/api/admin/login?msg=invalid-link');}
})();
</script>
<noscript><p style="font-family:sans-serif;padding:2rem;">
  Redirecting… <a href="/api/admin/login">Back to login</a>
</p></noscript>
</body></html>`,
    { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } },
  );
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
  <th>Party</th><th>Total</th><th>Status</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;

  return htmlResponse(adminShell("Inbox", user, table, new URL(req.url).pathname));
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

const ARTIST_ASSIGNABLE_STATUSES = ["quote_sent", "accepted"];

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

  // GET — fetch booking + related data (+ artists for widget)
  const artistsEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET ?? "",
    AUDIT: env.AUDIT,
  };

  const [bRes, pRes, qrRes, rjRes, allArtists, assignedArtists] = await Promise.all([
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
    listArtists(artistsEnv, fetchFn).catch((): ArtistRow[] => []),
    listBookingArtists(artistsEnv, id, fetchFn).catch((): BookingArtistRow[] => []),
  ]);

  if (!bRes.ok) return htmlResponse(`<p>Fetch error. <a href="/api/admin/dashboard">Back</a></p>`, 502);
  const bookings = (await bRes.json()) as BookingDetail[];
  if (!bookings.length) return htmlResponse(adminShell("Not found", user, `<p>Booking not found.</p>`, new URL(req.url).pathname), 404);
  const b = bookings[0]!;
  const payments: PaymentRow[] = pRes.ok ? ((await pRes.json()) as PaymentRow[]) : [];
  const revisions: QuoteRevision[] = qrRes.ok ? ((await qrRes.json()) as QuoteRevision[]) : [];
  const rejections: RejectionRow[] = rjRes.ok ? ((await rjRes.json()) as RejectionRow[]) : [];

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";
  const errorMsg = url.searchParams.get("error");

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
    : `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">Editing locked — status is <strong>${esc(STATUS_LABELS[b.status] ?? b.status)}</strong>.</p>`;

  // ── Artist assignment widget ────────────────────────────────────────────────
  const canAssign = ARTIST_ASSIGNABLE_STATUSES.includes(b.status);
  const assignedIds = new Set(assignedArtists.map((a) => a.artist_id));

  const assignedRowsHtml = assignedArtists.length
    ? assignedArtists.map((a) => `
        <tr>
          <td>${esc(a.artists.name)}</td>
          <td><span class="badge" style="background:${a.lead ? "#e9d8fd" : "#ebf8ff"};color:${a.lead ? "#553c9a" : "#2b6cb0"};">${a.lead ? "Lead" : "Artist"}</span></td>
          <td>
            ${canAssign ? `<form method="POST" action="/api/admin/booking/${esc(id)}/artists/remove" style="display:inline;">
              <input type="hidden" name="artist_id" value="${esc(a.artist_id)}">
              <button type="submit" style="font:inherit;font-size:.8rem;font-weight:700;color:#c53030;background:none;border:1.5px solid #f5c6c6;border-radius:6px;padding:.2em .7em;cursor:pointer;">Remove</button>
            </form>` : ""}
          </td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty">No artists assigned.</td></tr>`;

  const unassignedArtists = allArtists.filter((a) => !assignedIds.has(a.id));
  const artistOptions = unassignedArtists
    .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
    .join("");

  const assignFormHtml = canAssign && unassignedArtists.length
    ? `<form method="POST" action="/api/admin/booking/${esc(id)}/artists" style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;flex-wrap:wrap;">
        <select name="artist_id" required style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;min-width:160px;">
          <option value="">Select artist…</option>
          ${artistOptions}
        </select>
        <select name="lead" style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;">
          <option value="false">Artist</option>
          <option value="true">Lead</option>
        </select>
        <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.4em 1em;cursor:pointer;">Assign artist</button>
      </form>`
    : canAssign && !unassignedArtists.length
      ? `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">All artists are already assigned.</p>`
      : `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">Artist assignment locked — status is <strong>${esc(b.status)}</strong>.</p>`;

  const artistsHtml = `
    <table><thead><tr><th>Artist</th><th>Role</th><th></th></tr></thead>
    <tbody>${assignedRowsHtml}</tbody></table>
    ${assignFormHtml}`;

  const actionsHtml = (() => {
    if (b.status === "quote_sent") {
      return `<h2>Actions</h2>
        <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.5rem;">
          <form method="POST" action="/api/admin/booking/${esc(id)}/send-quote">
            <button type="submit" style="font:inherit;font-weight:700;background:#276749;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Resend the deposit invoice to ${esc(b.bride_name.replace(/'/g, "\\'"))}? She will receive a fresh email with a new link.')">
              Resend Deposit Invoice →
            </button>
          </form>
          <form method="POST" action="/api/admin/booking/${esc(id)}/decline-booking">
            <button type="submit" style="font:inherit;font-weight:700;background:#c53030;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Decline this booking? This emails ${esc(b.bride_name.replace(/'/g, "\\'"))} a polite decline — this cannot be undone.')">
              Decline Booking
            </button>
          </form>
        </div>`;
    }
    if (b.status === "requested") {
      return `<h2>Actions</h2>
        <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.5rem;">
          <form method="POST" action="/api/admin/booking/${esc(id)}/send-quote">
            <button type="submit" style="font:inherit;font-weight:700;background:#276749;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Send the deposit invoice to ${esc(b.bride_name.replace(/'/g, "\\'"))}? This emails her a link to choose her booking fee and secure the date.')">
              Send Deposit Invoice →
            </button>
          </form>
          <form method="POST" action="/api/admin/booking/${esc(id)}/decline-booking">
            <button type="submit" style="font:inherit;font-weight:700;background:#c53030;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Decline this booking? This emails ${esc(b.bride_name.replace(/'/g, "\\'"))} a polite decline — this cannot be undone.')">
              Decline Booking
            </button>
          </form>
        </div>`;
    }
    if (b.status === "accepted" || b.status === "confirmed") {
      return `<h2>Actions</h2>
        <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.5rem;">
          <form method="POST" action="/api/admin/booking/${esc(id)}/mark-deposit">
            <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Mark EFT booking fee as received? This emails ${esc(b.bride_name.replace(/'/g, "\\'"))} her date-secured confirmation.')">
              Mark EFT Booking Fee Paid
            </button>
          </form>
        </div>`;
    }
    if (b.status === "deposit_paid") {
      return `<h2>Actions</h2>
        <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.5rem;">
          <form method="POST" action="/api/admin/booking/${esc(id)}/mark-balance">
            <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.55em 1.3em;cursor:pointer;"
              onclick="return confirm('Mark EFT balance as received? This emails ${esc(b.bride_name.replace(/'/g, "\\'"))} her all-paid confirmation.')">
              Mark EFT Balance Paid
            </button>
          </form>
        </div>`;
    }
    return "";
  })();

  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;">✓ Saved.</div>` : ""}
    ${errorMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;color:#c53030;font-size:.88rem;">Error: ${esc(errorMsg)}</div>` : ""}
    <a href="/api/admin/dashboard" style="font-size:.82rem;color:#8a3a52;">← Inbox</a>
    ${actionsHtml}
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
          <tr><td style="color:#8a7d72;">Invoice sent</td><td>${fmtDateTime(b.quote_sent_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Booking fee chosen</td><td>${fmtDateTime(b.accepted_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Booking fee %</td><td>${b.deposit_pct != null ? `${b.deposit_pct}%` : "—"}</td></tr>
          <tr><td style="color:#8a7d72;">Total</td><td><strong>${formatZAR(b.total_cents)}</strong></td></tr>
          <tr><td style="color:#8a7d72;">Booking fee</td><td>${formatZAR(b.deposit_net_cents)}</td></tr>
          <tr><td style="color:#8a7d72;">Balance</td><td>${formatZAR(b.balance_net_cents)}</td></tr>
        </tbody></table>
      </div>
    </div>
    <h2>Invoice lines</h2>
    <table><thead><tr><th>Service</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${quoteLines || `<tr><td colspan="2" class="empty">—</td></tr>`}</tbody></table>
    <h2>Edit total</h2>
    ${editForm}
    <h2>Payments</h2>${paymentsHtml}
    <h2>Revisions</h2>${revisionsHtml}
    <h2>Rejections</h2>${rejectionsHtml}
    <h2>Artists</h2>${artistsHtml}
    ${b.notes ? `<h2>Notes</h2><p style="white-space:pre-wrap;">${esc(b.notes)}</p>` : ""}
  `;

  return htmlResponse(adminShell(`${b.reference} — Detail`, user, inner, new URL(req.url).pathname));
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
  status: string;
  quote_sent_at: string | null;
}

interface InvoiceBooking {
  id: string;
  reference: string;
  bride_name: string;
  wedding_date: string;
  town: string | null;
  party_size: number;
  total_cents: number;
  status: string;
}

/** GET /api/admin/quotes — tabbed: Quotes | Invoices | Payments */
export async function handleAdminQuotes(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") ?? "quotes";

  function tabLink(t: string, label: string): string {
    const active = tab === t;
    return `<a href="/api/admin/quotes?tab=${t}" style="padding:.45rem 1.1rem;border-radius:8px;text-decoration:none;font-size:.86rem;font-weight:${active ? "700" : "500"};color:${active ? "#8a3a52" : "#6b5d52"};background:${active ? "#f7e8ec" : "transparent"};">${label}</a>`;
  }

  const tabBar = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.4rem;">
  <div style="display:flex;gap:.3rem;background:#f7f3ef;border-radius:10px;padding:.3rem;">
    ${tabLink("quotes", "Pending")}
    ${tabLink("invoices", "Confirmed")}
    ${tabLink("payments", "Payments")}
  </div>
  <a href="/api/admin/quotes/new" style="display:inline-flex;align-items:center;gap:.4rem;background:#8a3a52;color:#fff;text-decoration:none;border-radius:8px;padding:.45rem 1.1rem;font-size:.86rem;font-weight:600;">+ Create Invoice</a>
</div>`;

  let body = "";

  if (tab === "quotes") {
    const res = await fetchFn(
      supabaseUrl(env, `bookings?status=in.(requested,quote_sent)&select=id,reference,bride_name,bride_email,wedding_date,town,party_size,total_cents,status,quote_sent_at&order=wedding_date.asc`),
      { headers: supabaseHeaders(env) },
    );
    const bookings: QuoteSentBooking[] = res.ok ? ((await res.json()) as QuoteSentBooking[]) : [];
    const now = Date.now();
    const rows = bookings.length
      ? bookings.map((b) => {
          const isRequested = b.status === "requested";
          const sentMs = b.quote_sent_at ? new Date(b.quote_sent_at).getTime() : now;
          const daysLeft = isRequested ? null : Math.max(0, Math.ceil((sentMs + 14 * 24 * 60 * 60 * 1000 - now) / 86400000));
          const urgent = daysLeft !== null && daysLeft <= 2;
          const statusCell = isRequested
            ? `<span class="badge badge-requested">New request</span>`
            : `<span class="badge badge-quote_sent">Invoice sent</span>`;
          const expiresCell = daysLeft === null
            ? `<span style="color:#b7791f;font-weight:600;">Needs invoice</span>`
            : `<span style="color:${urgent ? "#c53030" : "#276749"};font-weight:700;">${daysLeft}d left</span>`;
          return `<tr>
            <td><a class="row-link" href="/api/admin/booking/${esc(b.id)}">${esc(b.reference)}</a></td>
            <td>${esc(b.bride_name)}</td>
            <td><a href="mailto:${esc(b.bride_email)}" style="color:#8a3a52;">${esc(b.bride_email)}</a></td>
            <td>${esc(b.wedding_date)}</td>
            <td>${esc(b.town ?? "—")}</td>
            <td>${b.party_size}</td>
            <td>${formatZAR(b.total_cents)}</td>
            <td>${statusCell}</td>
            <td>${expiresCell}</td>
          </tr>`;
        }).join("\n")
      : `<tr><td colspan="9" class="empty">no pending invoices ✦</td></tr>`;
    body = `<table><thead><tr>
      <th>Reference</th><th>Bride</th><th>Email</th><th>Wedding</th><th>Town</th>
      <th>Party</th><th>Total</th><th>Status</th><th>Expires</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

  } else if (tab === "invoices") {
    const res = await fetchFn(
      supabaseUrl(env, `bookings?status=in.(accepted,deposit_paid,settled)&select=id,reference,bride_name,wedding_date,town,party_size,total_cents,status&order=wedding_date.asc`),
      { headers: supabaseHeaders(env) },
    );
    const bookings: InvoiceBooking[] = res.ok ? ((await res.json()) as InvoiceBooking[]) : [];
    const rows = bookings.length
      ? bookings.map((b) => `<tr>
          <td><a class="row-link" href="/api/admin/booking/${esc(b.id)}">${esc(b.reference)}</a></td>
          <td>${esc(b.bride_name)}</td>
          <td>${esc(b.wedding_date)}</td>
          <td>${esc(b.town ?? "—")}</td>
          <td>${b.party_size}</td>
          <td>${formatZAR(b.total_cents)}</td>
          <td>${statusBadge(b.status)}</td>
        </tr>`).join("\n")
      : `<tr><td colspan="7" class="empty">no active invoices ✦</td></tr>`;
    body = `<table><thead><tr>
      <th>Reference</th><th>Bride</th><th>Wedding</th><th>Town</th>
      <th>Party</th><th>Total</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

  } else {
    // payments tab — reuse payments query
    const res = await fetchFn(
      supabaseUrl(env, `payments?select=id,kind,status,net_cents,payable_cents,yoco_checkout_id,yoco_payment_id,created_at,paid_at,bookings(reference,bride_name,wedding_date)&order=created_at.desc`),
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
    body = `<table><thead><tr>
      <th>Reference</th><th>Bride</th><th>Wedding</th><th>Kind</th><th>Status</th>
      <th>Net</th><th>Payable</th><th>Method</th><th>Paid at</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }

  return htmlResponse(adminShell("Invoices", user, tabBar + body, url.pathname));
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

  return htmlResponse(adminShell("Payments", user, table, new URL(req.url).pathname));
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

  return htmlResponse(adminShell("Rejections", user, table, new URL(req.url).pathname));
}

// ── handleAdminCalendar ───────────────────────────────────────────────────────

interface CalendarBooking {
  wedding_date: string;
  status: string;
  occasion: string;
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
        `bookings?wedding_date=gte.${monthStart}&wedding_date=lte.${monthEnd}&status=in.(requested,quote_sent,accepted,deposit_paid,settled)&select=wedding_date,status,occasion`,
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

  const CONFIRMED = new Set(["deposit_paid", "settled"]);

  // Build day-count + occasion maps — confirmed (paid) vs pending (pre-payment)
  const confirmedByDay = new Map<string, number>();
  const pendingByDay   = new Map<string, number>();
  const trialsByDay    = new Map<string, number>();
  const weddingsByDay  = new Map<string, number>();
  const matricByDay    = new Map<string, number>();
  for (const b of bookings) {
    const d = b.wedding_date.slice(0, 10);
    if (CONFIRMED.has(b.status)) {
      confirmedByDay.set(d, (confirmedByDay.get(d) ?? 0) + 1);
    } else {
      pendingByDay.set(d, (pendingByDay.get(d) ?? 0) + 1);
    }
    if (b.occasion === "trial") {
      trialsByDay.set(d, (trialsByDay.get(d) ?? 0) + 1);
    } else if (b.occasion === "matric") {
      matricByDay.set(d, (matricByDay.get(d) ?? 0) + 1);
    } else {
      weddingsByDay.set(d, (weddingsByDay.get(d) ?? 0) + 1);
    }
  }
  const slotsByDay = new Map<string, number>();
  for (const bd of blockedDates) {
    slotsByDay.set(bd.date.slice(0, 10), bd.slots);
  }

  // Today in UTC for highlighting
  const nowUtc = new Date();
  const todayStr = `${nowUtc.getUTCFullYear()}-${String(nowUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(nowUtc.getUTCDate()).padStart(2, "0")}`;

  // Month grid
  const daysInMonth = lastDay.getUTCDate();
  const startDow = firstDay.getUTCDay(); // 0=Sun
  const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthLabel = firstDay.toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

  const cellStyle = "vertical-align:top;padding:.55rem .6rem;border:1px solid #ede7e0;min-width:90px;min-height:80px;cursor:pointer;transition:box-shadow .1s;";

  let cells = "";
  for (let i = 0; i < startDow; i++) {
    cells += `<td style="${cellStyle}background:#f9f6f3;cursor:default;"></td>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const confirmed = confirmedByDay.get(dateStr) ?? 0;
    const pending   = pendingByDay.get(dateStr) ?? 0;
    const slots = slotsByDay.get(dateStr) ?? null;
    const isBlocked = slots === 0;
    // Only confirmed (paid) bookings count against capacity
    const overCapacity = slots !== null && slots > 0 && confirmed >= slots;
    const isToday = dateStr === todayStr;

    const bg = isBlocked ? "#fde8e8" : overCapacity ? "#fef3cd" : confirmed > 0 ? "#edfcf2" : pending > 0 ? "#fffbeb" : "#fff";
    const todayRing = isToday ? "box-shadow:inset 0 0 0 2px #8a3a52;" : "";

    // Dots: solid green = confirmed/paid, outlined amber = pending (pre-payment)
    const confirmedDots = confirmed > 0
      ? Array.from({ length: Math.min(confirmed, 3) }, () =>
          `<span style="width:7px;height:7px;border-radius:50%;background:#276749;display:inline-block;"></span>`
        ).join("") + (confirmed > 3 ? `<span style="font-size:.65rem;color:#276749;font-weight:700;line-height:7px;">+${confirmed - 3}</span>` : "")
      : "";
    const pendingDots = pending > 0
      ? Array.from({ length: Math.min(pending, 3) }, () =>
          `<span style="width:7px;height:7px;border-radius:50%;border:1.5px solid #b7791f;display:inline-block;"></span>`
        ).join("") + (pending > 3 ? `<span style="font-size:.65rem;color:#b7791f;font-weight:700;line-height:7px;">+${pending - 3}</span>` : "")
      : "";
    const dots = (confirmedDots || pendingDots)
      ? `<div style="display:flex;gap:3px;margin-top:4px;flex-wrap:wrap;">${confirmedDots}${pendingDots}</div>`
      : "";

    const blockedTag = isBlocked
      ? `<div style="font-size:.65rem;color:#c53030;font-weight:700;margin-top:3px;text-transform:uppercase;letter-spacing:.04em;">Blocked</div>`
      : "";
    const slotsTag = !isBlocked && slots !== null
      ? `<div style="font-size:.65rem;color:#8a7d72;margin-top:2px;">${confirmed}/${slots} slots</div>`
      : "";

    const tw = trialsByDay.get(dateStr) ?? 0;
    const ww = weddingsByDay.get(dateStr) ?? 0;
    const mw = matricByDay.get(dateStr) ?? 0;
    const occasionBadges = [
      ww > 0 ? `<span style="font-size:.6rem;background:#f7e8ec;color:#8a3a52;border-radius:3px;padding:.05em .3em;font-weight:700;white-space:nowrap;">💍${ww > 1 ? " +" + ww : ""}</span>` : "",
      mw > 0 ? `<span style="font-size:.6rem;background:#fef9e7;color:#b7791f;border-radius:3px;padding:.05em .3em;font-weight:700;white-space:nowrap;">🎓${mw > 1 ? " +" + mw : ""}</span>` : "",
      tw > 0 ? `<span style="font-size:.6rem;background:#ebf8ff;color:#2b6cb0;border-radius:3px;padding:.05em .3em;font-weight:700;white-space:nowrap;">✂︎${tw > 1 ? " +" + tw : ""}</span>` : "",
    ].filter(Boolean).join(" ");
    const occasionRow = occasionBadges ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;">${occasionBadges}</div>` : "";

    cells += `<td style="${cellStyle}background:${bg};${todayRing}" onclick="fillDate('${dateStr}',${slots !== null ? slots : ''})" title="Click to set capacity for ${dateStr}">
      <div style="font-weight:700;font-size:.95rem;color:${isToday ? "#8a3a52" : "#2b2b2b"};">${d}${isToday ? `<span style="font-size:.62rem;font-weight:600;color:#8a3a52;margin-left:4px;">today</span>` : ""}</div>
      ${dots}${occasionRow}${blockedTag}${slotsTag}
    </td>`;
  }
  const total = startDow + daysInMonth;
  const endPad = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < endPad; i++) {
    cells += `<td style="${cellStyle}background:#f9f6f3;cursor:default;"></td>`;
  }

  // Build rows of 7
  const cellArr = cells.split("</td>").filter(Boolean).map((c) => c + "</td>");
  let rows = "";
  for (let i = 0; i < cellArr.length; i += 7) {
    rows += `<tr>${cellArr.slice(i, i + 7).join("")}</tr>`;
  }

  const saved = url.searchParams.get("saved") === "1";
  const inner = `
    ${saved ? `<div style="margin-bottom:1.2rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ Capacity updated.</div>` : ""}
    <div style="display:flex;align-items:center;gap:1.2rem;margin-bottom:1.2rem;">
      <a href="/api/admin/calendar?month=${prevMonth}" style="display:inline-flex;align-items:center;gap:.3rem;color:#8a3a52;text-decoration:none;font-weight:600;font-size:.88rem;padding:.3rem .7rem;border:1.5px solid #e0c8c8;border-radius:7px;">← Prev</a>
      <strong style="font-size:1.05rem;color:#2b2b2b;">${esc(monthLabel)}</strong>
      <a href="/api/admin/calendar?month=${nextMonth}" style="display:inline-flex;align-items:center;gap:.3rem;color:#8a3a52;text-decoration:none;font-weight:600;font-size:.88rem;padding:.3rem .7rem;border:1.5px solid #e0c8c8;border-radius:7px;">Next →</a>
    </div>
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
      <thead><tr>
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<th style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.4rem .6rem;border-bottom:2px solid #ede7e0;text-align:left;">${d}</th>`).join("")}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="display:flex;gap:1.2rem;margin-top:1rem;flex-wrap:wrap;align-items:center;">
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="width:10px;height:10px;border-radius:50%;background:#276749;display:inline-block;"></span>Booked</span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="width:10px;height:10px;border-radius:50%;background:#c53030;display:inline-block;"></span>Over capacity</span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="width:10px;height:10px;border-radius:2px;background:#fde8e8;border:1px solid #f5c6c6;display:inline-block;"></span>Blocked</span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="width:10px;height:10px;border-radius:2px;border:2px solid #8a3a52;display:inline-block;"></span>Today</span>
      <span style="width:1px;height:14px;background:#ede7e0;display:inline-block;"></span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="font-size:.72rem;background:#f7e8ec;color:#8a3a52;border-radius:3px;padding:.05em .35em;font-weight:700;">💍</span>Wedding</span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="font-size:.72rem;background:#fef9e7;color:#b7791f;border-radius:3px;padding:.05em .35em;font-weight:700;">🎓</span>Matric farewell</span>
      <span style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;color:#5c3d47;"><span style="font-size:.72rem;background:#ebf8ff;color:#2b6cb0;border-radius:3px;padding:.05em .35em;font-weight:700;">✂︎</span>Trial</span>
    </div>

    <div id="cap-form" style="margin-top:1.8rem;background:#fff;border:1px solid #ede7e0;border-radius:10px;padding:1.2rem 1.4rem;">
      <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.9rem;">Set Day Capacity</div>
      <p style="font-size:.82rem;color:#8a7d72;margin:0 0 .9rem;">Click any day to pre-fill the date, then set the number of bookings allowed (0 = fully blocked).</p>
      <form method="POST" action="/api/admin/calendar" style="display:flex;gap:.7rem;align-items:flex-end;flex-wrap:wrap;">
        <div>
          <label style="display:block;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.35rem;">Date</label>
          <input id="cap-date" name="date" type="date" required
            style="font:inherit;font-size:.9rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;">
        </div>
        <div>
          <label style="display:block;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.35rem;">Max bookings (0 = block)</label>
          <input id="cap-slots" name="slots" type="number" min="0" max="99" value="0"
            style="width:100px;font:inherit;font-size:.9rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;">
        </div>
        <button type="submit" style="font:inherit;font-weight:700;font-size:.88rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.52em 1.2em;cursor:pointer;white-space:nowrap;">Save</button>
      </form>
    </div>
    <script>
    function fillDate(d,s){
      document.getElementById('cap-date').value=d;
      if(s!==undefined&&s!==''){document.getElementById('cap-slots').value=s;}
      document.getElementById('cap-form').scrollIntoView({behavior:'smooth',block:'nearest'});
    }
    </script>
  `;

  return htmlResponse(adminShell(`Calendar — ${esc(monthLabel)}`, user, inner, new URL(req.url).pathname));
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
    if (!rows.length) return htmlResponse(adminShell("Template not found", user, `<p>Template <code>${esc(templateKey)}</code> not found. <a href="/api/admin/templates">Back</a></p>`, url.pathname), 404);
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
    return htmlResponse(adminShell(`Template: ${esc(t.name)}`, user, inner, url.pathname));
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

  return htmlResponse(adminShell("Email Templates", user, table, url.pathname));
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

// ── handleAdminWebsite ────────────────────────────────────────────────────────

/** GET /api/admin/website — placeholder: links to live site + Sanity CMS */
export async function handleAdminWebsite(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const inner = `<h1>Website</h1>
<div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:.5rem;">
  <a href="https://lustiqueco.co.za" target="_blank" rel="noopener" style="display:flex;flex-direction:column;gap:.4rem;background:#fff;border:1.5px solid #ede7e0;border-radius:12px;padding:1.4rem 1.6rem;text-decoration:none;color:inherit;">
    <span style="font-size:1.4rem;">🌐</span>
    <span style="font-weight:700;color:#2b2b2b;">View live site</span>
    <span style="font-size:.85rem;color:#8a7d72;">lustiqueco.co.za</span>
  </a>
  <a href="/api/admin/blog" style="display:flex;flex-direction:column;gap:.4rem;background:#fff;border:1.5px solid #ede7e0;border-radius:12px;padding:1.4rem 1.6rem;text-decoration:none;color:inherit;">
    <span style="font-size:1.4rem;">✍️</span>
    <span style="font-weight:700;color:#2b2b2b;">Blog</span>
    <span style="font-size:.85rem;color:#8a7d72;">Write & publish journal articles</span>
  </a>
  <a href="/api/admin/portfolio" style="display:flex;flex-direction:column;gap:.4rem;background:#fff;border:1.5px solid #ede7e0;border-radius:12px;padding:1.4rem 1.6rem;text-decoration:none;color:inherit;">
    <span style="font-size:1.4rem;">🖼️</span>
    <span style="font-weight:700;color:#2b2b2b;">Portfolio</span>
    <span style="font-size:.85rem;color:#8a7d72;">Upload & order gallery images</span>
  </a>
</div>
<p style="margin:1.8rem 0 0;font-size:.88rem;color:#8a7d72;">Site content — blog, portfolio — is managed directly from this dashboard. SEO and GA4 settings coming soon.</p>`;

  return htmlResponse(adminShell("Website", user, inner, new URL(req.url).pathname));
}

// ── handleAdminQuoteComposer ──────────────────────────────────────────────────

const QUOTE_CATALOG = [
  { label: "Bridal makeup — trial", price: 850 },
  { label: "Bridal makeup — wedding day", price: 850 },
  { label: "Bridal hair — trial (Short)", price: 495 },
  { label: "Bridal hair — trial (Medium)", price: 595 },
  { label: "Bridal hair — trial (Long)", price: 695 },
  { label: "Bridal hair — trial (X-Long)", price: 795 },
  { label: "Bridal hair — wedding day (Short)", price: 495 },
  { label: "Bridal hair — wedding day (Medium)", price: 595 },
  { label: "Bridal hair — wedding day (Long)", price: 695 },
  { label: "Bridal hair — wedding day (X-Long)", price: 795 },
  { label: "Bridesmaid makeup", price: 550 },
  { label: "Bridesmaid hair (Short)", price: 395 },
  { label: "Bridesmaid hair (Medium)", price: 495 },
  { label: "Bridesmaid hair (Long)", price: 595 },
  { label: "Bridesmaid hair (X-Long)", price: 695 },
  { label: "Mother of bride / groom makeup", price: 500 },
  { label: "Mother of bride / groom hair (Medium)", price: 495 },
  { label: "Mother of bride / groom hair (Long)", price: 595 },
  { label: "Flower girl (under 12) makeup", price: 250 },
  { label: "Flower girl (under 12) hair (Short)", price: 200 },
  { label: "Flower girl (over 12) makeup", price: 500 },
  { label: "Matric farewell makeup", price: 750 },
  { label: "Strip lashes add-on (per person)", price: 75 },
  { label: "Additional artist (on request)", price: 850 },
  { label: "Travel (0–30 km)", price: 0 },
  { label: "Travel (31–60 km)", price: 300 },
  { label: "Travel (61+ km)", price: 600 },
];

function quoteComposerForm(error?: string): string {
  const catalogOptions = QUOTE_CATALOG.map(
    (s) => `<option value="${esc(s.label)}|${s.price}">${esc(s.label)} — R ${s.price}</option>`,
  ).join("");

  return `<h1>Create Invoice</h1>
${error ? `<div style="background:#fff5f5;color:#c53030;border:1.5px solid #fed7d7;border-radius:8px;padding:.7rem 1rem;margin-bottom:1rem;font-size:.9rem;">${esc(error)}</div>` : ""}
<form method="POST" action="/api/admin/quotes/new" id="qform" style="max-width:820px;">

  <h2>Client details</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:.8rem;">
    <div><label style="display:block;font-size:.8rem;font-weight:600;color:#6b5d52;margin-bottom:.3rem;">Client name</label>
    <input name="client_name" required placeholder="e.g. Anri van Wyk" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .75em;"></div>
    <div><label style="display:block;font-size:.8rem;font-weight:600;color:#6b5d52;margin-bottom:.3rem;">Client email</label>
    <input name="client_email" type="email" required placeholder="anri@example.com" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .75em;"></div>
    <div><label style="display:block;font-size:.8rem;font-weight:600;color:#6b5d52;margin-bottom:.3rem;">Event date</label>
    <input name="event_date" type="date" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .75em;"></div>
    <div><label style="display:block;font-size:.8rem;font-weight:600;color:#6b5d52;margin-bottom:.3rem;">Event type</label>
    <select name="event_type" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .75em;">
      <option value="wedding">Wedding</option>
      <option value="matric">Matric Farewell</option>
      <option value="trial">Trial</option>
      <option value="event">Event</option>
      <option value="editorial">Editorial / Photoshoot</option>
    </select></div>
  </div>

  <h2 style="margin-top:1.4rem;">Line items</h2>
  <div style="margin-bottom:.7rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
    <select id="catalog" style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .8em;color:#5c3d47;">
      <option value="">+ Add from catalog...</option>
      ${catalogOptions}
    </select>
    <button type="button" onclick="addFromCatalog()" style="font:inherit;font-size:.86rem;font-weight:600;background:#f7e8ec;color:#8a3a52;border:1.5px solid #e0c8c8;border-radius:8px;padding:.4em 1em;cursor:pointer;">Add</button>
    <button type="button" onclick="addBlankRow()" style="font:inherit;font-size:.86rem;font-weight:600;background:none;color:#6b5d52;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em 1em;cursor:pointer;">+ Custom item</button>
  </div>

  <table id="items-table" style="width:100%;border-collapse:collapse;font-size:.9rem;">
    <thead><tr>
      <th style="text-align:left;font-size:.76rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem 0;border-bottom:1.5px solid #ede7e0;width:55%;">Description</th>
      <th style="text-align:right;font-size:.76rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem .5rem;border-bottom:1.5px solid #ede7e0;width:8%;">Qty</th>
      <th style="text-align:right;font-size:.76rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem .5rem;border-bottom:1.5px solid #ede7e0;width:16%;">Unit (R)</th>
      <th style="text-align:right;font-size:.76rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem 0;border-bottom:1.5px solid #ede7e0;width:16%;">Subtotal</th>
      <th style="border-bottom:1.5px solid #ede7e0;width:5%;"></th>
    </tr></thead>
    <tbody id="items-body"></tbody>
    <tfoot>
      <tr><td colspan="3" style="text-align:right;font-weight:700;padding:.7rem 0 .3rem;font-size:.95rem;">Total</td>
      <td style="text-align:right;font-weight:700;padding:.7rem 0 .3rem;font-size:.95rem;color:#8a3a52;" id="grand-total">R 0</td>
      <td></td></tr>
    </tfoot>
  </table>

  <h2 style="margin-top:1.4rem;">Personal note <span style="font-weight:400;color:#8a7d72;font-size:.82rem;">(optional)</span></h2>
  <textarea name="note" rows="3" placeholder="Add a warm personal note to this quote…" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .75em;resize:vertical;"></textarea>

  <div style="margin-top:1.4rem;display:flex;gap:.8rem;">
    <button type="submit" style="font:inherit;font-size:.9rem;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.55em 1.6em;cursor:pointer;">Send Quote Email</button>
    <a href="/api/admin/quotes" style="font:inherit;font-size:.9rem;font-weight:500;color:#6b5d52;text-decoration:none;padding:.55em 1em;border:1.5px solid #c9bfb8;border-radius:8px;">Cancel</a>
  </div>
</form>

<script>
let rowCount = 0;

function fmt(n) {
  return 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function recalc() {
  let total = 0;
  document.querySelectorAll('.item-row').forEach(function(row) {
    const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
    const price = parseFloat(row.querySelector('.price-input').value) || 0;
    const sub = qty * price;
    total += sub;
    row.querySelector('.sub-cell').textContent = fmt(sub);
  });
  document.getElementById('grand-total').textContent = fmt(total);
}

function addRow(desc, price) {
  rowCount++;
  const n = rowCount;
  const tbody = document.getElementById('items-body');
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = '<td style="padding:.35rem 0;"><input name="desc[]" value="' + (desc||'').replace(/"/g,'&quot;') + '" placeholder="Service description" style="width:100%;font:inherit;border:1.5px solid #c9bfb8;border-radius:6px;padding:.3em .6em;" oninput="recalc()"></td>'
    + '<td style="padding:.35rem .5rem;"><input class="qty-input" name="qty[]" type="number" value="1" min="1" style="width:3.5rem;font:inherit;border:1.5px solid #c9bfb8;border-radius:6px;padding:.3em .4em;text-align:right;" oninput="recalc()"></td>'
    + '<td style="padding:.35rem .5rem;"><input class="price-input" name="price[]" type="number" value="' + (price||0) + '" min="0" style="width:5.5rem;font:inherit;border:1.5px solid #c9bfb8;border-radius:6px;padding:.3em .4em;text-align:right;" oninput="recalc()"></td>'
    + '<td class="sub-cell" style="text-align:right;padding:.35rem 0;font-variant-numeric:tabular-nums;">' + fmt((price||0)) + '</td>'
    + '<td style="text-align:right;padding:.35rem 0;"><button type="button" onclick="this.closest(\'tr\').remove();recalc();" style="background:none;border:none;color:#c53030;font-size:1.1rem;cursor:pointer;padding:0 .3rem;">×</button></td>';
  tbody.appendChild(tr);
  recalc();
}

function addFromCatalog() {
  const sel = document.getElementById('catalog');
  if (!sel.value) return;
  const parts = sel.value.split('|');
  addRow(parts[0], parseFloat(parts[1]) || 0);
  sel.value = '';
}

function addBlankRow() { addRow('', 0); }
</script>`;
}

/** GET /api/admin/quotes/new — manual quote composer form */
export async function handleAdminQuoteComposer(
  req: Request,
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    if (!form) return htmlResponse(adminShell("Create Invoice", user, quoteComposerForm("Invalid form submission."), "/api/admin/quotes/new"), 400);

    const clientName = String(form.get("client_name") ?? "").trim();
    const clientEmail = String(form.get("client_email") ?? "").trim();
    const eventDate = String(form.get("event_date") ?? "").trim();
    const eventType = String(form.get("event_type") ?? "wedding").trim();
    const note = String(form.get("note") ?? "").trim();

    if (!clientName || !clientEmail) {
      return htmlResponse(adminShell("Create Invoice", user, quoteComposerForm("Client name and email are required."), "/api/admin/quotes/new"), 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return htmlResponse(adminShell("Create Invoice", user, quoteComposerForm("Please enter a valid email address."), "/api/admin/quotes/new"), 400);
    }

    const descs = form.getAll("desc[]").map(String);
    const qtys  = form.getAll("qty[]").map(String);
    const prices = form.getAll("price[]").map(String);

    type LineItem = { desc: string; qty: number; price: number; subtotal: number };
    const items: LineItem[] = [];
    for (let i = 0; i < descs.length; i++) {
      const desc = (descs[i] ?? "").trim();
      const qty = Math.max(1, parseInt(qtys[i] ?? "1", 10) || 1);
      const price = Math.max(0, parseFloat(prices[i] ?? "0") || 0);
      if (desc) items.push({ desc, qty, price, subtotal: qty * price });
    }
    const totalCents = Math.round(items.reduce((s, it) => s + it.subtotal * 100, 0));
    const totalFormatted = `R ${(totalCents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;

    const eventTypeLabel: Record<string, string> = {
      wedding: "Wedding", matric: "Matric Farewell", trial: "Trial", event: "Event", editorial: "Editorial / Photoshoot",
    };
    const eventLabel = eventTypeLabel[eventType] ?? eventType;

    const lineRows = items.map((it) =>
      `<tr>
        <td style="padding:10px 12px 10px 0;border-bottom:1px solid #F5EDE5;font-size:13px;color:#3A2E26;">${esc(it.desc)}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #F5EDE5;font-size:13px;color:#6b5d52;text-align:right;">${it.qty}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #F5EDE5;font-size:13px;color:#6b5d52;text-align:right;">R ${it.price.toLocaleString("en-ZA")}</td>
        <td style="padding:10px 0 10px 6px;border-bottom:1px solid #F5EDE5;font-size:13px;font-weight:600;color:#3A2E26;text-align:right;">R ${it.subtotal.toLocaleString("en-ZA")}</td>
      </tr>`,
    ).join("");

    const lineTable = items.length
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #EEE5DA;">
          <thead><tr>
            <th style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#A89080;padding:10px 12px 10px 0;border-bottom:1px solid #F5EDE5;text-align:left;">Service</th>
            <th style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#A89080;padding:10px 6px;border-bottom:1px solid #F5EDE5;text-align:right;">Qty</th>
            <th style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#A89080;padding:10px 6px;border-bottom:1px solid #F5EDE5;text-align:right;">Unit</th>
            <th style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#A89080;padding:10px 0 10px 6px;border-bottom:1px solid #F5EDE5;text-align:right;">Subtotal</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
          <tfoot><tr>
            <td colspan="3" style="padding:12px 6px 0 0;font-size:13px;font-weight:700;color:#5C4332;text-align:right;">Total</td>
            <td style="padding:12px 0 0 6px;font-size:16px;font-weight:700;color:#5C4332;text-align:right;font-family:Georgia,serif;">${esc(totalFormatted)}</td>
          </tr></tfoot>
        </table>`
      : `<p style="margin:12px 0 0;font-size:13px;color:#8A7060;font-style:italic;">No line items listed.</p>`;

    const noteHtml = note ? ep(`<em style="font-style:italic;color:#6b5d52;">"${emailEsc(note)}"</em>`) : "";
    const eventDateDisplay = eventDate ? emFn(eventDate) : "";  // emFn = em from lib/email (italic serif span)

    const emailHtml = emailShell({
      heading: `Your Lustique quote, ${esc(clientName.split(" ")[0] ?? clientName)}.`,
      body: ep(`Thank you for your interest in Lustique. Here is your personalised quote${eventDateDisplay ? ` for your ${esc(eventLabel)} on ${eventDateDisplay}` : ` for your ${esc(eventLabel)}`}.`)
        + lineTable
        + (noteHtml ? `<div style="margin-top:24px;">${noteHtml}</div>` : ""),
      btnZone: `<p style="margin:0 0 12px;font-size:13px;color:#5C4332;font-family:Arial,sans-serif;">Ready to book? Reply to this email and we'll take it from there.</p>`,
      footerNote: `This quote is valid for 7 days. Questions? Write to us at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a>.`,
    });

    try {
      await sendEmail(
        env,
        { email: clientEmail, name: clientName },
        `Your Lustique quote${eventDate ? ` — ${eventDate}` : ""}`,
        emailHtml,
        fetchFn,
      );
    } catch {
      return htmlResponse(adminShell("Create Invoice", user, quoteComposerForm("Failed to send email — please try again."), "/api/admin/quotes/new"), 500);
    }

    return new Response(null, {
      status: 302,
      headers: { location: `/api/admin/quotes?success=quote_sent&to=${encodeURIComponent(clientEmail)}` },
    });
  }

  return htmlResponse(adminShell("Create Invoice", user, quoteComposerForm(), "/api/admin/quotes/new"));
}
