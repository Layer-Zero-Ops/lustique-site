import { keepWarm } from "./booking/db";
import { writeAudit } from "./booking/audit";
import { handleBookingRequest } from "./booking/request";
import { renderConfirmPage, handleBookingConfirm, renderMarkPaidPage, handleMarkPaid } from "./booking/confirm";
import { renderReviewPage, handleReview, invoiceExpirySweep } from "./booking/review";
import { renderAcceptPage, handleAccept } from "./booking/accept";
import { renderRejectPage, handleReject } from "./booking/reject";
import { handleYocoWebhook, pendingPaymentSweep } from "./booking/yoco";
import { renderMarkBalancePaidPage, handleMarkBalancePaid, balanceSweep } from "./booking/balance";
import { reviewEmailSweep } from "./booking/review-email";
import { handleAdminBlockedDates } from "./booking/admin";
import { handleAdminAccounting } from "./booking/accounting";
import { handleAdminInvoices } from "./booking/invoices";
import { handleAdminQuotePdf } from "./booking/quote-pdf";
import { renderInvoicePage } from "./booking/invoice";
import {
  handleAdminLogin,
  handleAdminAuthCallback,
  handleAdminAuthLogout,
  handleAdminDashboard,
  handleAdminBookingDetail,
  handleAdminQuotes,
  handleAdminPayments,
  handleAdminRejections,
  handleAdminCalendar,
  handleAdminTemplates,
  handleAdminNotifications,
  handleAdminNotificationsRead,
} from "./booking/dashboard";
import { checkRateLimit, RATE_LIMITS, type RateLimitBinding } from "./lib/rateLimit";

/* ============================================================
   LUSTIQUE CO. — form-handler Worker (the stable API boundary)

   POST /api/enquiry:  validate → drop bots (honeypot) → email Lustique
                       the enquiry + confirm the bride (Brevo) → 200.

   Secrets (set via `wrangler secret put`, never committed):
     BREVO_API_KEY  — Brevo transactional-email key
     NOTIFY_EMAIL   — verified Brevo sender + where enquiries land (info@lustiqueco.co.za)

   This is the seam ARCHITECTURE.md describes: v1 wires it to Brevo (+ later Sheets/CRM);
   AXIS can subscribe to the same boundary later without a site rewrite.
   ============================================================ */

export interface Env {
  // existing (enquiry)
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  // booking core (added S1; consumers land in S2–S5)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YOCO_SECRET_KEY: string;
  YOCO_WEBHOOK_SECRET: string;
  SIGNING_SECRET: string;
  TURNSTILE_SECRET: string;
  // EFT deposit details (v1 — set at deploy; S4 replaces with Yoco)
  EFT_BANK: string;
  EFT_ACCOUNT_NAME: string;
  EFT_ACCOUNT_NO: string;
  EFT_BRANCH_CODE: string;
  // S8: Wave accounting (all optional — if absent, Wave calls are skipped gracefully)
  WAVE_API_KEY?: string;
  WAVE_BUSINESS_ID?: string;
  WAVE_PRODUCT_ID?: string;
  WAVE_BANK_ACCOUNT_ID?: string;
  // Wave 0: Yoco fee rate (var, not secret — for margin reporting only; bride pays net)
  YOCO_FEE_PCT?: string;
  // S8: admin area (blocked dates UI) — retained for legacy ADMIN_SECRET endpoints
  ADMIN_SECRET?: string;
  // Wave C Phase 1: Supabase JWT secret — verifies Zandeline's session tokens
  // Set via: wrangler secret put SUPABASE_JWT_SECRET
  // Value: Supabase dashboard → Settings → API → JWT Settings → JWT Secret
  SUPABASE_JWT_SECRET?: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
  // Wave D3 — rate-limiting bindings (declared in wrangler.toml [[ratelimits]])
  // Optional so existing tests that don't supply them compile without changes.
  RL_LOGIN?: RateLimitBinding;
  RL_LOGIN_EMAIL?: RateLimitBinding;
  RL_BOOKING?: RateLimitBinding;
  RL_ENQUIRY?: RateLimitBinding;
  RL_ADMIN?: RateLimitBinding;
}

