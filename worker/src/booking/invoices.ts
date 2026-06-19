/**
 * GET /api/admin/invoices — admin invoice listing for Zandeline.
 * ?token=ADMIN_SECRET — required (timing-safe gate, same as accounting/blocked-dates)
 *
 * Lists all bookings sorted by wedding date. Each row has a pre-signed
 * "View invoice" link using signActionToken("invoice", 2-year TTL) — the same
 * token that /api/booking/invoice verifies via verifyActionToken.
 */

import { listAccountingRows } from "./db";
import type { AccountingEnv } from "./accounting";
import { signActionToken } from "./token";

export interface InvoicesEnv extends AccountingEnv {
  SIGNING_SECRET: string;
}

const enc = new TextEncoder();

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const esc = (s = "") =>
  String(s).replace(/[<>&"']/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

function zar(cents: number): string {
  return `R ${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

const BADGE_CLASS: Record<string, string> = {
  settled: "badge-set",
  deposit_paid: "badge-dp",
  accepted: "badge-acc",
  quote_sent: "badge-q",
  requested: "badge-req",
  rejected: "badge-rej",
  declined: "badge-rej",
  cancelled: "badge-rej",
  invoice_expired: "badge-exp",
};

const STATUS_LABEL: Record<string, string> = {
  settled: "Settled",
  deposit_paid: "Deposit paid",
  accepted: "Accepted",
  quote_sent: "Quote sent",
  requested: "Requested",
  rejected: "Rejected",
  declined: "Declined",
  cancelled: "Cancelled",
  invoice_expired: "Expired",
};

function pageShell(title: string, inner: string, token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Admin</title><style>
body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.wrap{max-width:1000px;margin:5vh auto 3rem;padding:0 1rem;}
.card{background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);margin-bottom:1.6rem;}
h1{font-size:1.4rem;margin:0 0 .3rem;color:#8a3a52;}
.subtitle{color:#8a7d72;font-size:.9rem;margin:0 0 1.8rem;}
table{border-collapse:collapse;width:100%;font-size:.93rem;}
th{text-align:left;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.35rem 0;border-bottom:1.5px solid #ede7e0;}
td{padding:.45rem 0;border-bottom:1px solid #f3ede8;vertical-align:middle;}
td.num{font-variant-numeric:tabular-nums;text-align:right;padding-right:.5rem;}
th.num{text-align:right;padding-right:.5rem;}
.badge{display:inline-block;font-size:.75rem;font-weight:600;border-radius:999px;padding:.15em .7em;line-height:1.5;}
.badge-set{background:#d4edda;color:#155724;}
.badge-dp{background:#fff3cd;color:#856404;}
.badge-q{background:#d1ecf1;color:#0c5460;}
.badge-acc{background:#d4edda;color:#155724;}
.badge-req{background:#e2e3e5;color:#383d41;}
.badge-rej{background:#f8d7da;color:#721c24;}
.badge-exp{background:#e2e3e5;color:#6c757d;}
.nav{display:flex;gap:.8rem;margin-bottom:1.4rem;align-items:center;}
.nav a{font-size:.88rem;color:#8a3a52;text-decoration:none;font-weight:600;border:1.5px solid #e0cfc8;border-radius:8px;padding:.3em .9em;}
.nav a:hover{background:#fdf5f1;}
.inv-link{color:#8a3a52;font-size:.85rem;text-decoration:none;font-weight:600;}
.inv-link:hover{text-decoration:underline;}
.empty{color:#8a7d72;font-size:.92rem;padding:.4rem 0;}
</style></head><body><div class="wrap">
<div class="nav">
  <strong style="font-size:1rem;color:#8a3a52;">Lustique Admin</strong>
  <a href="/api/admin/blocked-dates?token=${esc(token)}">Availability</a>
  <a href="/api/admin/accounting?token=${esc(token)}">Accounting</a>
</div>
${inner}</div></body></html>`;
}

type EnrichedRow = {
  id: string;
  reference: string;
  bride_name: string;
  wedding_date: string;
  status: string;
  total_cents: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  invoiceToken: string;
};

function buildPage(rows: EnrichedRow[], baseUrl: string): string {
  const sorted = [...rows].sort((a, b) => a.wedding_date.localeCompare(b.wedding_date));

  const tableRows = sorted.length
    ? sorted
        .map((r) => {
          const invoiceHref = `${baseUrl}/api/booking/invoice?token=${encodeURIComponent(r.invoiceToken)}`;
          return `<tr>
<td>${esc(r.reference)}</td>
<td>${esc(r.bride_name)}</td>
<td>${esc(fmtDate(r.wedding_date))}</td>
<td><span class="badge ${BADGE_CLASS[r.status] ?? "badge-req"}">${esc(STATUS_LABEL[r.status] ?? r.status)}</span></td>
<td class="num">${zar(r.total_cents)}</td>
<td class="num">${zar(r.deposit_net_cents)}</td>
<td class="num">${zar(r.balance_net_cents)}</td>
<td><a class="inv-link" href="${esc(invoiceHref)}" target="_blank">View ↗</a></td>
</tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="empty">No bookings yet.</td></tr>`;

  return `<h1>Invoices</h1><p class="subtitle">All bookings · click View to open a bride's invoice</p>
<div class="card">
<table>
<thead><tr>
<th>Reference</th><th>Bride</th><th>Wedding date</th><th>Status</th>
<th class="num">Total</th><th class="num">Deposit</th><th class="num">Balance</th><th>Invoice</th>
</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>`;
}

export async function handleAdminInvoices(
  env: InvoicesEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) return htmlResponse(pageShell("Unauthorized", "<h1>Unauthorized</h1><p>Missing token.</p>", ""), 401);
  if (!await timingSafeEqual(token, env.ADMIN_SECRET)) {
    return htmlResponse(pageShell("Unauthorized", "<h1>Unauthorized</h1><p>Invalid token.</p>", ""), 401);
  }

  const rows = await listAccountingRows(env, fetchImpl);

  const INVOICE_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);

  const enriched = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      invoiceToken: await signActionToken(r.id, expiresAt, env.SIGNING_SECRET, "invoice"),
    })),
  );

  const baseUrl = `${url.protocol}//${url.host}`;
  return htmlResponse(pageShell("Invoices", buildPage(enriched, baseUrl), token));
}
