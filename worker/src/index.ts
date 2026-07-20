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
import { emailShell, ep, firstN } from "./lib/email";
import { handleAdminBlockedDates } from "./booking/admin";
import { handleAdminAccounting } from "./booking/accounting";
import { handleAdminInvoices } from "./booking/invoices";
import { handleAdminQuotePdf } from "./booking/quote-pdf";
import { renderInvoicePage, handleInvoiceReject, handleInvoicePay } from "./booking/invoice";
import { renderContractPageHandler } from "./booking/contract";
import {
  handleAdminLogin,
  handleAdminPasswordLogin,
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
  handleAdminWebsite,
  handleAdminClio,
  handleAdminClioActivity,
  handleAdminClioLearning,
  handleAdminQuoteComposer,
} from "./booking/dashboard";
import { handleAssignArtist, handleRemoveArtist } from "./booking/artists";
import {
  handleAdminSendQuote,
  handleAdminDeclineBooking,
  handleAdminMarkDepositPaid,
  handleAdminMarkBalancePaid,
  handleAdminResendInvoice,
} from "./booking/admin-actions";
import { handleCalendarFeed } from "./booking/calendar";
import { persistEnquiry, insertNotification } from "./booking/db";
import { notifyClio } from "./booking/clio";
import { handleClioInbound } from "./booking/clioInbound";
import { handleAdminEnquiries, handleAdminEnquiryDetail, handleAdminUpdateEnquiry, handleAdminGenerateInvoice } from "./booking/enquiries";
import { handleAdminContacts, handleAdminAddContact } from "./booking/contacts";
import { handleAdminForms, handleAdminFormsSendQuote } from "./booking/forms";
import { handleAdminStaffing } from "./booking/staffing";
import { handleAdminPortfolio, handleAdminPortfolioDelete, handleAdminPortfolioReorder, handleAdminPortfolioPositions } from "./booking/portfolio";
import {
  handleAdminBlog,
  handleAdminBlogNew,
  handleAdminBlogEdit,
  handleAdminBlogPublish,
  handleAdminBlogDelete,
  handlePublicBlogList,
  handlePublicBlogPost,
} from "./booking/blog";
import { adminShell } from "./booking/dashboard";
import { learningPass } from "./booking/learning";
import { checkRateLimit, RATE_LIMITS, type RateLimitBinding } from "./lib/rateLimit";

