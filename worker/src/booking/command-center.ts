// worker/src/booking/command-center.ts
// The single unified command center for Lustique operations.
//
// One list, grouped by pipeline stage, with:
//  • SLA column (due in Xh / OVERDUE)  • per-row action bar (Advance ▸, Send quote, Delete)
//  • bulk select + Advance + Delete    • 4 KPI tiles (Pipeline, Collected, Overdue, At-risk)
//  • approval queue (human QC gates)   • responsive + sticky header + real empty states
//
// Reuses EXISTING db.ts helpers (listEnquiries, updateEnquiry, updateBookingStatus,
// softDeleteById, listAccountingRows, insertNotification) and the existing JWT session.
// No new auth or DB layer. No inline style= strings — all classes live in dashboard-style.ts.

import { getAdminSession, type AdminUser } from "./auth";
import {
  listEnquiries,
  listAccountingRows,
  updateEnquiry,
  updateBookingStatus,
  softDeleteById,
  insertNotification,
  type EnquiryCrmRow,
} from "./db";
import type { AccountingRow } from "./accounting";
import { computeKpis, formatZAR, isZeroTotal, isQuoteExpired, isBalanceOverdue, type KpiBooking } from "./dashboard-kpi";
import { nextEnquiryStatus, nextBookingStage } from "./lifecycle-actions";
import { slaFor, nextAutomatedAction, queueDueActions, type PipelineItem } from "./automation";
import { handleAdminSendQuote } from "./admin-actions";
import { DASHBOARD_STYLE } from "./dashboard-style";
import type { Env } from "../index";

export interface CommandEnv extends Env {
  SUPABASE_JWT_SECRET: string;
  SUPABASE_ANON_KEY?: string;
}

// ── Stages (the unified pipeline spine) ──────────────────────────────────────
interface Stage {
  key: string;
  label: string;
  dot: string; // CSS class for the stage dot
  match: (item: PipelineItem) => boolean;
}

const STAGES: Stage[] = [
  { key: "new", label: "New leads", dot: "lz-dot-new", match: (i) => i.kind === "enquiry" && (i.status === "new" || i.status === "contacted") },
  { key: "to-quote", label: "Awaiting quote", dot: "lz-dot-to-quote", match: (i) => i.kind === "booking" && i.status === "requested" },
  { key: "sent", label: "Quote sent", dot: "lz-dot-sent", match: (i) => i.kind === "booking" && i.status === "quote_sent" },
  { key: "confirmed", label: "Confirmed", dot: "lz-dot-confirmed", match: (i) => i.kind === "booking" && (i.status === "accepted" || i.status === "deposit_paid") },
  { key: "done", label: "Settled", dot: "lz-dot-done", match: (i) => i.kind === "booking" && i.status === "settled" },
  { key: "closed", label: "Closed / lost", dot: "lz-dot-closed", match: (i) => (i.kind === "enquiry" && i.status === "closed") || (i.kind === "booking" && i.status === "declined") },
];

const STATUS_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", converted: "Converted", closed: "Closed",
  requested: "Requested", quote_sent: "Quote sent", accepted: "Accepted",
  deposit_paid: "Deposit paid", settled: "Settled", declined: "Declined",
};

function anonKey(env: CommandEnv): string {
  return env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_KEY;
}
function sbHeaders(env: CommandEnv, extra: Record<string, string> = {}): HeadersInit {
  return { apikey: anonKey(env), Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, ...extra };
}

