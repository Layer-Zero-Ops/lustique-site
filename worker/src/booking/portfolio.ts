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

const BUCKET = "portfolio";

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

  // POST — upload a new image
  if (req.method === "POST") {
    let file: File | null = null;
    try {
      const fd = await req.formData();
      file = fd.get("image") as File | null;
    } catch {
      return htmlResponse(`<p>Could not read upload. <a href="/api/admin/portfolio">Back</a></p>`, 400);
    }
    if (!file || file.size === 0) {
      return redirect("/api/admin/portfolio?error=no-file");
    }
    if (file.size > 10 * 1024 * 1024) {
      return redirect("/api/admin/portfolio?error=too-large");
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      return redirect("/api/admin/portfolio?error=bad-type");
    }

    // Sanitise filename: strip path traversal, collapse spaces, lowercase
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
    const uniqueName = `${Date.now()}-${safeName}`;

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

    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => "unknown");
      if (err.includes("already exists")) return redirect("/api/admin/portfolio?error=exists");
      return redirect("/api/admin/portfolio?error=upload-failed");
    }

    return redirect("/api/admin/portfolio?saved=1");
  }

  // GET — list images
  const listRes = await f(
    `${env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 200, offset: 0, sortBy: { column: "created_at", order: "desc" } }),
    },
  );
  const objects: StorageObject[] = listRes.ok ? ((await listRes.json()) as StorageObject[]) : [];

  const url = new URL(req.url);
  const saved  = url.searchParams.get("saved")  === "1";
  const errorP = url.searchParams.get("error");

  const errorMessages: Record<string, string> = {
    "no-file":       "No file selected — please choose an image.",
    "too-large":     "File too large — maximum 10 MB.",
    "bad-type":      "Unsupported format — use JPEG, PNG, WebP or GIF.",
    "exists":        "A file with that name already exists.",
    "upload-failed": "Upload failed — please try again.",
  };

  const publicBase = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

  const gallery = objects.length
    ? `<table style="border-collapse:collapse;width:100%;margin-bottom:2rem;">
        <thead><tr>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;width:72px;">Preview</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Filename</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Size</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Uploaded</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;text-align:left;">Public URL</th>
          <th style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8a7d72;padding:.5rem .75rem;border-bottom:2px solid #ede7e0;"></th>
        </tr></thead>
        <tbody>
          ${objects.map((obj) => {
            const imgUrl = `${publicBase}/${esc(obj.name)}`;
            const kbSize = obj.metadata?.size ? Math.round(obj.metadata.size / 1024) : null;
            const uploadedDate = obj.created_at ? obj.created_at.slice(0, 10) : "—";
            return `<tr style="border-bottom:1px solid #f3ede8;">
              <td style="padding:.5rem .75rem;">
                <a href="${imgUrl}" target="_blank" rel="noopener">
                  <img src="${imgUrl}" alt="${esc(obj.name)}" loading="lazy"
                    style="width:56px;height:56px;object-fit:cover;border-radius:6px;display:block;border:1px solid #ede7e0;">
                </a>
              </td>
              <td style="padding:.5rem .75rem;font-size:.85rem;color:#3d2b38;font-weight:600;max-width:220px;word-break:break-all;">${esc(obj.name)}</td>
              <td style="padding:.5rem .75rem;font-size:.82rem;color:#8a7d72;white-space:nowrap;">${kbSize !== null ? `${kbSize} KB` : "—"}</td>
              <td style="padding:.5rem .75rem;font-size:.82rem;color:#8a7d72;white-space:nowrap;">${uploadedDate}</td>
              <td style="padding:.5rem .75rem;max-width:260px;">
                <input type="text" value="${imgUrl}" readonly onclick="this.select()"
                  style="width:100%;font:inherit;font-size:.75rem;font-family:monospace;border:1px solid #ede7e0;border-radius:6px;padding:.3em .5em;background:#f7f3ef;color:#5c3d47;cursor:pointer;" title="Click to select URL">
              </td>
              <td style="padding:.5rem .75rem;white-space:nowrap;">
                <form method="POST" action="/api/admin/portfolio/delete" style="display:inline;">
                  <input type="hidden" name="name" value="${esc(obj.name)}">
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
    : `<p style="color:#8a7d72;font-style:italic;margin-bottom:2rem;">No images yet — upload your first one below.</p>`;

  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ Image uploaded.</div>` : ""}
    ${errorP && errorMessages[errorP] ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5c6c6;color:#c53030;font-size:.88rem;">⚠ ${esc(errorMessages[errorP])}</div>` : ""}

    ${gallery}

    <div style="background:#fff;border:1px solid #ede7e0;border-radius:10px;padding:1.2rem 1.4rem;max-width:480px;">
      <div style="font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.9rem;">Upload Image</div>
      <p style="font-size:.82rem;color:#8a7d72;margin:0 0 .9rem;">Accepted: JPEG, PNG, WebP, GIF · Max 10 MB</p>
      <form method="POST" action="/api/admin/portfolio" enctype="multipart/form-data">
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required
          style="display:block;margin-bottom:.8rem;font:inherit;font-size:.88rem;">
        <button type="submit"
          style="font:inherit;font-weight:700;font-size:.88rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.52em 1.3em;cursor:pointer;">
          Upload
        </button>
      </form>
    </div>
  `;

  return htmlResponse(shell(`Portfolio (${objects.length} images)`, user, inner, new URL(req.url).pathname));
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
  try {
    const fd = await req.formData();
    name = ((fd.get("name") as string | null) ?? "").trim();
  } catch {
    return redirect("/api/admin/portfolio?error=delete-failed");
  }

  if (!name || name.includes("..") || name.includes("/")) {
    return redirect("/api/admin/portfolio");
  }

  await f(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: [name] }),
  });

  return redirect("/api/admin/portfolio?saved=1");
}