/* ============================================================
   LUSTIQUE CO. — form-handler Worker (the stable API boundary)

   POST /api/enquiry:  validate → drop bots (honeypot) → email Lustique
                       the enquiry + confirm the bride (Brevo) → 200.

   Secrets (set via `wrangler secret put`, never committed):
     BREVO_API_KEY              — Brevo transactional-email key
     NOTIFY_EMAIL                — verified Brevo sender + where enquiries land (info@lustiqueco.co.za)
     BREVO_NEWSLETTER_LIST_ID    — numeric Brevo list ID for newsletter signups (see newsletter.ts)
     BREVO_PAST_CLIENTS_LIST_ID  — numeric Brevo list ID for settled bookings' brides (see marketing.ts) —
                                    optional; the past-clients audience and its sync are skipped if unset.

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
  // iCal feed secret — URL key for GET /api/calendar.ics
  // Set via: wrangler secret put ICAL_KEY  (generate with: openssl rand -hex 24)
  ICAL_KEY?: string;
  // Clio event fan-out (worker/src/booking/clio.ts) — enables reactive/proactive AI.
  // Unset until the inbound Hermes receiver is wired; notifyClio() is a no-op then.
  CLIO_WEBHOOK_URL?: string;
  CLIO_WEBHOOK_SECRET?: string;
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
  /** Vendor/venue partner slug from a `?ref=<slug>` link, captured client-side. */
  referralSource?: string;
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

    // POST /api/newsletter — add email to Brevo contact list
    if (url.pathname === "/api/newsletter") {
      const { handleNewsletter } = await import("./booking/newsletter");
      return handleNewsletter(req, env);
    }

    // POST /api/venue-match-log — anonymous telemetry: how the quote-page venue matcher resolved
    if (req.method === "POST" && url.pathname === "/api/venue-match-log") {
      const { handleVenueMatchLog } = await import("./booking/venueMatchLog");
      return handleVenueMatchLog(req, env, origin);
    }

    // GET /api/promo/active — public: which promo (if any) Zandeline has live right now
    if (req.method === "GET" && url.pathname === "/api/promo/active") {
      const { handlePublicActivePromo } = await import("./booking/promos");
      return handlePublicActivePromo(req, env, origin);
    }

    // GET /api/calendar.ics — iCal feed of active bookings (key-protected)
    if (req.method === "GET" && url.pathname === "/api/calendar.ics") {
      return handleCalendarFeed(req, env);
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

    // GET/POST /api/booking/accept?token= — legacy Wave A link; redirects to /api/booking/invoice
    if (req.method === "GET" && url.pathname === "/api/booking/accept") {
      return withSec(await renderAcceptPage(env, req), { html: true, noindex: true });
    }
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

    // POST /api/clio/webhook — inbound events FROM external systems relayed to Clio.
    // e.g. Supabase DB webhook (Zandeline's dashboard actions), Google Calendar push,
    // Brevo bounce/complaint. Receiver-side verifies auth before forwarding to the AI.
    // Signature-optional: when CLIO_WEBHOOK_SECRET is set, the inbound call must carry
    // a matching webhook-signature (Standard Webhooks format) — see clio.ts signClioEvent.
    if (req.method === "POST" && url.pathname === "/api/clio/webhook") {
      return handleClioInbound(env, req);
    }

    // GET /api/booking/invoice?token= — bride's printable invoice (S9; prefetch-safe, read-only)
    if (req.method === "GET" && url.pathname === "/api/booking/invoice") {
      return withSec(await renderInvoicePage(env, req), { html: true, noindex: true });
    }

    // POST /api/booking/invoice/reject?token= — bride declines the invoice
    if (req.method === "POST" && url.pathname === "/api/booking/invoice/reject") {
      return withSec(await handleInvoiceReject(env, req), { noindex: true });
    }

    // POST /api/booking/invoice/pay?token= — TASK-D: bride selects deposit %, creates Yoco checkout
    if (req.method === "POST" && url.pathname === "/api/booking/invoice/pay") {
      return withSec(await handleInvoicePay(env, req), { noindex: true });
    }

    // GET /api/booking/contract?token= — bride's Client Agreement (same invoice token), read-only
    if (req.method === "GET" && url.pathname === "/api/booking/contract") {
      return withSec(await renderContractPageHandler(env, req), { html: true, noindex: true });
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
      // POST /api/admin/auth/password — password login (alternative to magic link)
      if (req.method === "POST" && url.pathname === "/api/admin/auth/password") {
        return await handleAdminPasswordLogin(req, dashEnv);
      }
      // GET /api/admin/auth/callback — exchange Supabase token_hash for session cookie
      if (req.method === "GET" && url.pathname === "/api/admin/auth/callback") {
        return await handleAdminAuthCallback(req, dashEnv);
      }
      // POST /api/admin/auth/logout — clear session cookie
      if (req.method === "POST" && url.pathname === "/api/admin/auth/logout") {
        return await handleAdminAuthLogout(req, dashEnv);
      }
      // GET /api/admin/enquiries — CRM list view
      if (req.method === "GET" && url.pathname === "/api/admin/enquiries") {
        return handleAdminEnquiries(req, env as Parameters<typeof handleAdminEnquiries>[1], adminShell);
      }
      // GET /api/admin/enquiries/:id — CRM detail view
      if (req.method === "GET" && url.pathname.startsWith("/api/admin/enquiries/") && url.pathname.split("/").length === 5) {
        const id = url.pathname.slice("/api/admin/enquiries/".length);
        return handleAdminEnquiryDetail(req, env as Parameters<typeof handleAdminEnquiryDetail>[1], adminShell, id);
      }
      // POST /api/admin/enquiries/:id/generate-invoice — create booking from enquiry
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/enquiries/") && url.pathname.endsWith("/generate-invoice")) {
        const id = url.pathname.split("/")[4]!;
        return handleAdminGenerateInvoice(req, env as Parameters<typeof handleAdminGenerateInvoice>[1], adminShell, id);
      }
      // POST /api/admin/enquiries/:id — update status/notes (PRG)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/enquiries/") && url.pathname.split("/").length === 5) {
        const id = url.pathname.slice("/api/admin/enquiries/".length);
        return handleAdminUpdateEnquiry(req, env as Parameters<typeof handleAdminUpdateEnquiry>[1], id);
      }

      // GET /api/admin/dashboard — Inbox view (requires valid session)
      if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
        return await handleAdminDashboard(req, dashEnv);
      }
      // POST /api/admin/booking/:id/send-quote — send quote email to bride (D5)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/send-quote")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/send-quote".length);
        if (id) return await handleAdminSendQuote(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/decline-booking — decline booking, email bride (D5)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/decline-booking")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/decline-booking".length);
        if (id) return await handleAdminDeclineBooking(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/mark-deposit — record EFT deposit, email bride (D5)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/mark-deposit")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/mark-deposit".length);
        if (id) return await handleAdminMarkDepositPaid(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/mark-balance — record EFT balance, email bride (D5)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/mark-balance")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/mark-balance".length);
        if (id) return await handleAdminMarkBalancePaid(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/resend-invoice — re-send invoice link (any post-quote status)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/resend-invoice")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/resend-invoice".length);
        if (id) return await handleAdminResendInvoice(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/artists — assign artist to booking (D4)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/artists".length);
        if (id) return await handleAssignArtist(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/artists/remove — remove artist from booking (D4)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists/remove")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/artists/remove".length);
        if (id) return await handleRemoveArtist(req, dashEnv, id);
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
      // GET /api/admin/quotes — tabbed: Quotes / Invoices / Payments
      if (req.method === "GET" && url.pathname === "/api/admin/quotes") {
        return await handleAdminQuotes(req, dashEnv);
      }
      // GET + POST /api/admin/quotes/new — manual quote composer
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/quotes/new") {
        return await handleAdminQuoteComposer(req, dashEnv);
      }
      // GET /api/admin/website — website management placeholder
      if (req.method === "GET" && url.pathname === "/api/admin/website") {
        return await handleAdminWebsite(req, dashEnv);
      }
      // GET /api/admin/clio — Clio AI assistant
      if (req.method === "GET" && url.pathname === "/api/admin/clio") {
        return await handleAdminClio(req, dashEnv);
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
      // GET /api/admin/clio-activity — recent Clio event count (polled every 15s;
      // the plan-A.5 documented realtime fallback until Supabase Realtime is wired).
      if (req.method === "GET" && url.pathname === "/api/admin/clio-activity") {
        return await handleAdminClioActivity(req, dashEnv);
      }
      // GET /api/admin/clio/learning — agent self-optimization ground truth
      // (playbook + open proposals + safe-change allowlist). Read-only.
      if (req.method === "GET" && url.pathname === "/api/admin/clio/learning") {
        return await handleAdminClioLearning(req, dashEnv);
      }

      // GET /api/admin/staffing — artist assignment overview
      if (req.method === "GET" && url.pathname === "/api/admin/staffing") {
        return handleAdminStaffing(req, env as Parameters<typeof handleAdminStaffing>[1], adminShell);
      }

      // GET/POST /api/admin/promos — Zandeline's promo library + which one is currently running
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/promos") {
        const { handleAdminPromos } = await import("./booking/promos");
        return handleAdminPromos(req, env as Parameters<typeof handleAdminPromos>[1], adminShell);
      }

      // GET/POST /api/admin/marketing — compose & send a promo campaign
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/marketing") {
        const { handleAdminMarketing } = await import("./booking/marketing");
        return handleAdminMarketing(req, env as Parameters<typeof handleAdminMarketing>[1], adminShell);
      }

      // POST /api/admin/marketing/sync-past-clients — backfill/refresh the past-clients Brevo list
      if (req.method === "POST" && url.pathname === "/api/admin/marketing/sync-past-clients") {
        const { handleAdminMarketingSyncPastClients } = await import("./booking/marketing");
        return handleAdminMarketingSyncPastClients(req, env as Parameters<typeof handleAdminMarketingSyncPastClients>[1]);
      }

      // ── Forms ─────────────────────────────────────────────────────────────
      // GET /api/admin/forms — unified inbox (enquiries + booking requests)
      if (req.method === "GET" && url.pathname === "/api/admin/forms") {
        return handleAdminForms(req, env as Parameters<typeof handleAdminForms>[1], adminShell);
      }
      // GET + POST /api/admin/forms/:id/send-quote — compose & send quote email
      if (
        (req.method === "GET" || req.method === "POST") &&
        url.pathname.match(/^\/api\/admin\/forms\/[^/]+\/send-quote$/)
      ) {
        const id = url.pathname.slice("/api/admin/forms/".length, -"/send-quote".length);
        if (id) return handleAdminFormsSendQuote(req, env as Parameters<typeof handleAdminFormsSendQuote>[1], adminShell, id);
      }

      // ── Contacts ──────────────────────────────────────────────────────────
      // GET /api/admin/contacts — unified CRM people view
      if (req.method === "GET" && url.pathname === "/api/admin/contacts") {
        return handleAdminContacts(req, env as Parameters<typeof handleAdminContacts>[1], adminShell);
      }
      // POST /api/admin/contacts — add single contact or bulk CSV import
      if (req.method === "POST" && url.pathname === "/api/admin/contacts") {
        return handleAdminAddContact(req, env as Parameters<typeof handleAdminAddContact>[1]);
      }

      // ── Portfolio ─────────────────────────────────────────────────────────
      // GET  /api/admin/portfolio — gallery + upload form
      // POST /api/admin/portfolio — upload new image
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/portfolio") {
        return handleAdminPortfolio(req, env as Parameters<typeof handleAdminPortfolio>[1], adminShell);
      }
      // POST /api/admin/portfolio/delete — delete image (also removes from portfolio_images)
      if (req.method === "POST" && url.pathname === "/api/admin/portfolio/delete") {
        return handleAdminPortfolioDelete(req, env as Parameters<typeof handleAdminPortfolioDelete>[1]);
      }
      // POST /api/admin/portfolio/reorder — swap image positions (↑/↓) — kept for future use
      if (req.method === "POST" && url.pathname === "/api/admin/portfolio/reorder") {
        return handleAdminPortfolioReorder(req, env as Parameters<typeof handleAdminPortfolioReorder>[1]);
      }
      // POST /api/admin/portfolio/positions — save drag-and-drop order
      if (req.method === "POST" && url.pathname === "/api/admin/portfolio/positions") {
        return handleAdminPortfolioPositions(req, env as Parameters<typeof handleAdminPortfolioPositions>[1]);
      }

      // ── Blog ──────────────────────────────────────────────────────────────
      // GET  /api/admin/blog — list all posts
      if (req.method === "GET" && url.pathname === "/api/admin/blog") {
        return handleAdminBlog(req, env as Parameters<typeof handleAdminBlog>[1], adminShell);
      }
      // GET + POST /api/admin/blog/new — new post form + create
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/blog/new") {
        return handleAdminBlogNew(req, env as Parameters<typeof handleAdminBlogNew>[1], adminShell);
      }
      // GET + POST /api/admin/blog/:id/edit — edit form + save
      if ((req.method === "GET" || req.method === "POST") && url.pathname.match(/^\/api\/admin\/blog\/[^/]+\/edit$/)) {
        const id = url.pathname.slice("/api/admin/blog/".length, -"/edit".length);
        if (id) return handleAdminBlogEdit(req, env as Parameters<typeof handleAdminBlogEdit>[1], adminShell, id);
      }
      // POST /api/admin/blog/:id/publish — toggle published
      if (req.method === "POST" && url.pathname.match(/^\/api\/admin\/blog\/[^/]+\/publish$/)) {
        const id = url.pathname.slice("/api/admin/blog/".length, -"/publish".length);
        if (id) return handleAdminBlogPublish(req, env as Parameters<typeof handleAdminBlogPublish>[1], id);
      }
      // POST /api/admin/blog/:id/delete — delete post
      if (req.method === "POST" && url.pathname.match(/^\/api\/admin\/blog\/[^/]+\/delete$/)) {
        const id = url.pathname.slice("/api/admin/blog/".length, -"/delete".length);
        if (id) return handleAdminBlogDelete(req, env as Parameters<typeof handleAdminBlogDelete>[1], id);
      }
    }

    // ── Public blog API (for Astro site) ─────────────────────────────────────
    // GET /api/blog — list published posts (JSON)
    if (req.method === "GET" && url.pathname === "/api/blog") {
      return handlePublicBlogList(env, origin);
    }
    // GET /api/blog/:slug — single published post (JSON)
    if (req.method === "GET" && url.pathname.startsWith("/api/blog/") && url.pathname.split("/").length === 4) {
      const slug = url.pathname.slice("/api/blog/".length);
      if (slug) return handlePublicBlogPost(env, slug, origin);
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

    // GET /api/admin/venue-match-stats — venue-matcher first-time accuracy summary (JSON; token-protected)
    if (req.method === "GET" && url.pathname === "/api/admin/venue-match-stats" && env.ADMIN_SECRET) {
      const { handleVenueMatchStats } = await import("./booking/venueMatchLog");
      return handleVenueMatchStats(req, { ...env, ADMIN_SECRET: env.ADMIN_SECRET }, origin);
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
      // 0) Persist enquiry first — no lead is lost even if email delivery fails.
      //    Then ring the admin bell so Zandeline sees it in the dashboard even if Brevo is down.
      if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        const saved = await persistEnquiry(env, {
          name,
          email: body.email!.trim(),
          phone: (body.phone ?? "").trim(),
          occasion: body.occasion,
          event_date: body.date,
          town: body.town,
          estimate: body.estimate,
          message: body.message ? cap(body.message, 2000) : undefined,
          details: Array.isArray(body.details) ? body.details : undefined,
          ip: req.headers.get("cf-connecting-ip") ?? undefined,
          referral_source: body.referralSource ? cap(body.referralSource, 80) : undefined,
        });
        await insertNotification(env, {
          type: "enquiry_received",
          title: `New enquiry — ${name}`,
          body: [body.occasion, body.date, body.town].filter(Boolean).join(" · ") || body.email!.trim(),
          link: `/api/admin/enquiries/${saved.id}`,
          payload: { enquiry_id: saved.id },
        }).catch(() => { /* bell failure must never block the enquiry response */ });

        // Clio fan-out — let the AI assistant know immediately (Telegram→Zandeline).
        notifyClio(env, {
          type: "enquiry.received",
          title: `New enquiry — ${name}`,
          body: [body.occasion, body.date, body.town, body.referralSource && `via ${body.referralSource}`].filter(Boolean).join(" · ") || body.email!.trim(),
          link: `/api/admin/enquiries/${saved.id}`,
          audience: "zandeline",
          payload: { enquiry_id: saved.id, referral_source: body.referralSource },
        });
      }

      // 1) Confirm the bride
      await brevoEmail(
        env,
        { email: body.email!.trim(), name },
        "We've received your enquiry — Lustique Co.",
        emailShell({
          preheader: "We've received your enquiry and will reply within 24 hours.",
          heading: `Thank you, ${esc(firstN(name))}.`,
          body: ep(`We have your enquiry and will reply within 24 hours, often sooner.`),
          btnZone: `<a href="https://lustiqueco.co.za" style="display:inline-block;background-color:#9E5F58;color:#FAF6F0;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;padding:14px 40px;border-radius:24px;font-family:Arial,Helvetica,sans-serif;font-weight:600;">Visit Lustique Co.</a>`,
        }),
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
        // Self-optimization loop (Clio v2): reads data, proposes ONE config
        // change behind the human rail. Inert/empty until migrations 0027/0028
        // are applied; never applies a change itself.
        await learningPass(env).catch(() => {});
      })().catch(() => {}), // never throw out of the scheduled handler
    );
  },
};