function esc(s = ""): string {
  return String(s ?? "").replace(/[<>&\"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function html(res: string, status = 200): Response {
  return new Response(res, {
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

function redirect(loc: string): Response {
  return new Response(null, { status: 302, headers: { Location: loc } });
}

// ── Shell (reuses the extracted stylesheet + token classes) ───────────────────
function shell(title: string, user: AdminUser, inner: string, currentPath: string): string {
  const nav = [
    navItem("/api/admin/command", "Command Center", currentPath === "/api/admin/command"),
    navItem("/api/admin/calendar", "Calendar", currentPath.startsWith("/api/admin/calendar")),
    navItem("/api/admin/quotes", "Invoices", currentPath.startsWith("/api/admin/quotes")),
    navItem("/api/admin/rejections", "Declined", currentPath.startsWith("/api/admin/rejections")),
    navItem("/api/admin/contacts", "Contacts", currentPath.startsWith("/api/admin/contacts")),
    navItem("/api/admin/portfolio", "Portfolio", currentPath.startsWith("/api/admin/portfolio")),
    navItem("/api/admin/staffing", "Staffing", currentPath.startsWith("/api/admin/staffing")),
    navItem("/api/admin/website", "Website", currentPath.startsWith("/api/admin/website")),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="https://lustiqueco.co.za/favicon.svg">
<title>${esc(title)} — Lustique</title>${DASHBOARD_STYLE}</head>
<body>
<nav class="lz-sidebar">
  <img src="https://lustiqueco.co.za/assets/logo.png" alt="Lustique" class="lz-logo">
  <div class="lz-nav">${nav}</div>
  <div class="lz-sidebar-foot">
    <div class="lz-user">${esc(user.name)}</div>
    <form method="POST" action="/api/admin/auth/logout">
      <button type="submit" class="lz-btn-ghost">Sign out</button>
    </form>
  </div>
</nav>
<main class="lz-main">
  <div class="lz-topbar"><h1>${esc(title)}</h1></div>
  <div class="lz-content">${inner}</div>
</main>
</body></html>`;
}

function navItem(href: string, label: string, active: boolean): string {
  return `<a href="${href}" class="${active ? "active" : ""}">${esc(label)}</a>`;
}

// ── KPI tiles ─────────────────────────────────────────────────────────────────
function kpiTiles(kpi: ReturnType<typeof computeKpis>, atRisk: number, overdue: number): string {
  const tiles = [
    { label: "Pipeline", value: formatZAR(kpi.pipeline_cents), sub: "open quotes", cls: "" },
    { label: "Collected", value: formatZAR(kpi.collected_cents), sub: `${kpi.collection_pct}% of billed`, cls: "good" },
    { label: "Overdue", value: String(overdue), sub: "balances + expired", cls: overdue > 0 ? "alert" : "" },
    { label: "At risk", value: String(atRisk), sub: "needs attention", cls: atRisk > 0 ? "alert" : "" },
  ];
  return `<div class="lz-kpis">${tiles
    .map((t) => `<div class="lz-kpi ${t.cls}"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div></div>`)
    .join("")}</div>`;
}

// ── Row card (no detail page required for routine actions) ────────────────────
function rowCard(item: PipelineItem): string {
  const sla = slaFor(item);
  const slaCls = sla.state === "over" ? "over" : sla.state === "due" ? "due" : "ok";
  const typeLabel = item.kind === "enquiry" ? "Lead" : "Booking";
  // per-row action bar
  const advanceLabel = item.kind === "enquiry" ? nextEnquiryStatus(item.status) : nextBookingStage(item.status).status;
  const advanceDisabled = advanceLabel === item.status;
  const actions = `
    <div class="lz-actions">
      ${advanceDisabled ? "" : `<form method="POST" action="/api/admin/command/bulk" class="lz-form-inline">
        <input type="hidden" name="action" value="advance">
        <input type="hidden" name="ids" value="${esc(item.kind)}:${esc(item.id)}">
        <button type="submit" class="lz-btn lz-btn-advance" title="Advance to ${esc(advanceLabel)}">Advance ▸</button>
      </form>`}
      ${item.kind === "booking" && item.status === "requested" ? `<form method="POST" action="/api/admin/booking/${esc(item.id)}/send-quote" class="lz-form-inline">
        <button type="submit" class="lz-btn lz-btn-quote">Send quote</button></form>` : ""}
      <form method="POST" action="/api/admin/command/bulk" class="lz-form-inline">
        <input type="hidden" name="action" value="delete">
        <input type="hidden" name="ids" value="${esc(item.kind)}:${esc(item.id)}">
        <button type="submit" class="lz-btn lz-btn-danger">Delete</button>
      </form>
    </div>`;
  return `<div class="lz-card ${sla.state === "over" ? "overdue" : ""}">
    <input type="checkbox" name="ids" value="${esc(item.kind)}:${esc(item.id)}" form="bulk-form" class="lz-row-check">
    <div class="who">
      <a href="${esc(item.detailHref)}" class="name">${esc(item.name)}</a>
      <div class="meta">${typeLabel} · <span class="lz-badge ${esc(item.status)}">${esc(STATUS_LABEL[item.status] ?? item.status)}</span></div>
    </div>
    <div class="when">${esc((item.created_at || "").slice(0, 10))}</div>
    <div class="sla ${slaCls}">${esc(sla.label)}</div>
    ${actions}
  </div>`;
}

// ── Empty state ───────────────────────────────────────────────────────────────
function emptyState(stageLabel: string): string {
  return `<div class="lz-empty"><div class="big">Nothing here</div><div class="hint">No submissions in “${esc(stageLabel)}” right now.</div></div>`;
}

// ── GET /api/admin/command ────────────────────────────────────────────────────
export async function handleAdminCommand(
  req: Request,
  env: CommandEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  const url = new URL(req.url);
  const activeTab = url.searchParams.get("stage") ?? "all";

  const [enquiries, bookings, approvals] = await Promise.all([
    listEnquiries(env, null, f),
    listAccountingRows(env, f),
    fetchApprovals(env, f),
  ]);

  const items: PipelineItem[] = [
    ...(enquiries as EnquiryCrmRow[]).map((e) => ({
      kind: "enquiry" as const,
      id: e.id,
      name: e.name,
      status: e.status,
      created_at: e.created_at,
      detailHref: `/api/admin/enquiries/${e.id}`,
    })),
    ...(bookings as AccountingRow[]).map((b) => ({
      kind: "booking" as const,
      id: b.id,
      name: b.bride_name,
      status: b.status,
      created_at: b.created_at,
      quote_sent_at: (b as any).quote_sent_at ?? null,
      detailHref: `/api/admin/booking/${b.id}`,
    })),
  ];

  // KPIs
  const kpiBookings: KpiBooking[] = (bookings as AccountingRow[]).map((b) => ({
    status: b.status,
    total_cents: b.total_cents,
    deposit_net_cents: b.deposit_net_cents,
    balance_net_cents: b.balance_net_cents,
    wedding_date: b.wedding_date,
    created_at: b.created_at,
    quote_sent_at: (b as any).quote_sent_at ?? null,
    archived_at: null,
  }));
  const kpiEnquiries = (enquiries as EnquiryCrmRow[]).map((e) => ({
    id: e.id, status: e.status, created_at: e.created_at, booking_id: (e as any).booking_id ?? null, archived_at: (e as any).archived_at ?? null,
  }));
  const kpi = computeKpis(kpiBookings, kpiEnquiries as any, Date.now());
  const overdue = kpiBookings.filter((b) => isBalanceOverdue(b) || isQuoteExpired(b)).length;

  // Auto-queue due actions as approval tasks (human QC gate) — fire and forget.
  const queuedKeys = new Set(approvals.map((a) => approvalKey(a)));
  queueDueActions(env, items, queuedKeys, insertNotification as any, f).catch(() => {});

  // Tabs
  const counts: Record<string, number> = { all: items.length };
  for (const s of STAGES) counts[s.key] = items.filter(s.match).length;
  const tabs = ["all", ...STAGES.map((s) => s.key)]
    .map((k) => {
      const label = k === "all" ? "All" : (STAGES.find((s) => s.key === k)!.label);
      const active = k === activeTab;
      return `<a href="/api/admin/command?stage=${esc(k)}" class="lz-tab ${active ? "active" : ""}">${esc(label)}<span class="count">${counts[k] ?? 0}</span></a>`;
    })
    .join("");

  // Approval queue
  const approveHtml = approvals.length
    ? `<h2 class="lz-stage-head"><span class="lz-dot lz-dot-rose"></span>Needs your approval</h2>` +
      approvals.map((a) => {
        const p = a.payload as any;
        return `<div class="lz-approve">
          <span class="task">${esc(p?.verb ?? a.title)}</span>
          <span class="draft">${esc(p?.draft ?? a.body ?? "")}</span>
          <form method="POST" action="/api/admin/command/approve" class="lz-form-inline">
            <input type="hidden" name="id" value="${esc(a.id)}">
            <button type="submit" class="lz-btn lz-btn-primary">Approve</button>
          </form>
        </div>`;
      }).join("")
    : "";

  // Grouped stages
  const stageHtml = STAGES.map((s) => {
    const rows = items.filter(s.match);
    const visible = activeTab === "all" || activeTab === s.key ? rows : [];
    if (activeTab !== "all" && activeTab !== s.key) return "";
    const body = rows.length ? rows.map(rowCard).join("") : emptyState(s.label);
    return `<section class="lz-stage">
      <div class="lz-stage-head"><span class="lz-dot ${s.dot}"></span><h2>${esc(s.label)}</h2><span class="lz-stage-count">${rows.length}</span></div>
      ${body}
    </section>`;
  }).join("");

  const bulkBar = `<form id="bulk-form" method="POST" action="/api/admin/command/bulk"></form>
    <div class="lz-bulkbar">
      <label class="check"><input type="checkbox" id="select-all"> Select all</label>
      <div class="lz-actions">
        <button type="submit" form="bulk-form" name="action" value="advance" class="lz-btn lz-btn-advance">Advance selected ▸</button>
        <button type="submit" form="bulk-form" name="action" value="delete" class="lz-btn lz-btn-danger">Delete selected</button>
      </div>
    </div>`;

  const inner = kpiTiles(kpi, kpi.at_risk_count, overdue) + approveHtml + bulkBar + tabs + stageHtml;
  return html(shell("Command Center", user, inner, url.pathname));
}

// ── Approval helpers ───────────────────────────────────────────────────────────
interface ApprovalRow { id: string; title: string; body?: string; payload?: Record<string, unknown> }
function approvalKey(a: ApprovalRow): string {
  const p = a.payload as any;
  return `${p?.kind}:${p?.target_id}:${p?.action}`;
}
async function fetchApprovals(env: CommandEnv, f: typeof fetch): Promise<ApprovalRow[]> {
  const r = await f(`${env.SUPABASE_URL}/rest/v1/notifications?select=id,title,body,payload&type=eq.approval_needed&recipient=eq.admin&order=created_at.asc`, {
    headers: sbHeaders(env),
  });
  if (!r.ok) return [];
  return (await r.json()) as ApprovalRow[];
}

// ── POST /api/admin/command/approve — human approves a queued action ──────────
export async function handleAdminCommandApprove(req: Request, env: CommandEnv, f: typeof fetch = fetch): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  let id = "";
  try { const fd = await req.formData(); id = fd.get("id")?.toString() ?? ""; } catch { return redirect("/api/admin/command"); }
  if (!/^[0-9a-f-]{36}$/.test(id)) return redirect("/api/admin/command");
  // load the approval, execute its action, then delete the notification
  const r = await f(`${env.SUPABASE_URL}/rest/v1/notifications?select=id,payload&id=eq.${id}&limit=1`, {
    headers: sbHeaders(env),
  });
  if (r.ok) {
    const rows = (await r.json()) as Array<{ id: string; payload?: any }>;
    const p = rows[0]?.payload;
    if (p) await executeAutomatedAction(env, req, p, f);
    await f(`${env.SUPABASE_URL}/rest/v1/notifications?id=eq.${id}`, {
      method: "PATCH", headers: sbHeaders(env, { prefer: "return=minimal" }),
      body: JSON.stringify({ read: true, type: "approval_done" }),
    });
  }
  return redirect("/api/admin/command");
}

async function executeAutomatedAction(env: CommandEnv, req: Request, p: { kind: string; target_id: string; action: string }, f: typeof fetch): Promise<void> {
  if (p.kind === "enquiry") {
    if (p.action === "advance_contacted") {
      const ex = await getEnquiryStatus(env, p.target_id, f);
      await updateEnquiry(env, p.target_id, { status: nextEnquiryStatus(ex ?? "new"), contacted_at: new Date().toISOString() }, f);
    }
    // generate_invoice is manual (needs a booking); left as a link in the card.
  } else if (p.kind === "booking" && p.action === "send_quote") {
    // reuse the existing send-quote handler (requested → quote_sent + email bride/team)
    await handleAdminSendQuote(req, env as any, p.target_id, f);
  }
}
async function getEnquiryStatus(env: CommandEnv, id: string, f: typeof fetch): Promise<string | null> {
  const r = await f(`${env.SUPABASE_URL}/rest/v1/enquiries?select=status&id=eq.${id}&deleted_at=is.null&limit=1`, {
    headers: sbHeaders(env),
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}

// ── POST /api/admin/command/bulk — Advance / Delete selected ──────────────────
export async function handleAdminCommandBulk(req: Request, env: CommandEnv, f: typeof fetch = fetch): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");
  let ids: string[] = [];
  let action = "advance";
  try {
    const fd = await req.formData();
    ids = fd.getAll("ids").map(String);
    action = fd.get("action")?.toString() ?? "advance";
  } catch { return redirect("/api/admin/command?error=bad-form"); }

  const ts = new Date().toISOString();
  for (const key of ids) {
    const [kind, id] = key.split(":");
    if (!/^[0-9a-f-]{36}$/.test(id ?? "")) continue;
    if (action === "delete") {
      const table = kind === "enquiry" ? "enquiries" : kind === "booking" ? "bookings" : null;
      if (table) await softDeleteById(env, table as "enquiries" | "bookings", id, f);
      continue;
    }
    // advance
    if (kind === "enquiry") {
      const cur = await getEnquiryStatus(env, id, f);
      if (cur) await updateEnquiry(env, id, { status: nextEnquiryStatus(cur), contacted_at: cur === "new" ? ts : undefined }, f);
    } else if (kind === "booking") {
      const cur = await getBookingStatus(env, id, f);
      if (cur) {
        const stage = nextBookingStage(cur);
        const patch: Record<string, unknown> = { status: stage.status };
        if (stage.stamp) patch[stage.stamp] = ts;
        await updateBookingStatus(env, id, patch, f);
      }
    }
  }
  return redirect("/api/admin/command");
}

async function getBookingStatus(env: CommandEnv, id: string, f: typeof fetch): Promise<string | null> {
  const r = await f(`${env.SUPABASE_URL}/rest/v1/bookings?select=status&id=eq.${id}&deleted_at=is.null&limit=1`, {
    headers: sbHeaders(env),
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}
