// worker/src/booking/portfolio.ts
// Portfolio image management — backed by Supabase Storage bucket "portfolio".
//
// SETUP (one-time — Pieter):
//   Supabase Dashboard → Storage → New bucket → name: "portfolio" → Public: ON
//   Public URL pattern: ${SUPABASE_URL}/storage/v1/object/public/portfolio/{filename}
//
// Routes:
//   GET  /api/admin/portfolio           — gallery + upload form
//   POST /api/admin/portfolio           — upload new image
//   POST /api/admin/portfolio/delete    — delete an image by name

import { getAdminSession } from "./auth";
import type { Env } from "../index";
import type { ShellFn } from "./enquiries";

export interface PortfolioEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}

const BUCKET = "Portfolio";

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
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

interface StorageObject {
  name: string;
  created_at: string;
  metadata: { size: number; mimetype: string } | null;
}

interface ArtistOption {
  id: string;
  name: string;
}

interface PortfolioImageRecord {
  id: string;
  storage_path: string;
  artist_id: string | null;
  position: number;
}

// ── Portfolio list ────────────────────────────────────────────────────────────

export async function handleAdminPortfolio(
  req: Request,
  env: PortfolioEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  const url = new URL(req.url);

  // POST — upload one or more images
  if (req.method === "POST") {
    let files: File[] = [];
    let artistId = "";
    try {
      const fd = await req.formData();
      files = (fd.getAll("image") as File[]).filter((v) => v instanceof File && v.size > 0);
      artistId = ((fd.get("artist_id") as string | null) ?? "").trim();
    } catch {
      return htmlResponse(`<p>Could not read upload. <a href="/api/admin/portfolio">Back</a></p>`, 400);
    }
    if (files.length === 0) {
      return redirect(`/api/admin/portfolio?error=no-file${artistId ? "&artist=" + encodeURIComponent(artistId) : ""}`);
    }
    // Validate artist_id: must be UUID or empty
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (artistId && !uuidRe.test(artistId)) {
      return redirect("/api/admin/portfolio?error=bad-artist");
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    // Get current max position so we can assign positions sequentially
    const posQs = artistId
      ? `portfolio_images?artist_id=eq.${encodeURIComponent(artistId)}&select=position&order=position.desc&limit=1`
      : `portfolio_images?artist_id=is.null&select=position&order=position.desc&limit=1`;
    const posRes = await f(`${env.SUPABASE_URL}/rest/v1/${posQs}`, { headers: hdr });
    const posRows: Array<{ position: number }> = posRes.ok ? ((await posRes.json()) as Array<{ position: number }>) : [];
    let nextPos = posRows.length > 0 ? (posRows[0]?.position ?? 0) + 10 : 10;

    let successCount = 0;
    let failCount = 0;
    const toInsert: Array<{ storage_path: string; artist_id: string | null; position: number }> = [];
    const batchTs = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      if (file.size > 10 * 1024 * 1024 || !allowed.includes(file.type)) {
        failCount++;
        continue;
      }
      const safeName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase();
      const uniqueName = artistId
        ? `${artistId}/${batchTs}-${i}-${safeName}`
        : `${batchTs}-${i}-${safeName}`;

      const uploadRes = await f(
        `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${uniqueName}`,
        {
          method: "POST",
          headers: {
            ...hdr,
            "content-type": file.type,
            "cache-control": "public, max-age=31536000",
            "x-upsert": "false",
          },
          body: file,
        },
      );

      if (!uploadRes.ok) { failCount++; continue; }

      toInsert.push({ storage_path: uniqueName, artist_id: artistId || null, position: nextPos });
      nextPos += 10;
      successCount++;
    }

    // Batch-insert all DB records in one request
    if (toInsert.length > 0) {
      await f(`${env.SUPABASE_URL}/rest/v1/portfolio_images`, {
        method: "POST",
        headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(toInsert),
      });
    }

    // JSON mode — browser JS uploads one file at a time and reads results directly
    if (url.searchParams.has("json")) {
      return new Response(
        JSON.stringify({ ok: successCount > 0, saved: successCount, failed: failCount }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const qs = new URLSearchParams();
    if (successCount > 0) qs.set("saved", String(successCount));
    if (failCount > 0) qs.set("failed", String(failCount));
    if (artistId) qs.set("artist", artistId);
    return redirect(`/api/admin/portfolio?${qs}`);
  }

  // GET — list images (optionally filtered by artist prefix)
  const filterArtist = url.searchParams.get("artist") ?? "";
  const prefix = filterArtist ? `${filterArtist}/` : "";

  const dbFilter = filterArtist
    ? `portfolio_images?artist_id=eq.${encodeURIComponent(filterArtist)}&select=id,storage_path,artist_id,position&order=position.asc`
    : `portfolio_images?select=id,storage_path,artist_id,position&order=position.asc&limit=500`;

  const [artistsRes, listRes, dbRes] = await Promise.all([
    f(`${env.SUPABASE_URL}/rest/v1/artists?active=eq.true&select=id,name&order=name.asc`, { headers: hdr }),
    f(
      `${env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
      {
        method: "POST",
        headers: { ...hdr, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 200, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
      },
    ),
    f(`${env.SUPABASE_URL}/rest/v1/${dbFilter}`, { headers: hdr }),
  ]);

  const artists: ArtistOption[] = artistsRes.ok ? ((await artistsRes.json()) as ArtistOption[]) : [];
  const rawObjects: StorageObject[] = listRes.ok ? ((await listRes.json()) as StorageObject[]) : [];
  // Storage list with a prefix returns names relative to that prefix.
  // Normalize to absolute paths so all downstream logic (URLs, delete, seed) is consistent.
  const objects = rawObjects
    .filter((o) => o.metadata !== null)
    .map((o) => ({ ...o, name: prefix ? `${prefix}${o.name}` : o.name }));
  const dbRecords: PortfolioImageRecord[] = dbRes.ok ? ((await dbRes.json()) as PortfolioImageRecord[]) : [];

  // Build a position map keyed by storage_path
  const posMap = new Map<string, { id: string; position: number }>();
  for (const r of dbRecords) posMap.set(r.storage_path, { id: r.id, position: r.position });

  // Auto-seed Storage objects that have no portfolio_images record yet
  const unseeded = objects.filter((o) => !posMap.has(o.name));
  if (unseeded.length > 0) {
    const maxPos = dbRecords.length > 0 ? Math.max(...dbRecords.map((r) => r.position)) : 0;
    const toInsert = unseeded
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((obj, i) => {
        const artistIdForObj = obj.name.includes("/") ? obj.name.split("/")[0] ?? null : null;
        const pos = maxPos + (i + 1) * 10;
        posMap.set(obj.name, { id: "", position: pos });
        return { storage_path: obj.name, artist_id: artistIdForObj, position: pos };
      });
    await f(`${env.SUPABASE_URL}/rest/v1/portfolio_images`, {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(toInsert),
    });
  }

  // Sort objects by their assigned position
  const sortedObjects = [...objects].sort((a, b) => {
    const posA = posMap.get(a.name)?.position ?? 999999;
    const posB = posMap.get(b.name)?.position ?? 999999;
    return posA - posB;
  });

  const savedCount = parseInt(url.searchParams.get("saved") ?? "0", 10);
  const failedCount = parseInt(url.searchParams.get("failed") ?? "0", 10);
  const errorP = url.searchParams.get("error");

  const errorMessages: Record<string, string> = {
    "no-file":       "No file selected — please choose at least one image.",
    "too-large":     "File too large — maximum 10 MB per image.",
    "bad-type":      "Unsupported format — use JPEG, PNG, WebP or GIF.",
    "exists":        "A file with that name already exists.",
    "upload-failed": "Upload failed — please try again.",
    "bad-artist":    "Invalid artist selection.",
  };

  const publicBase = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;
  const activeArtist = artists.find((a) => a.id === filterArtist);

  // Filter tabs
  const tabStyle = (active: boolean) =>
    `display:inline-block;padding:.3em .85em;border-radius:20px;font-size:.82rem;font-weight:${active ? "700" : "500"};text-decoration:none;` +
    (active ? "background:#8a3a52;color:#fff;" : "background:#f7f3ef;color:#5c3d47;border:1px solid #ede7e0;");
  const filterTabs = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.4rem;">
      <a href="/api/admin/portfolio" style="${tabStyle(!filterArtist)}">All</a>
      ${artists.map((a) => `<a href="/api/admin/portfolio?artist=${encodeURIComponent(a.id)}" style="${tabStyle(a.id === filterArtist)}">${esc(a.name)}</a>`).join("")}
    </div>`;

  // Strip artist-prefix from displayed filename
  const displayName = (name: string) => name.includes("/") ? name.split("/").slice(1).join("/") : name;

  const orderNote = !filterArtist
    ? `<p style="font-size:.82rem;color:#8a7d72;margin:-1rem 0 1.2rem;">Select an artist tab to reorder images.</p>`
    : "";

  const btnStyle = `font:inherit;font-size:.9rem;background:#f7f3ef;color:#5c3d47;border:1px solid #ede7e0;border-radius:5px;padding:.15em .45em;cursor:pointer;line-height:1;`;

  const gallery = sortedObjects.length
    ? orderNote + `<table style="border-collapse:collapse;width:100%;margin-bottom:2rem;">
        <thead><tr>
          ${filterArtist ? `<th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .5rem;border-bottom:2px solid #ede7e0;width:56px;"></th>` : ""}
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;width:72px;">Preview</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Filename</th>
          ${!filterArtist ? `<th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Artist</th>` : ""}
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Size</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Uploaded</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;"></th>
        </tr></thead>
        <tbody>
          ${sortedObjects.map((obj, idx) => {
            const imgUrl = `${publicBase}/${esc(obj.name)}`;
            const kbSize = obj.metadata?.size ? Math.round(obj.metadata.size / 1024) : null;
            const uploadedDate = obj.created_at ? obj.created_at.slice(0, 10) : "—";
            const objArtistId = obj.name.includes("/") ? obj.name.split("/")[0] : null;
            const artistName = objArtistId ? (artists.find((a) => a.id === objArtistId)?.name ?? objArtistId.slice(0, 8) + "…") : "—";
            const isFirst = idx === 0;
            const isLast = idx === sortedObjects.length - 1;
            const reorderBtns = filterArtist ? `
              <td style="padding:.5rem .5rem;white-space:nowrap;">
                <form method="POST" action="/api/admin/portfolio/reorder" style="display:inline;">
                  <input type="hidden" name="path" value="${esc(obj.name)}">
                  <input type="hidden" name="direction" value="up">
                  <input type="hidden" name="artist" value="${esc(filterArtist)}">
                  <button type="submit" ${isFirst ? "disabled" : ""} style="${btnStyle}${isFirst ? "opacity:.3;cursor:default;" : ""}">↑</button>
                </form>
                <form method="POST" action="/api/admin/portfolio/reorder" style="display:inline;margin-left:2px;">
                  <input type="hidden" name="path" value="${esc(obj.name)}">
                  <input type="hidden" name="direction" value="down">
                  <input type="hidden" name="artist" value="${esc(filterArtist)}">
                  <button type="submit" ${isLast ? "disabled" : ""} style="${btnStyle}${isLast ? "opacity:.3;cursor:default;" : ""}">↓</button>
                </form>
              </td>` : "";
            return `<tr style="border-bottom:1px solid #f3ede8;">
              ${reorderBtns}
              <td style="padding:.5rem .75rem;">
                <a href="${imgUrl}" target="_blank" rel="noopener">
                  <img src="${imgUrl}" alt="${esc(displayName(obj.name))}" loading="lazy"
                    style="width:56px;height:56px;object-fit:cover;border-radius:6px;display:block;border:1px solid #ede7e0;">
                </a>
              </td>
              <td style="padding:.5rem .75rem;font-size:.85rem;color:#3d2b38;font-weight:600;max-width:200px;word-break:break-all;">${esc(displayName(obj.name))}</td>
              ${!filterArtist ? `<td style="padding:.5rem .75rem;font-size:.82rem;color:#8a7d72;white-space:nowrap;">${esc(artistName)}</td>` : ""}
              <td style="padding:.5rem .75rem;font-size:.82rem;color:#8a7d72;white-space:nowrap;">${kbSize !== null ? `${kbSize} KB` : "—"}</td>
              <td style="padding:.5rem .75rem;font-size:.82rem;color:#8a7d72;white-space:nowrap;">${uploadedDate}</td>
              <td style="padding:.5rem .75rem;white-space:nowrap;">
                <form method="POST" action="/api/admin/portfolio/delete" style="display:inline;">
                  <input type="hidden" name="name" value="${esc(obj.name)}">
                  <input type="hidden" name="return_artist" value="${esc(filterArtist)}">
                  <button type="submit" onclick="return confirm('Delete this image?')"
                    style="font:inherit;font-size:.78rem;font-weight:600;color:#c53030;background:none;border:1px solid #f5c6c6;border-radius:6px;padding:.25em .7em;cursor:pointer;">
                    Delete
                  </button>
                </form>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`
    : `<p style="color:#8a7d72;font-style:italic;margin-bottom:1rem;">${filterArtist ? `No images yet for ${esc(activeArtist?.name ?? "this artist")}.` : "No images yet."}</p>`;

  const artistOptions = artists.map((a) =>
    `<option value="${esc(a.id)}"${a.id === filterArtist ? " selected" : ""}>${esc(a.name)}</option>`
  ).join("");

  const savedMsg = savedCount > 0
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">
        ✓ ${savedCount} image${savedCount !== 1 ? "s" : ""} uploaded${failedCount > 0 ? ` — ${failedCount} skipped (too large or wrong format)` : ""}.
       </div>`
    : "";
  const failedMsg = failedCount > 0 && savedCount === 0
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5c6c6;color:#c53030;font-size:.88rem;">⚠ ${failedCount} file${failedCount !== 1 ? "s" : ""} could not be uploaded — check size (max 10 MB) and format (JPEG, PNG, WebP, GIF).</div>`
    : "";

  const inner = `
    ${savedMsg}
    ${failedMsg}
    ${errorP && errorMessages[errorP] ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5c6c6;color:#c53030;font-size:.88rem;">⚠ ${esc(errorMessages[errorP])}</div>` : ""}

    ${filterTabs}
    ${gallery}

    <div style="background:#fff;border:1px solid #ede7e0;border-radius:10px;padding:1.2rem 1.4rem;max-width:520px;">
      <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.9rem;">Upload Images</div>
      <p style="font-size:.82rem;color:#8a7d72;margin:0 0 .9rem;">Select one or many · JPEG, PNG, WebP, GIF · Max 10 MB each</p>
      <form id="uploadForm" method="POST" action="/api/admin/portfolio" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:.75rem;">
        <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.82rem;font-weight:600;color:#5c3d47;">
          Artist
          <select name="artist_id" style="font:inherit;font-size:.88rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;">
            <option value="">— Unassigned —</option>
            ${artistOptions}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:.3rem;font-size:.82rem;font-weight:600;color:#5c3d47;">
          Image files
          <input id="imageInput" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required
            style="font:inherit;font-size:.88rem;">
          <span id="fileCount" style="font-size:.78rem;color:#8a7d72;min-height:1.2em;"></span>
        </label>
        <div style="display:flex;align-items:center;gap:1rem;">
          <button id="uploadBtn" type="submit"
            style="font:inherit;font-weight:700;font-size:.88rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.52em 1.3em;cursor:pointer;">
            Upload
          </button>
          <span id="uploadProgress" style="font-size:.82rem;color:#8a7d72;"></span>
        </div>
      </form>
    </div>
    <script>
      (function(){
        var form  = document.getElementById('uploadForm');
        var input = document.getElementById('imageInput');
        var btn   = document.getElementById('uploadBtn');
        var count = document.getElementById('fileCount');
        var prog  = document.getElementById('uploadProgress');
        if(!form || !input) return;

        input.addEventListener('change', function(){
          var n = this.files ? this.files.length : 0;
          count.textContent = n ? n + ' file' + (n !== 1 ? 's' : '') + ' selected' : '';
        });

        form.addEventListener('submit', async function(e){
          e.preventDefault();
          var files = Array.from(input.files || []);
          if(!files.length) return;
          var artistId = form.querySelector('[name="artist_id"]').value;
          btn.disabled = true;
          var ok = 0, fail = 0;
          for(var i = 0; i < files.length; i++){
            prog.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
            var fd = new FormData();
            fd.append('image', files[i]);
            fd.append('artist_id', artistId);
            try {
              var res = await fetch('/api/admin/portfolio?json=1', { method: 'POST', body: fd });
              var data = res.ok ? await res.json() : null;
              if(data && data.saved > 0) ok += data.saved; else fail++;
            } catch(err) { fail++; }
          }
          prog.textContent = ok + ' uploaded' + (fail ? ', ' + fail + ' failed' : '') + '. Reloading…';
          var qs = '?saved=' + ok + (fail ? '&failed=' + fail : '') + (artistId ? '&artist=' + encodeURIComponent(artistId) : '');
          setTimeout(function(){ window.location.href = '/api/admin/portfolio' + qs; }, 1000);
        });
      })();
    </script>
  `;

  const title = filterArtist && activeArtist
    ? `Portfolio — ${activeArtist.name} (${sortedObjects.length})`
    : `Portfolio (${sortedObjects.length} images)`;
  return htmlResponse(shell(title, user, inner, new URL(req.url).pathname));
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function handleAdminPortfolioDelete(
  req: Request,
  env: PortfolioEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  let name = "";
  let returnArtist = "";
  try {
    const fd = await req.formData();
    name = ((fd.get("name") as string | null) ?? "").trim();
    returnArtist = ((fd.get("return_artist") as string | null) ?? "").trim();
  } catch {
    return redirect("/api/admin/portfolio?error=delete-failed");
  }

  // Allow one optional artist-uuid prefix (e.g. "uuid/timestamp-file.jpg") but block traversal
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parts = name.split("/");
  const safe = parts.length <= 2 &&
    !name.includes("..") &&
    (parts.length === 1 || uuidRe.test(parts[0]));
  if (!name || !safe) {
    return redirect("/api/admin/portfolio");
  }

  const dHdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
  };

  await Promise.all([
    f(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: dHdr,
      body: JSON.stringify({ prefixes: [name] }),
    }),
    f(`${env.SUPABASE_URL}/rest/v1/portfolio_images?storage_path=eq.${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: dHdr,
    }),
  ]);

  const qs = returnArtist && uuidRe.test(returnArtist) ? `?artist=${encodeURIComponent(returnArtist)}` : "";
  return redirect(`/api/admin/portfolio${qs}`);
}

// ── Reorder ───────────────────────────────────────────────────────────────────

/** POST /api/admin/portfolio/reorder — swap position with adjacent item */
export async function handleAdminPortfolioReorder(
  req: Request,
  env: PortfolioEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const fd = await req.formData().catch(() => null);
  if (!fd) return redirect("/api/admin/portfolio");

  const path      = String(fd.get("path")      ?? "").trim();
  const direction = String(fd.get("direction") ?? "").trim();
  const artist    = String(fd.get("artist")    ?? "").trim();

  if (!path || (direction !== "up" && direction !== "down")) {
    return redirect("/api/admin/portfolio");
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };

  // Fetch all images for this artist ordered by position
  const listQs = artist && uuidRe.test(artist)
    ? `portfolio_images?artist_id=eq.${encodeURIComponent(artist)}&select=id,storage_path,position&order=position.asc`
    : `portfolio_images?artist_id=is.null&select=id,storage_path,position&order=position.asc`;

  const listRes = await f(`${env.SUPABASE_URL}/rest/v1/${listQs}`, { headers: hdr });
  const items: Array<{ id: string; storage_path: string; position: number }> = listRes.ok
    ? ((await listRes.json()) as Array<{ id: string; storage_path: string; position: number }>)
    : [];

  const idx = items.findIndex((it) => it.storage_path === path);
  if (idx === -1) return redirect(`/api/admin/portfolio${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`);

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) {
    return redirect(`/api/admin/portfolio${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`);
  }

  const current = items[idx]!;
  const adjacent = items[swapIdx]!;

  // Swap their position values
  await Promise.all([
    f(`${env.SUPABASE_URL}/rest/v1/portfolio_images?id=eq.${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      headers: hdr,
      body: JSON.stringify({ position: adjacent.position }),
    }),
    f(`${env.SUPABASE_URL}/rest/v1/portfolio_images?id=eq.${encodeURIComponent(adjacent.id)}`, {
      method: "PATCH",
      headers: hdr,
      body: JSON.stringify({ position: current.position }),
    }),
  ]);

  return redirect(`/api/admin/portfolio${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`);
}
