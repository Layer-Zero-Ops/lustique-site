import { keepWarm } from "./booking/db";
import { writeAudit } from "./booking/audit";
import { handleBookingRequest } from "./booking/request";
import { renderConfirmPage, handleBookingConfirm } from "./booking/confirm";

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
  AUDIT: { put(key: string, value: string): Promise<unknown> };
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

const json = (data: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });

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
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(req.url);

    // POST /api/booking/request — request-to-book endpoint (S2)
    if (req.method === "POST" && url.pathname === "/api/booking/request") {
      return handleBookingRequest(env, req);
    }

    // GET /api/booking/confirm?token= — render-only confirm page (S3, prefetch-safe §12)
    if (req.method === "GET" && url.pathname === "/api/booking/confirm") {
      return renderConfirmPage(env, req);
    }
    // POST /api/booking/confirm — confirm/decline transition (S3)
    if (req.method === "POST" && url.pathname === "/api/booking/confirm") {
      return handleBookingConfirm(env, req);
    }

    if (req.method !== "POST" || url.pathname !== "/api/enquiry") {
      return json({ ok: false, error: "Not found" }, 404, origin);
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

  // Daily cron (wrangler.toml). v1: keep the free-tier DB warm + leave an audit breadcrumb.
  // The balance-reminder sweep + token expiry land in S5.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await keepWarm(env);
        await writeAudit(env, { bookingId: null, eventType: "cron.keepwarm", payload: {} });
      })().catch(() => {}), // never throw out of the scheduled handler
    );
  },
};
