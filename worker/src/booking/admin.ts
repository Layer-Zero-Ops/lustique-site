/**
 * GET + POST /api/admin/blocked-dates — Zandeline's blocked-dates admin (S8).
 *
 * Protected by ADMIN_SECRET passed as ?token= query param.
 * Timing-safe comparison via WebCrypto HMAC — Workers have no Node timingSafeEqual.
 *
 * GET  — list all blocked dates + an "Add date" form
 * POST — add a date (action=add) or remove a date (action=remove)
 */

import { listBlockedDates, addBlockedDate, removeBlockedDate, setBlockedDateSlots } from "./db";
import type { DbEnv } from "./db";

export interface AdminEnv extends DbEnv {
  ADMIN_SECRET: string;
}

const enc = new TextEncoder();

/** Constant-time comparison using HMAC with a per-call random key (prevents timing attacks). */
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
  s.replace(/[<>&"']/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lustique Admin</title><style>
body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#2b2b2b;background:#f7f3ef;}
.card{max-width:640px;margin:5vh auto 3rem;background:#fff;border-radius:14px;padding:2.4rem 2rem;box-shadow:0 6px 30px rgba(0,0,0,.06);}
h1{font-size:1.4rem;margin:0 0 1.4rem;color:#8a3a52;}h2{font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin:1.8rem 0 .7rem;}
table{border-collapse:collapse;width:100%;margin:.2rem 0;}
th{text-align:left;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;padding:.3rem 0;border-bottom:1px solid #ede7e0;}
td{padding:.4rem 0;border-bottom:1px solid #f3ede8;vertical-align:middle;}
td.date{font-weight:600;font-variant-numeric:tabular-nums;padding-right:1rem;}
td.reason{color:#6b5d52;font-size:.92rem;}
.btn-remove{font:inherit;font-size:.82rem;font-weight:600;border:1.5px solid #e0c8c8;border-radius:6px;padding:.25em .8em;cursor:pointer;background:none;color:#8a3a52;}
.btn-remove:hover{background:#fdf0f0;}
.add-form{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.6rem;}
.add-form input{font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .7em;flex:1;min-width:140px;}
.add-form input[type=date]{min-width:160px;}
.add-form input:focus{outline:2px solid #8a3a52;border-color:#8a3a52;}
.btn-add{font:inherit;font-weight:600;border:0;border-radius:8px;padding:.45em 1.2em;cursor:pointer;background:#8a3a52;color:#fff;white-space:nowrap;}
.btn-add:hover{background:#7a3048;}
.empty{color:#8a7d72;font-size:.92rem;margin:.4rem 0;}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

function adminPage(
  dates: Array<{ date: string; reason: string | null; slots?: number | null }>,
  token: string,
): string {
  const rows = dates.length
    ? dates
        .map(
          (d) => {
            const slots = d.slots ?? 0;
            const slotsLabel = slots === 0 ? "Hard block" : `${slots} slot${slots === 1 ? "" : "s"}`;
            return `<tr>
<td class="date">${esc(d.date)}</td>
<td class="reason">${esc(d.reason ?? "—")}</td>
<td style="font-size:.88rem;color:#6b5d52;">${esc(slotsLabel)}</td>
<td style="white-space:nowrap;">
  <form method="POST" style="margin:0;display:inline-flex;gap:.3rem;align-items:center;">
    <input type="hidden" name="token" value="${esc(token)}">
    <input type="hidden" name="action" value="set_slots">
    <input type="hidden" name="date" value="${esc(d.date)}">
    <input type="number" name="slots" value="${slots}" min="0" max="99" style="width:3.5rem;font:inherit;border:1.5px solid #c9bfb8;border-radius:6px;padding:.2em .4em;text-align:center;">
    <button class="btn-remove" type="submit">Set</button>
  </form>
  <form method="POST" style="margin:0;display:inline;"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="remove"><input type="hidden" name="date" value="${esc(d.date)}"><button class="btn-remove" type="submit">Remove</button></form>
</td>
</tr>`;
          },
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No blocked dates.</td></tr>`;

  return `<h1>Blocked dates</h1>
<p style="color:#6b5d52;font-size:.92rem;margin:-.5rem 0 1.2rem;">Slots=0 hard-blocks the date (409). Slots&gt;0 soft-caps concurrent bookings.</p>
<table>
<thead><tr><th>Date</th><th>Reason</th><th>Slots</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>
<h2>Block a date</h2>
<form method="POST" class="add-form">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="action" value="add">
<input type="date" name="date" required placeholder="YYYY-MM-DD">
<input type="text" name="reason" placeholder="Reason (optional)" maxlength="200">
<button class="btn-add" type="submit">Block date</button>
</form>`;
}

export async function handleAdminBlockedDates(
  env: AdminEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);

  // Auth: token comes from ?token= on GET, hidden input on POST.
  const tokenFromQuery = url.searchParams.get("token") ?? "";

  if (req.method === "GET") {
    if (!tokenFromQuery) return htmlResponse(pageShell("Unauthorized", "<h1>Unauthorized</h1><p>Missing token.</p>"), 401);
    if (!await timingSafeEqual(tokenFromQuery, env.ADMIN_SECRET)) {
      return htmlResponse(pageShell("Unauthorized", "<h1>Unauthorized</h1><p>Invalid token.</p>"), 401);
    }
    const dates = await listBlockedDates(env, fetchImpl);
    return htmlResponse(pageShell("Blocked dates", adminPage(dates, tokenFromQuery)));
  }

  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const token = String(form?.get("token") ?? "");
    if (!token || !await timingSafeEqual(token, env.ADMIN_SECRET)) {
      return htmlResponse(pageShell("Unauthorized", "<h1>Unauthorized</h1><p>Invalid token.</p>"), 401);
    }

    const action = String(form?.get("action") ?? "");
    const date = String(form?.get("date") ?? "").trim();

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return htmlResponse(pageShell("Bad request", "<h1>Bad request</h1><p>Invalid or missing date (expected YYYY-MM-DD).</p>"), 400);
    }

    if (action === "add") {
      const reason = String(form?.get("reason") ?? "").trim() || null;
      await addBlockedDate(env, date, reason, fetchImpl);
    } else if (action === "remove") {
      await removeBlockedDate(env, date, fetchImpl);
    } else if (action === "set_slots") {
      const slots = Number(form?.get("slots") ?? "0");
      if (!Number.isInteger(slots) || slots < 0 || slots > 99) {
        return htmlResponse(pageShell("Bad request", "<h1>Bad request</h1><p>Slots must be 0–99.</p>"), 400);
      }
      await setBlockedDateSlots(env, date, slots, fetchImpl);
    } else {
      return htmlResponse(pageShell("Bad request", "<h1>Bad request</h1><p>Unknown action.</p>"), 400);
    }

    const dates = await listBlockedDates(env, fetchImpl);
    return htmlResponse(pageShell("Blocked dates", adminPage(dates, token)));
  }

  return new Response("Method not allowed", { status: 405 });
}
