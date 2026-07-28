// worker/src/booking/artist-media.ts
// Artist photo + short bio management — backed by Supabase Storage bucket "portfolio"
// and the 'artists' table.
//
// Routes (single handler, dispatched by method + pathname):
//   GET  /api/admin/artists                    — list artists + current photo/bio
//   POST /api/admin/artists/:id/photo           — upload/replace photo
//   POST /api/admin/artists/:id/bio             — update short_bio and/or role
//   POST /api/admin/artists/order               — save display order by ordered id list

import { getAdminSession, type AdminUser, type AuthEnv } from "./auth";
import { writeAudit } from "./audit";
import type { DbEnv } from "./db";

export interface ArtistEnv extends AuthEnv, DbEnv {
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}

const BUCKET = "portfolio";

const esc = (s?: unknown) =>
  String(s ?? "").replace(/[<>&\"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "x-frame-options": "DENY" },
  });
}

function redirect(loc: string): Response {
  return new Response(null, { status: 302, headers: { Location: loc } });
}

interface ArtistRow {
  id: string;
  name: string;
  role: string | null;
  short_bio: string | null;
  position: number | null;
  photo_url: string | null;
}

function loginShell(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:sans-serif;padding:2rem;"><a href="/api/admin/login">Login required</a></body></html>`;
}

function photoCell(a: ArtistRow, publicBase: string): string {
  const src = a.photo_url || `${publicBase}${a.id}/profile.jpg`;
  return `<img src="${esc(src)}" alt="${esc(a.name)}" style="width:54px;height:54px;object-fit:cover;border-radius:50%;" onerror="this.style.visibility='hidden';">`;
}

function tableForm(row: ArtistRow): string {
  return `<form method="POST" class="inline-form" enctype="multipart/form-data" style="display:grid;gap:.6rem;align-items:start;">
    <input type="hidden" name="id" value="${esc(row.id)}" />
    <label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;font-weight:700;">Photo (replace)</label>
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" style="font:inherit;font-size:.86rem;" />
    <label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;font-weight:700;">Role</label>
    <input name="role" value="${esc(row.role ?? "")}" placeholder="e.g. Bridal Hair & Makeup" />
    <label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#8a7d72;font-weight:700;">Short bio</label>
    <textarea name="short_bio" rows="3" placeholder="2–3 sentences, first person">${esc(row.short_bio ?? "")}</textarea>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;">
      <button type="submit" class="btn btn-sm btn-primary" formaction="/api/admin/artists/bio">Save bio</button>
      <button type="submit" class="btn btn-sm" formaction="/api/admin/artists/photo">Upload photo</button>
    </div>
  </form>`;
}

function renderShell(title: string, user: AdminUser, inner: string, currentPath: string, shell: (t: string, u: AdminUser, i: string, p?: string) => string): string {
  return shell(title, user, inner, currentPath);
}

