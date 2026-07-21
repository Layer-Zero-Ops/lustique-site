import { getAdminSession, type AuthEnv } from "./auth";
import type { ShellFn } from "./enquiries";
import { writeAudit, type AuditEnv } from "./audit";
import { listSettledBookingEmails } from "./db";
import { upsertBrevoContact, createAndSendCampaign } from "../lib/brevoCampaign";
import { marketingEmailHtml } from "../lib/marketingEmail";
import { PROMO_PRESETS } from "@lustique/pricing";

export interface MarketingEnv extends AuthEnv, AuditEnv {
  BREVO_API_KEY: string;
  BREVO_NEWSLETTER_LIST_ID?: string;
  BREVO_PAST_CLIENTS_LIST_ID?: string;
  NOTIFY_EMAIL: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));

const RETURN = "/api/admin/marketing";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

interface FormFields {
  audience: string;
  subject: string;
  headline: string;
  bodyText: string;
  ctaLabel: string;
  ctaHref: string;
  promoId: string;
  highlightLabel: string;
  highlightValue: string;
  heroImage: string;
}

function readFields(form: FormData): FormFields {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    audience: s("audience"), subject: s("subject"), headline: s("headline"), bodyText: s("bodyText"),
    ctaLabel: s("ctaLabel"), ctaHref: s("ctaHref"), promoId: s("promoId"),
    highlightLabel: s("highlightLabel"), highlightValue: s("highlightValue"), heroImage: s("heroImage"),
  };
}

function validate(fields: FormFields): string[] {
  const errors: string[] = [];
  if (!["newsletter", "past-clients"].includes(fields.audience)) errors.push("Choose an audience.");
  if (!fields.subject) errors.push("Subject is required.");
  if (!fields.headline) errors.push("Headline is required.");
  if (!fields.bodyText) errors.push("Body is required.");
  if (!fields.ctaLabel) errors.push("CTA label is required.");
  if (!fields.ctaHref) errors.push("CTA link is required.");
  return errors;
}

function buildHtml(fields: FormFields): string {
  return marketingEmailHtml({
    headline: fields.headline,
    paragraphs: fields.bodyText.split(/\n\n+/).filter((p) => p.trim()),
    ctaLabel: fields.ctaLabel,
    ctaHref: fields.ctaHref,
    highlight: fields.highlightLabel && fields.highlightValue ? { label: fields.highlightLabel, value: fields.highlightValue } : undefined,
    heroImage: fields.heroImage || undefined,
    promoId: fields.promoId || undefined,
  });
}

