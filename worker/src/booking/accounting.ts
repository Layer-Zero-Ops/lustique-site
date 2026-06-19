/**
 * GET /api/admin/accounting — internal accounting dashboard for Zandeline.
 *
 * ?token=ADMIN_SECRET   — required (timing-safe, same gate as blocked-dates admin)
 * ?export=csv           — stream a CSV of all bookings instead of the HTML page
 *
 * Shows:
 *   - Revenue by month (settled bookings)
 *   - Outstanding amounts (deposit_paid — balance not yet received)
 *   - Pipeline snapshot (accepted, quote_sent, requested)
 */

import { listAccountingRows } from "./db";
import type { DbEnv } from "./db";

export interface AccountingEnv extends DbEnv {
  ADMIN_SECRET: string;
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
  return iso.slice(0, 10); // YYYY-MM-DD
}

function pageShell(title: string, inner: string, token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Admin</title><style>
body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.wrap{max-width:900px;margin:5vh auto 3rem;padding:0 1rem;}
.card{background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);margin-bottom:1.6rem;}
h1{font-size:1.4rem;margin:0 0 .3rem;color:#8a3a52;}
.subtitle{color:#8a7d72;font-size:.9rem;margin:0 0 1.8rem;}
h2{font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin:0 0 .8rem;}
table{border-collapse:collapse;width:100%;font-size:.93rem;}
th{text-align:left;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.35rem 0;border-bottom:1.5px solid #ede7e0;}
td{padding:.45rem 0;border-bottom:1px solid #f3ede8;vertical-align:middle;}
td.num{font-variant-numeric:tabular-nums;text-align:right;padding-right:.5rem;}
th.num{text-align:right;padding-right:.5rem;}
.total-row td{font-weight:700;color:#8a3a52;border-top:2px solid #ede7e0;border-bottom:none;}
.badge{display:inline-block;font-size:.75rem;font-weight:600;border-radius:999px;padding:.15em .7em;line-height:1.5;}
.badge-dp{background:#fff3cd;color:#856404;}
.badge-q{background:#d1ecf1;color:#0c5460;}
.badge-acc{background:#d4edda;color:#155724;}
.badge-req{background:#e2e3e5;color:#383d41;}
.kpi-row{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.6rem;}
.kpi{flex:1;min-width:160px;background:#fff;border-radius:12px;padding:1.2rem 1.4rem;box-shadow:0 4px 20px rgba(0,0,0,.05);}
.kpi-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;margin-bottom:.3rem;}
.kpi-value{font-size:1.5rem;font-weight:700;color:#8a3a52;font-variant-numeric:tabular-nums;}
.kpi-sub{font-size:.8rem;color:#8a7d72;margin-top:.2rem;}
.nav{display:flex;gap:.8rem;margin-bottom:1.4rem;align-items:center;}
.nav a{font-size:.88rem;color:#8a3a52;text-decoration:none;font-weight:600;border:1.5px solid #e0cfc8;border-radius:8px;padding:.3em .9em;}
.nav a:hover{background:#fdf5f1;}
.empty{color:#8a7d72;font-size:.92rem;padding:.4rem 0;}
</style></head><body><div class="wrap">
<div class="nav">
  <strong style="font-size:1rem;color:#8a3a52;">Lustique Admin</strong>
  <a href="/api/admin/blocked-dates?token=${esc(token)}">Availability</a>
  <a href="/api/admin/invoices?token=${esc(token)}">Invoices</a>
  <a href="/api/admin/accounting?token=${esc(token)}&export=csv" style="margin-left:auto;">⬇ Export CSV</a>
</div>
${inner}</div></body></html>`;
}

export interface AccountingRow {
  id: string;
  reference: string;
  bride_name: string;
  bride_email: string;
  occasion: string;
  wedding_date: string;
  status: string;
  total_cents: number;
  deposit_net_cents: number;
  balance_net_cents: number;
  deposit_paid_at: string | null;
  settled_at: string | null;
  created_at: string;
}

function buildDashboard(rows: AccountingRow[], token: string): string {
  // --- KPIs ---
  const settled = rows.filter((r) => r.status === "settled");
  const depositPaid = rows.filter((r) => r.status === "deposit_paid");
  const accepted = rows.filter((r) => r.status === "accepted");
  const quoteSent = rows.filter((r) => r.status === "quote_sent");

  const totalRevenue = settled.reduce((s, r) => s + r.total_cents, 0);
  const outstanding = depositPaid.reduce((s, r) => s + r.balance_net_cents, 0);
  const pipeline = accepted.reduce((s, r) => s + r.total_cents, 0);

  const kpis = `<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Total revenue (settled)</div><div class="kpi-value">${zar(totalRevenue)}</div><div class="kpi-sub">${settled.length} booking${settled.length !== 1 ? "s" : ""}</div></div>
  <div class="kpi"><div class="kpi-label">Outstanding balances</div><div class="kpi-value">${zar(outstanding)}</div><div class="kpi-sub">${depositPaid.length} booking${depositPaid.length !== 1 ? "s" : ""} awaiting balance</div></div>
  <div class="kpi"><div class="kpi-label">Accepted pipeline</div><div class="kpi-value">${zar(pipeline)}</div><div class="kpi-sub">${accepted.length} accepted · ${quoteSent.length} quote sent</div></div>
</div>`;

  // --- Revenue by month ---
  const monthMap = new Map<string, { count: number; cents: number }>();
  for (const r of settled) {
    const month = (r.settled_at ?? r.updated_at ?? "").slice(0, 7); // YYYY-MM
    if (!month) continue;
    const entry = monthMap.get(month) ?? { count: 0, cents: 0 };
    entry.count += 1;
    entry.cents += r.total_cents;
    monthMap.set(month, entry);
  }
  const months = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const revenueRows = months.length
    ? months
        .map(
          ([m, { count, cents }]) =>
            `<tr><td>${esc(m)}</td><td>${count}</td><td class="num">${zar(cents)}</td></tr>`,
        )
        .join("") +
      `<tr class="total-row"><td>Total</td><td>${settled.length}</td><td class="num">${zar(totalRevenue)}</td></tr>`
    : `<tr><td colspan="3" class="empty">No settled bookings yet.</td></tr>`;

  const revenueTable = `<div class="card"><h2>Revenue by month (settled bookings)</h2>
<table><thead><tr><th>Month</th><th>Bookings</th><th class="num">Revenue</th></tr></thead>
<tbody>${revenueRows}</tbody></table></div>`;

  // --- Outstanding balances ---
  const outstandingRows = depositPaid.length
    ? depositPaid
        .sort((a, b) => a.wedding_date.localeCompare(b.wedding_date))
        .map(
          (r) =>
            `<tr>
<td>${esc(r.reference)}</td>
<td>${esc(r.bride_name)}</td>
<td>${esc(fmtDate(r.wedding_date))}</td>
<td>${esc(r.occasion)}</td>
<td>${esc(fmtDate(r.deposit_paid_at))}</td>
<td class="num">${zar(r.balance_net_cents)}</td>
</tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="empty">No outstanding balances.</td></tr>`;

  const outstandingTable = `<div class="card"><h2>Outstanding balances — deposit paid, awaiting final balance</h2>
<table><thead><tr><th>Reference</th><th>Bride</th><th>Wedding date</th><th>Occasion</th><th>Deposit paid</th><th class="num">Balance due</th></tr></thead>
<tbody>${outstandingRows}</tbody></table></div>`;

  // --- Pipeline ---
  const pipelineStatuses = ["accepted", "quote_sent", "requested"];
  const pipelineRows = rows
    .filter((r) => pipelineStatuses.includes(r.status))
    .sort((a, b) => a.wedding_date.localeCompare(b.wedding_date));

  const badgeClass: Record<string, string> = {
    accepted: "badge-acc",
    quote_sent: "badge-q",
    requested: "badge-req",
    deposit_paid: "badge-dp",
  };
  const statusLabel: Record<string, string> = {
    accepted: "Accepted",
    quote_sent: "Quote sent",
    requested: "Requested",
    deposit_paid: "Deposit paid",
  };

  const pipelineTableRows = pipelineRows.length
    ? pipelineRows
        .map(
          (r) =>
            `<tr>
<td>${esc(r.reference)}</td>
<td>${esc(r.bride_name)}</td>
<td>${esc(fmtDate(r.wedding_date))}</td>
<td><span class="badge ${badgeClass[r.status] ?? ""}">${esc(statusLabel[r.status] ?? r.status)}</span></td>
<td class="num">${zar(r.total_cents)}</td>
</tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No pipeline bookings.</td></tr>`;

  const pipelineTable = `<div class="card"><h2>Pipeline</h2>
<table><thead><tr><th>Reference</th><th>Bride</th><th>Wedding date</th><th>Status</th><th class="num">Quote total</th></tr></thead>
<tbody>${pipelineTableRows}</tbody></table></div>`;

  return `<h1>Accounting</h1><p class="subtitle">Revenue · outstanding balances · pipeline</p>
${kpis}${revenueTable}${outstandingTable}${pipelineTable}`;
}

function buildCsv(rows: AccountingRow[]): string {
  const headers = [
    "Reference",
    "Bride name",
    "Bride email",
    "Occasion",
    "Wedding date",
    "Status",
    "Total (R)",
    "Deposit (R)",
    "Balance (R)",
    "Deposit paid at",
    "Settled at",
    "Created at",
  ];

  const csvRow = (cells: string[]) =>
    cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");

  const dataRows = rows
    .sort((a, b) => a.wedding_date.localeCompare(b.wedding_date))
    .map((r) =>
      csvRow([
        r.reference,
        r.bride_name,
        r.bride_email,
        r.occasion,
        fmtDate(r.wedding_date),
        r.status,
        (r.total_cents / 100).toFixed(2),
        (r.deposit_net_cents / 100).toFixed(2),
        (r.balance_net_cents / 100).toFixed(2),
        fmtDate(r.deposit_paid_at),
        fmtDate(r.settled_at),
        r.created_at.slice(0, 10),
      ]),
    );

  return [csvRow(headers), ...dataRows].join("\r\n");
}

export async function handleAdminAccounting(
  env: AccountingEnv,
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

  if (url.searchParams.get("export") === "csv") {
    const csv = buildCsv(rows);
    const today = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="lustique-bookings-${today}.csv"`,
      },
    });
  }

  return htmlResponse(pageShell("Accounting", buildDashboard(rows, token), token));
}