interface Detail {
  label?: string;
  value?: string;
}

interface Enquiry {
  name?: string;
  email?: string;
  phone?: string;
  occasion?: string;
  date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: Detail[]; // occasion-specific rows (party, hair, style…) built client-side
  hp_company?: string; // honeypot — bots fill it; humans never see it
  cfTurnstileToken?: string;
}

const esc = (s = "") => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
/** Defensive length cap — server never trusts client-sent lengths (SECURITY.md §2). */
const cap = (s = "", n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function secHeaderMap(opts: { html: boolean; noindex?: boolean }): Record<string, string> {
  const h: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()",
  };
  if (opts.html) {
    // Strict CSP for Worker-rendered HTML — no third-party scripts; only inline styles/scripts we own.
    h["content-security-policy"] =
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
      "form-action 'self'; img-src 'self' data:; font-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self';";
  }
  if (opts.noindex) h["x-robots-tag"] = "noindex, nofollow";
  return h;
}

function withSec(res: Response, opts: { html: boolean; noindex?: boolean }): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(secHeaderMap(opts))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const json = (data: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin), ...secHeaderMap({ html: false }) },
  });

/** Emit a 429 through the standard json() helper and add a Retry-After header. */
function rate429(origin: string, retryAfter: number): Response {
  const base = json({ ok: false, error: "Too many requests. Please try again later." }, 429, origin);
  const headers = new Headers(base.headers);
  headers.set("retry-after", String(retryAfter));
  return new Response(base.body, { status: 429, headers });
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!r.ok) return false;
    return ((await r.json()) as { success: boolean }).success === true;
  } catch {
    return false;
  }
}

/** Returns an error message, "spam" for honeypot hits, or null if valid. */
function validate(e: Enquiry): string | null {
  if (e.hp_company && e.hp_company.trim() !== "") return "spam";
  if (!e.name || e.name.trim().length < 2) return "Please add your name.";
  if (!e.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email)) return "Please add a valid email address.";
  return null;
}