export async function handleAdminArtists(
  req: Request,
  env: ArtistEnv,
  shell: (title: string, user: AdminUser, inner: string, currentPath?: string) => string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return htmlResponse(loginShell("Artists"), 302);
  const url = new URL(req.url);
  const aHdr = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const publicBase = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/artists/`;

  // POST dispatchers
  if (req.method === "POST") {
    if (url.pathname === "/api/admin/artists/order") {
      try {
        const fd = await req.formData();
        const ids = JSON.parse(fd.get("ids") as string) as string[];
        await Promise.all(
          ids.map((id, i) =>
            f(`${env.SUPABASE_URL}/rest/v1/artists?id=eq.${id}`, {
              method: "PATCH", headers: { ...aHdr, "content-type": "application/json", prefer: "return=minimal" },
              body: JSON.stringify({ position: i + 1 }),
            }),
          ),
        );
        await writeAudit(env, { bookingId: null, eventType: "artist.order", payload: { count: ids.length } }, f).catch(() => {});
      } catch { /* ignore */ }
      return redirect("/api/admin/artists?saved=1");
    }
    // bio / photo share the same handler shape; both need id + (role/short_bio) or (image)
    try {
      const fd = await req.formData();
      const id = (fd.get("id") as string) || "";
      const patch: Record<string, unknown> = {};
      const role = fd.get("role");
      const bio = fd.get("short_bio");
      if (role !== null) patch.role = role;
      if (bio !== null) patch.short_bio = bio;
      if (Object.keys(patch).length) {
        await f(`${env.SUPABASE_URL}/rest/v1/artists?id=eq.${id}`, {
          method: "PATCH", headers: { ...aHdr, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(patch),
        });
        await writeAudit(env, { bookingId: null, eventType: "artist.updated", payload: { id } }, f).catch(() => {});
      }
      // photo upload (best-effort via storage REST)
      const image = fd.get("image");
      if (image && image instanceof Blob && image.size > 0) {
        await f(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/artists/${id}/profile.jpg`, {
          method: "PUT", headers: { ...aHdr, "content-type": image.type, "x-upsert": "true" }, body: image,
        });
        const photoUrl = `${publicBase}${id}/profile.jpg`;
        await f(`${env.SUPABASE_URL}/rest/v1/artists?id=eq.${id}`, {
          method: "PATCH", headers: { ...aHdr, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ photo_url: photoUrl }),
        });
      }
    } catch { /* ignore */ }
    return redirect("/api/admin/artists?saved=1");
  }

  // GET — list
  const r = await f(`${env.SUPABASE_URL}/rest/v1/artists?active=eq.true&select=id,name,role,short_bio,position,photo_url&order=position.asc`, { headers: aHdr });
  const rows: ArtistRow[] = r.ok ? ((await r.json()) as ArtistRow[]) : [];
  const flash = url.searchParams.get("saved") ? `<div style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:.5rem 1rem;margin-bottom:1rem;color:#276749;">Saved.</div>` : "";

  const rowsHtml = rows.length
    ? rows.map((row) => `<tr draggable="true" data-id="${esc(row.id)}" data-position="${esc(String(row.position ?? 0))}">
        <td style="text-align:center;color:#c0b4aa;cursor:grab;">⠿</td>
        <td>${photoCell(row, publicBase)}</td>
        <td><div style="font-weight:700;color:#3d2b38;">${esc(row.name)}</div><div style="font-size:.8rem;color:#8a7d72;">${esc(row.role ?? "—")}</div></td>
        <td><div style="font-size:.88rem;color:#5c5048;">${(row.short_bio ?? "").trim() ? esc(row.short_bio) : '<span style="color:#8a7d72;">No bio yet.</span>'}</div></td>
        <td><details><summary class="btn btn-sm">Edit</summary><div style="margin-top:.6rem;">${tableForm(row)}</div></details></td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="color:#8a7d72;font-style:italic;">No active artists. Add them in Supabase first.</td></tr>`;

  const inner = `${flash}
    <p style="color:#8a7d72;font-size:.86rem;margin:0 0 1rem;">Drag rows to reorder. Edits save per artist.</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="width:56px;"></th><th>Photo</th><th>Name</th><th>Role / bio</th><th style="width:110px;">Actions</th>
      </tr></thead>
      <tbody id="artistTbody">
        ${rowsHtml}
      </tbody>
    </table>
    <div id="orderMsg" style="margin-top:.6rem;font-size:.85rem;color:#8a7d72;"></div>
    <script>
      (function(){
        var tbody = document.getElementById('artistTbody');
        var dragSrc = null;
        function clearHL(){ Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(r){ r.style.borderTop=''; r.style.borderBottom=''; }); }
        tbody.addEventListener('dragstart', function(e){ dragSrc = e.target.closest('tr[draggable]'); if(dragSrc) dragSrc.style.opacity='0.4'; });
        tbody.addEventListener('dragover', function(e){ e.preventDefault(); var row = e.target.closest('tr[draggable]'); if(!row || row===dragSrc) return; clearHL(); var rect = row.getBoundingClientRect(); if(e.clientY < rect.top + rect.height/2) row.style.borderTop='2px solid #8a3a52'; else row.style.borderBottom='2px solid #8a3a52'; });
        tbody.addEventListener('drop', function(e){ e.preventDefault(); clearHL(); var row = e.target.closest('tr[draggable]'); if(!row || row===dragSrc) return; if(e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height/2) tbody.insertBefore(dragSrc, row); else tbody.insertBefore(dragSrc, row.nextSibling); saveOrder(); });
        tbody.addEventListener('dragend', function(){ if(dragSrc) dragSrc.style.opacity=''; dragSrc=null; clearHL(); });
        function saveOrder(){ var ids = Array.prototype.map.call(tbody.querySelectorAll('tr[data-id]'), function(r){ return r.getAttribute('data-id'); }); fetch('/api/admin/artists/order', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ids: ids }) }).then(function(r){ return r.json(); }).then(function(d){ var el=document.getElementById('orderMsg'); if(el){ el.textContent = (d && d.ok) ? 'Order saved ✓' : 'Save failed'; el.style.color = (d && d.ok) ? '#276749' : '#c53030'; setTimeout(function(){ el.textContent=''; }, 2000); } }).catch(function(){ var el=document.getElementById('orderMsg'); if(el){ el.textContent='Save failed'; el.style.color='#c53030'; } }); }
      })();
    </script>`;

  return htmlResponse(renderShell("Artists", user, inner, url.pathname, shell));
}