function formHtml(fields: Partial<FormFields>, opts: { errors?: string[]; previewHtml?: string; savedMsg?: string } = {}): string {
  const v = (k: keyof FormFields) => esc(fields[k] ?? "");
  const promoOptions = [`<option value="">— none —</option>`, ...PROMO_PRESETS.map((p) => `<option value="${esc(p.id)}" ${fields.promoId === p.id ? "selected" : ""}>${esc(p.name)}</option>`)].join("");
  const errorHtml = opts.errors?.length
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5b5b5;color:#8a3a3a;font-size:.88rem;">Error: ${opts.errors.map(esc).join(" ")}</div>`
    : "";
  const savedHtml = opts.savedMsg
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ ${esc(opts.savedMsg)}</div>`
    : "";
  const previewHtml = opts.previewHtml
    ? `<h2 style="margin:1.6rem 0 .8rem;">Preview</h2><iframe srcdoc="${esc(opts.previewHtml)}" style="width:100%;height:600px;border:1.5px solid #ede7e0;border-radius:10px;"></iframe>
       <button type="submit" name="intent" value="send" style="margin-top:1rem;font:inherit;font-weight:700;padding:.6em 1.4em;background:#8a3a52;color:#fff;border:none;border-radius:6px;cursor:pointer;">Send Now</button>`
    : `<button type="submit" name="intent" value="preview" style="font:inherit;font-weight:700;padding:.6em 1.4em;background:#8a3a52;color:#fff;border:none;border-radius:6px;cursor:pointer;">Preview</button>`;

  return `
    ${savedHtml}${errorHtml}
    <form method="POST" action="${RETURN}">
      <h2 style="margin:0 0 .8rem;">Audience</h2>
      <label style="display:block;margin-bottom:.4rem;"><input type="radio" name="audience" value="newsletter" ${fields.audience === "past-clients" ? "" : "checked"} style="width:auto;"> Newsletter</label>
      <label style="display:block;margin-bottom:1.2rem;"><input type="radio" name="audience" value="past-clients" ${fields.audience === "past-clients" ? "checked" : ""} style="width:auto;"> Past clients</label>

      <h2 style="margin:1.6rem 0 .8rem;">Reference a promo (optional)</h2>
      <select name="promoId" style="width:100%;padding:.5em;margin-bottom:1.2rem;">${promoOptions}</select>

      <h2 style="margin:1.6rem 0 .8rem;">Email content</h2>
      <label style="display:block;margin-bottom:.3rem;">Subject line</label>
      <input type="text" name="subject" value="${v("subject")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Headline</label>
      <input type="text" name="headline" value="${v("headline")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Body (blank line between paragraphs)</label>
      <textarea name="bodyText" rows="6" style="width:100%;padding:.5em;margin-bottom:1rem;">${v("bodyText")}</textarea>
      <label style="display:block;margin-bottom:.3rem;">Highlight label (optional)</label>
      <input type="text" name="highlightLabel" value="${v("highlightLabel")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Highlight value (optional)</label>
      <input type="text" name="highlightValue" value="${v("highlightValue")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Hero image URL (optional)</label>
      <input type="text" name="heroImage" value="${v("heroImage")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">CTA label</label>
      <input type="text" name="ctaLabel" value="${v("ctaLabel")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">CTA link</label>
      <input type="text" name="ctaHref" value="${v("ctaHref")}" style="width:100%;padding:.5em;margin-bottom:1.4rem;">

      ${previewHtml}
    </form>

    <h2 style="margin:2.2rem 0 .8rem;">Past clients list</h2>
    <p style="color:#8a7d72;font-size:.85rem;margin:0 0 .8rem;">Backfill or refresh the past-clients Brevo list from every settled booking.</p>
    <form method="POST" action="${RETURN}/sync-past-clients">
      <button type="submit" style="font:inherit;font-weight:700;padding:.6em 1.4em;background:#fff;color:#8a3a52;border:1.5px solid #8a3a52;border-radius:6px;cursor:pointer;">Sync past clients to Brevo</button>
    </form>`;
}

export async function handleAdminMarketing(
  req: Request,
  env: MarketingEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);

  if (req.method === "POST") {
    const form = await req.formData();
    const fields = readFields(form);
    const intent = String(form.get("intent") ?? "");
    const errors = validate(fields);

    if (errors.length) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors }), url.pathname));
    }

    if (intent === "preview") {
      const previewHtml = buildHtml(fields);
      return htmlResponse(shell("Marketing", user, formHtml(fields, { previewHtml }), url.pathname));
    }

    // intent === "send"
    const listIdStr = fields.audience === "past-clients" ? env.BREVO_PAST_CLIENTS_LIST_ID : env.BREVO_NEWSLETTER_LIST_ID;
    const listId = parseInt(listIdStr ?? "0", 10);
    if (!listId) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors: ["That audience's Brevo list isn't configured yet."] }), url.pathname));
    }

    const html = buildHtml(fields);
    try {
      const { id } = await createAndSendCampaign(env, { subject: fields.subject, htmlContent: html, listId, senderEmail: env.NOTIFY_EMAIL }, f);
      await writeAudit(env, { bookingId: null, eventType: "marketing.campaign-sent", payload: { campaignId: id, audience: fields.audience, subject: fields.subject } }, f);
      return redirect(`${RETURN}?sent=1`);
    } catch (e) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors: [`Send failed: ${String(e)}`] }), url.pathname));
    }
  }

  const sentMsg = url.searchParams.get("sent") === "1" ? "Campaign sent." : "";
  return htmlResponse(shell("Marketing", user, formHtml({ audience: "newsletter" }, { savedMsg: sentMsg }), url.pathname));
}

export async function handleAdminMarketingSyncPastClients(
  req: Request,
  env: MarketingEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const listId = parseInt(env.BREVO_PAST_CLIENTS_LIST_ID ?? "0", 10);
  if (!listId) return redirect(`${RETURN}?syncError=1`);

  const clients = await listSettledBookingEmails(env, f);
  await Promise.all(clients.map((c) => upsertBrevoContact(env, c.bride_email, listId, f).catch(() => {})));
  await writeAudit(env, { bookingId: null, eventType: "marketing.past-clients-synced", payload: { count: clients.length } }, f).catch(() => {});
  return redirect(`${RETURN}?synced=${clients.length}`);
}
