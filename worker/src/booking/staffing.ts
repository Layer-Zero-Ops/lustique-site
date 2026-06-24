// worker/src/booking/staffing.ts
// Admin Staffing tab — overview of all confirmed upcoming bookings with artist assignments.
// Uses existing assign/remove endpoints; redirects back here via returnTo field.

import { getAdminSession } from "./auth";
import { listArtists, listBookingArtists, type BookingArtistRow } from "./artists";
import type { Env } from "../index";
import type { ShellFn } from "./enquiries";

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
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

interface StaffingBooking {
  id: string;
  reference: string;
  bride_name: string;
  wedding_date: string;
  occasion: string | null;
  party_size: number;
  status: string;
}

const STATUS_CHIP: Record<string, string> = {
  deposit_paid: "background:#f0fff4;color:#276749;",
  settled:      "background:#c6f6d5;color:#22543d;",
};
const STATUS_LABEL: Record<string, string> = {
  deposit_paid: "Booking fee paid",
  settled:      "Settled",
};

const RETURN = "/api/admin/staffing";

export async function handleAdminStaffing(
  req: Request,
  env: Env & { SUPABASE_JWT_SECRET: string },
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const today = new Date().toISOString().slice(0, 10);
  const url = new URL(req.url);
  const savedMsg = url.searchParams.get("saved") === "1" ? "Artist assignment updated." : "";
  const errorMsg = url.searchParams.get("error") ? decodeURIComponent(url.searchParams.get("error")!) : "";

  const [bookingsRes, artists] = await Promise.all([
    f(
      `${env.SUPABASE_URL}/rest/v1/bookings` +
      `?status=in.(deposit_paid,settled)&wedding_date=gte.${today}` +
      `&select=id,reference,bride_name,wedding_date,occasion,party_size,status` +
      `&order=wedding_date.asc&limit=100`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } },
    ),
    listArtists(env, f),
  ]);

  const bookings: StaffingBooking[] = bookingsRes.ok ? (await bookingsRes.json()) as StaffingBooking[] : [];

  // Parallel-fetch assignments for all confirmed bookings
  const assignmentMap = new Map<string, BookingArtistRow[]>();
  if (bookings.length) {
    const results = await Promise.all(
      bookings.map((b) => listBookingArtists(env, b.id, f).then((rows) => ({ id: b.id, rows }))),
    );
    for (const { id, rows } of results) assignmentMap.set(id, rows);
  }

  const rows = bookings.map((b) => {
    const assignments = assignmentMap.get(b.id) ?? [];
    const unassigned = artists.filter((a) => !assignments.some((as) => as.artist_id === a.id));

    // Assigned pills with inline remove
    const assignedHtml = assignments.length
      ? assignments
          .map(
            (a) => `<span style="display:inline-flex;align-items:center;gap:.25rem;background:${a.lead ? "#e9d8fd" : "#ebf8ff"};color:${a.lead ? "#553c9a" : "#2b6cb0"};border-radius:20px;font-size:.72rem;font-weight:700;padding:.12em .55em;white-space:nowrap;">
  ${a.lead ? "★ " : ""}${esc(a.artists.name)}
  <form method="POST" action="/api/admin/booking/${esc(b.id)}/artists/remove" style="display:inline;margin:0;padding:0;">
    <input type="hidden" name="artist_id" value="${esc(a.artist_id)}">
    <input type="hidden" name="returnTo" value="${RETURN}">
    <button type="submit" title="Remove" style="border:none;background:none;cursor:pointer;color:inherit;padding:0 .1em;opacity:.65;font-size:.75rem;line-height:1;" onclick="return confirm('Remove ${esc(a.artists.name)} from ${esc(b.bride_name)}?')">×</button>
  </form>
</span>`,
          )
          .join(" ")
      : `<span style="color:#c53030;font-size:.78rem;font-weight:600;">⚠ Unassigned</span>`;

    // Quick-assign form (only shows artists not yet on this booking)
    const assignForm = unassigned.length
      ? `<form method="POST" action="/api/admin/booking/${esc(b.id)}/artists" style="display:inline-flex;gap:.3rem;align-items:center;flex-wrap:wrap;">
    <input type="hidden" name="returnTo" value="${RETURN}">
    <select name="artist_id" style="font:inherit;font-size:.78rem;padding:.22em .5em;border:1px solid #d0c5bc;border-radius:5px;color:#2b2b2b;">
      ${unassigned.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}
    </select>
    <label style="font-size:.72rem;color:#5c3d47;display:flex;align-items:center;gap:.2rem;white-space:nowrap;cursor:pointer;">
      <input type="checkbox" name="lead" value="true"> Lead
    </label>
    <button type="submit" style="font:inherit;font-size:.76rem;font-weight:700;padding:.22em .7em;background:#8a3a52;color:#fff;border:none;border-radius:5px;cursor:pointer;">Add</button>
  </form>`
      : `<span style="font-size:.74rem;color:#8a7d72;">All assigned</span>`;

    const chip = STATUS_CHIP[b.status] ?? "";
    const statusBadge = `<span style="display:inline-block;padding:.12em .55em;border-radius:12px;font-size:.72rem;font-weight:700;${chip}">${esc(STATUS_LABEL[b.status] ?? b.status)}</span>`;

    return `<tr>
      <td style="white-space:nowrap;font-weight:600;">${esc(b.wedding_date)}</td>
      <td><a href="/api/admin/booking/${esc(b.id)}" style="color:#8a3a52;text-decoration:none;font-weight:600;">${esc(b.bride_name)}</a><div style="font-size:.73rem;color:#8a7d72;">${esc(b.reference)}</div></td>
      <td>${esc(b.occasion ?? "Wedding")}</td>
      <td style="text-align:center;">${b.party_size}</td>
      <td>${statusBadge}</td>
      <td>${assignedHtml}</td>
      <td>${assignForm}</td>
    </tr>`;
  }).join("");

  const inner = `
    ${savedMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ ${esc(savedMsg)}</div>` : ""}
    ${errorMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5c6c6;color:#c53030;font-size:.88rem;">⚠ ${esc(errorMsg)}</div>` : ""}
    ${!bookings.length
      ? `<p style="color:#8a7d72;font-style:italic;">No confirmed upcoming bookings yet. Bookings appear here once the booking fee is paid.</p>`
      : `<table>
          <thead><tr>
            <th>Date</th><th>Bride</th><th>Occasion</th>
            <th style="text-align:center;">Party</th>
            <th>Status</th><th>Assigned artists</th><th>Add artist</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:.78rem;color:#8a7d72;margin-top:1rem;">
          <span style="display:inline-flex;align-items:center;gap:.3rem;">
            <span style="width:8px;height:8px;border-radius:50%;background:#276749;display:inline-block;"></span> Solid dot = confirmed booking
            &nbsp;
            <span style="width:8px;height:8px;border-radius:50%;border:1.5px solid #b7791f;display:inline-block;"></span> Outlined dot = pending (pre-payment)
          </span>
          &nbsp;·&nbsp; Click a bride's name for full booking detail.
        </p>`
    }`;

  return htmlResponse(shell(`Staffing (${bookings.length})`, user, inner, url.pathname));
}
