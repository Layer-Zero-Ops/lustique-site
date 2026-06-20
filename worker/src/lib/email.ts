/**
 * Shared email utilities: HTML shell, table/button helpers, Brevo sender, EFT settings.
 * All bride-facing emails use emailShell() for visual consistency.
 */

export const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));

export const fmtZAR = (cents: number): string =>
  `R ${Math.round(cents / 100).toLocaleString("en-ZA")}`;

export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
};

export const firstN = (name: string): string => name.split(" ")[0] ?? name;

const LOGO = "https://lustiqueco.co.za/assets/logo.png";

// ── body helpers ──────────────────────────────────────────────────────────────

/** Paragraph — accepts raw HTML content; caller escapes any user values inside. */
export const ep = (html: string) =>
  `<p style="margin:0 0 16px;font-size:14px;line-height:1.85;color:#3A2E26;font-family:Arial,sans-serif;">${html}</p>`;

/** Italic mocha-serif em span for inline dates/amounts. */
export const em = (text: string) =>
  `<span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#5C4332;">${esc(text)}</span>`;

// ── detail table ──────────────────────────────────────────────────────────────

export interface TableRow {
  key: string;
  val: string;
  bold?: boolean;
  ref?: boolean;  // payment-reference style: mocha italic serif, 15px
}

export function emailTable(rows: TableRow[]): string {
  const TH = `font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#A89080;font-family:Arial,sans-serif;padding:11px 16px 11px 0;border-bottom:1px solid #F5EDE5;white-space:nowrap;vertical-align:top;`;
  const rowHtml = rows
    .map((r) => {
      const valStyle = r.ref
        ? `font-size:15px;font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#5C4332;font-weight:400;padding:11px 0;border-bottom:1px solid #F5EDE5;vertical-align:top;`
        : r.bold
        ? `font-size:13px;font-family:Arial,sans-serif;color:#5C4332;font-weight:500;padding:11px 0;border-bottom:1px solid #F5EDE5;vertical-align:top;`
        : `font-size:13px;font-family:Arial,sans-serif;color:#3A2E26;padding:11px 0;border-bottom:1px solid #F5EDE5;vertical-align:top;`;
      return `<tr><td style="${TH}">${esc(r.key)}</td><td style="${valStyle}">${esc(r.val)}</td></tr>`;
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #EEE5DA;">${rowHtml}</table>`;
}

// ── button-zone helpers ───────────────────────────────────────────────────────

/** Blush pill CTA button. */
export const emailBtn = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background-color:#EFD2C5;color:#5C4332;text-decoration:none;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;padding:14px 40px;border-radius:24px;border:1px solid #5C4332;font-family:Arial,sans-serif;font-weight:500;">${esc(label)}</a>`;

/** Secondary muted text link below the main button. */
export const emailBtnLink = (href: string, label: string) =>
  `<p style="margin:18px 0 0;"><a href="${esc(href)}" style="font-size:12px;font-family:Arial,sans-serif;color:#8A7060;text-decoration:none;">${esc(label)}</a></p>`;

/** Quiet italic note — for informational emails with no CTA. Accepts raw HTML. */
export const emailNote = (html: string) =>
  `<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#8A7060;">${html}</p>`;

// ── email shell ───────────────────────────────────────────────────────────────

export function emailShell({
  heading,
  body,
  btnZone,
  footerNote = `Questions? Write to us at <a href="mailto:info@lustiqueco.co.za" style="color:#5C4332;text-decoration:none;">info@lustiqueco.co.za</a>.`,
}: {
  heading: string;
  body: string;
  btnZone: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#FAF6F0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF6F0;padding:52px 16px;">
<tr><td align="center">
<table width="500" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E8D5B7;">
<tr><td style="padding:60px 56px;">
<div style="text-align:center;padding-bottom:40px;"><img src="${LOGO}" alt="Lustique Cosmetology" width="108" style="display:block;margin:0 auto;" /></div>
<div style="height:1px;background:#E8D5B7;"></div>
<div style="padding:44px 0 40px;border-bottom:1px solid #E8D5B7;">
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:400;font-style:italic;color:#5C4332;line-height:1.3;">${esc(heading)}</h1>
${body}
</div>
<div style="padding:44px 0 40px;text-align:center;border-bottom:1px solid #E8D5B7;">${btnZone}</div>
<div style="padding-top:28px;">
<p style="margin:0 0 16px;font-size:11px;color:#8A7060;line-height:1.75;font-family:Arial,sans-serif;">${footerNote}</p>
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#5C4332;">Lustique Co.</p>
</div>
<div style="text-align:center;padding-top:32px;"><p style="margin:0;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#C8B8AC;font-family:Arial,sans-serif;">Pretoria &middot; South Africa</p></div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── EFT settings ──────────────────────────────────────────────────────────────

export interface EftSettings {
  bank: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
}

export async function getEftSettings(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  f: typeof fetch,
): Promise<EftSettings> {
  const r = await f(
    `${env.SUPABASE_URL}/rest/v1/business_settings?key=in.(eft_bank_name,eft_account_holder,eft_account_number,eft_branch_code)&select=key,value`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`getEftSettings ${r.status}`);
  const rows = (await r.json()) as Array<{ key: string; value: string }>;
  const m = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    bank: m["eft_bank_name"] ?? "",
    accountHolder: m["eft_account_holder"] ?? "",
    accountNumber: m["eft_account_number"] ?? "",
    branchCode: m["eft_branch_code"] ?? "",
  };
}

// ── Brevo sender ──────────────────────────────────────────────────────────────

export async function sendEmail(
  env: { BREVO_API_KEY: string; NOTIFY_EMAIL: string },
  to: { email: string; name?: string },
  subject: string,
  html: string,
  f: typeof fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.NOTIFY_EMAIL, name: "Lustique Co." },
      to: [to],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}