async function brevoEmail(
  env: Env,
  to: { email: string; name?: string },
  subject: string,
  html: string,
): Promise<void> {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." },
      to: [to],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

export default {
  async fetch(req: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(req.url);

    // GET /api/health — liveness + shallow DB ping (Wave-S)
    if (req.method === "GET" && url.pathname === "/api/health") {
      let dbOk = false;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/business_settings?select=key&limit=1`, {
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        dbOk = r.ok;
      } catch { /* timeout or network — dbOk stays false */ }
      const ok = dbOk;
      return new Response(JSON.stringify({ ok, service: ok, db: dbOk, ts: new Date().toISOString() }), {
        status: ok ? 200 : 503,
        headers: { "content-type": "application/json", ...secHeaderMap({ html: false }) },
      });
    }

    // POST /api/booking/request — request-to-book endpoint (S2)
    if (req.method === "POST" && url.pathname === "/api/booking/request") {
      if (env.RL_BOOKING) {
        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        const rl = await checkRateLimit(env.RL_BOOKING, ip, RATE_LIMITS.BOOKING);
        if (!rl.success) return rate429(origin, rl.retryAfter);
      }
      return handleBookingRequest(env, req);
    }

    // GET /api/booking/confirm?token= — render-only confirm page (S3, prefetch-safe §12)
    if (req.method === "GET" && url.pathname === "/api/booking/confirm") {
      return withSec(await renderConfirmPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/confirm — confirm/decline transition (S3)
    if (req.method === "POST" && url.pathname === "/api/booking/confirm") {
      return withSec(await handleBookingConfirm(env, req), { html: true, noindex: true });
    }

    // GET /api/booking/review?token= — review page: quote breakdown + editable total (S6b, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/review") {
      return withSec(await renderReviewPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/review — approve (optional amount override) or decline (S6b)
    if (req.method === "POST" && url.pathname === "/api/booking/review") {
      return withSec(await handleReview(env, req), { html: true, noindex: true });
    }

    // GET /api/booking/accept?token= — bride's deposit-selection page (Wave A, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/accept") {
      return withSec(await renderAcceptPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/accept — T3: quote_sent → accepted → Yoco checkout
    if (req.method === "POST" && url.pathname === "/api/booking/accept") {
      return withSec(await handleAccept(env, req), { html: true, noindex: true });
    }

    // GET /api/booking/reject?token= — bride's decline confirmation (Wave A, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/reject") {
      return withSec(await renderRejectPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/reject — T4: quote_sent → rejected
    if (req.method === "POST" && url.pathname === "/api/booking/reject") {
      return withSec(await handleReject(env, req), { html: true, noindex: true });
    }

    // POST /api/booking/yoco-webhook — Yoco payment event (S7; signature verified inside)
    if (req.method === "POST" && url.pathname === "/api/booking/yoco-webhook") {
      return handleYocoWebhook(env, req);
    }

    // GET /api/booking/invoice?token= — bride's printable invoice (S9; prefetch-safe, read-only)
    if (req.method === "GET" && url.pathname === "/api/booking/invoice") {
      return withSec(await renderInvoicePage(env, req), { html: true, noindex: true });
    }

    // Wave D3: single RL_ADMIN check covers all /api/admin/* (JWT-gated AND legacy routes).
    // Placed before the SUPABASE_JWT_SECRET block so it fires exactly once per request.
    if (url.pathname.startsWith("/api/admin/") && env.RL_ADMIN) {
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      const rl = await checkRateLimit(env.RL_ADMIN, ip, RATE_LIMITS.ADMIN);
      if (!rl.success) return rate429(origin, rl.retryAfter);
    }

    // ── Wave C Phase 1: JWT-gated admin dashboard routes ─────────────────────
    if (env.SUPABASE_JWT_SECRET) {
      const dashEnv = { ...env, SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET };

      // GET/POST /api/admin/login — magic-link login form.
      // POST-only IP rate limit applied here; email rate limit applied inside handleAdminLogin.
      if (url.pathname === "/api/admin/login") {
        if (req.method === "POST" && env.RL_LOGIN) {
          const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
          const rl = await checkRateLimit(env.RL_LOGIN, ip, RATE_LIMITS.LOGIN_IP);
          if (!rl.success) return rate429(origin, rl.retryAfter);
        }
        return await handleAdminLogin(req, dashEnv);
      }
      // GET /api/admin/auth/callback — exchange Supabase token_hash for session cookie
      if (req.method === "GET" && url.pathname === "/api/admin/auth/callback") {
        return await handleAdminAuthCallback(req, dashEnv);
      }
      // POST /api/admin/auth/logout — clear session cookie
      if (req.method === "POST" && url.pathname === "/api/admin/auth/logout") {
        return await handleAdminAuthLogout(req, dashEnv);
      }
      // GET /api/admin/dashboard — Inbox view (requires valid session)
      if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
        return await handleAdminDashboard(req, dashEnv);
      }
      // GET /api/admin/booking/:id — booking detail + inline quote editor
      if (req.method === "GET" && url.pathname.startsWith("/api/admin/booking/")) {
        const id = url.pathname.slice("/api/admin/booking/".length);
        if (id) return await handleAdminBookingDetail(req, dashEnv, id);
      }
      // POST /api/admin/quote/:id — save revised total (form from booking detail)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/quote/")) {
        const id = url.pathname.slice("/api/admin/quote/".length);
        if (id) return await handleAdminBookingDetail(req, dashEnv, id);
      }
      // GET /api/admin/quotes — sent-quotes view
      if (req.method === "GET" && url.pathname === "/api/admin/quotes") {
        return await handleAdminQuotes(req, dashEnv);
      }
      // GET /api/admin/payments — payments view
      if (req.method === "GET" && url.pathname === "/api/admin/payments") {
        return await handleAdminPayments(req, dashEnv);
      }
      // GET /api/admin/rejections — rejections view
      if (req.method === "GET" && url.pathname === "/api/admin/rejections") {
        return await handleAdminRejections(req, dashEnv);
      }
      // GET + POST /api/admin/calendar — calendar + slots editor
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/calendar") {
        return await handleAdminCalendar(req, dashEnv);
      }
      // GET /api/admin/templates — list all templates
      if (req.method === "GET" && url.pathname === "/api/admin/templates") {
        return await handleAdminTemplates(req, dashEnv, null);
      }
      // GET + POST /api/admin/templates/:key — edit / save one template
      if ((req.method === "GET" || req.method === "POST") && url.pathname.startsWith("/api/admin/templates/")) {
        const key = url.pathname.slice("/api/admin/templates/".length);
        if (key) return await handleAdminTemplates(req, dashEnv, key);
      }
      // GET /api/admin/notifications — unread count + list (polled by bell every 60s)
      if (req.method === "GET" && url.pathname === "/api/admin/notifications") {
        return await handleAdminNotifications(req, dashEnv);
      }
      // POST /api/admin/notifications/read — mark one or all as read
      if (req.method === "POST" && url.pathname === "/api/admin/notifications/read") {
        return await handleAdminNotificationsRead(req, dashEnv);
      }
    }

    // ── Legacy ADMIN_SECRET routes (retained until Phase-1 auth fully proven) ─
    // GET/POST /api/admin/blocked-dates — Zandeline's blocked-dates admin (S8; token-protected)
    if (url.pathname === "/api/admin/blocked-dates" && env.ADMIN_SECRET) {
      return withSec(await handleAdminBlockedDates({ ...env, ADMIN_SECRET: env.ADMIN_SECRET }, req), { html: true, noindex: true });
    }

    // GET /api/admin/accounting — accounting dashboard: revenue by month, outstanding, pipeline, CSV export
    if (url.pathname === "/api/admin/accounting" && env.ADMIN_SECRET) {
      return withSec(await handleAdminAccounting({ ...env, ADMIN_SECRET: env.ADMIN_SECRET }, req), { html: true, noindex: true });
    }

    // GET /api/admin/invoices — invoice listing with pre-signed per-booking invoice links
    if (url.pathname === "/api/admin/invoices" && env.ADMIN_SECRET) {
      return withSec(await handleAdminInvoices({ ...env, ADMIN_SECRET: env.ADMIN_SECRET }, req), { html: true, noindex: true });
    }

    // GET /api/admin/quote-pdf — printable quote for any booking (Zandeline-facing, admin-token-gated)
    if (url.pathname === "/api/admin/quote-pdf" && env.ADMIN_SECRET) {
      return withSec(await handleAdminQuotePdf({ ...env, ADMIN_SECRET: env.ADMIN_SECRET }, req), { html: true, noindex: true });
    }

    // GET /api/booking/mark-paid?token= — render-only deposit-received page (S4, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/mark-paid") {
      return withSec(await renderMarkPaidPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/mark-paid — record EFT deposit → deposit_paid (S4)
    if (req.method === "POST" && url.pathname === "/api/booking/mark-paid") {
      return withSec(await handleMarkPaid(env, req), { html: true, noindex: true });
    }

    // GET /api/booking/mark-balance-paid?token= — render-only balance-received page (S5, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/mark-balance-paid") {
      return withSec(await renderMarkBalancePaidPage(env, req), { html: true, noindex: true });
    }
    // POST /api/booking/mark-balance-paid — record EFT balance → settled (S5)
    if (req.method === "POST" && url.pathname === "/api/booking/mark-balance-paid") {
      return withSec(await handleMarkBalancePaid(env, req), { html: true, noindex: true });
    }

    if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
      return json({ ok: false, error: "Not found" }, 404, origin);
    }

    // Wave D3: rate-limit POST /api/enquiry (belt-and-suspenders with Turnstile).
    if (env.RL_ENQUIRY) {
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      const rl = await checkRateLimit(env.RL_ENQUIRY, ip, RATE_LIMITS.ENQUIRY);
      if (!rl.success) return rate429(origin, rl.retryAfter);
    }

    let body: Enquiry;
    try {
      body = (await req.json()) as Enquiry;
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400, origin);
    }

    const problem = validate(body);
    if (problem === "spam") return json({ ok: true }, 200, origin); // silently swallow bots
    if (problem) return json({ ok: false, error: problem }, 422, origin);

    // Turnstile bot-check on enquiry (Wave-S) — mirrors /api/booking/request
    if (env.TURNSTILE_SECRET) {
      const tsOk = await verifyTurnstile(body.cfTurnstileToken ?? "", env.TURNSTILE_SECRET);
      if (!tsOk) return json({ ok: false, error: "Security check failed. Please refresh and try again." }, 422, origin);
    }

    const name = body.name!.trim();
    try {
      // 1) Confirm the bride
      await brevoEmail(
        env,
        { email: body.email!.trim(), name },
        "We've received your enquiry — Lustique Co.",
        `<p>Hi ${esc(name)},</p>
         <p>Thank you — we have your enquiry and will reply within 24 hours, often sooner.</p>
         <p>Blessings,<br/>The Lustique Cosmetology Team</p>`,
      );

      // 2) Notify Lustique — header lines + the occasion-specific detail rows.
      const rows = (Array.isArray(body.details) ? body.details : [])
        .slice(0, 40)
        .filter((d) => d && typeof d.value === "string" && d.value.trim() !== "")
        .map(
          (d) =>
            `<tr><td style="padding:2px 12px 2px 0;color:#8a7d72;vertical-align:top;white-space:nowrap;">${esc(cap(d.label, 48))}</td><td style="padding:2px 0;">${esc(cap(d.value))}</td></tr>`,
        )
        .join("");
      const line = [body.occasion, body.date, body.town].map((s) => esc(s)).filter(Boolean).join(" · ");
      await brevoEmail(
        env,
        { email: env.NOTIFY_EMAIL, name: "Lustique" },
        `New enquiry — ${name}`,
        `<p><strong>${esc(name)}</strong><br/>${esc(body.email)} · ${esc(body.phone)}</p>
         ${line ? `<p>${line}</p>` : ""}
         <p>Live estimate shown: <strong>${esc(body.estimate)}</strong></p>
         ${rows ? `<table style="border-collapse:collapse;font:14px/1.55 system-ui,sans-serif;">${rows}</table>` : ""}
         ${body.message ? `<p style="margin-top:12px;white-space:pre-wrap;">${esc(cap(body.message, 2000))}</p>` : ""}`,
      );

      // TODO (Phase B/C): append to the Google Sheet / CRM, kick off the Brevo nurture flow,
      // and add /api/quote + /api/quote/respond using shared/pricing for the authoritative recompute.
      return json({ ok: true }, 200, origin);
    } catch {
      // Never fail silently on a real lead — tell her how to reach us directly.
      return json(
        { ok: false, error: "We couldn't send that just now — please email info@lustiqueco.co.za and we'll jump on it." },
        502,
        origin,
      );
    }
  },

  // Daily cron (wrangler.toml): keep-warm + balance-reminder sweep (S5).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await keepWarm(env);
        await writeAudit(env, { bookingId: null, eventType: "cron.keepwarm", payload: {} });
        await invoiceExpirySweep(env);
        await balanceSweep(env);
        await pendingPaymentSweep(env);
        await reviewEmailSweep(env);
      })().catch(() => {}), // never throw out of the scheduled handler
    );
  },
};
