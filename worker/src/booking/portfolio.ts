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
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
        ${objects.map((obj) => {
          const imgUrl = `${publicBase}/${esc(obj.name)}`;
          const kbSize = obj.metadata?.size ? Math.round(obj.metadata.size / 1024) : null;
          return `<div style="background:#fff;border:1px solid #ede7e0;border-radius:10px;overflow:hidden;position:relative;group;">
            <img src="${imgUrl}" alt="${esc(obj.name)}" loading="lazy"
              style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">
            <div style="padding:.5rem .6rem;">
              <div style="font-size:.72rem;color:#5c3d47;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(obj.name)}">${esc(obj.name)}</div>
              ${kbSize !== null ? `<div style="font-size:.68rem;color:#8a7d72;">${kbSize} KB</div>` : ""}
            </div>
            <form method="POST" action="/api/admin/portfolio/delete" style="padding:.0 .6rem .6rem;">
              <input type="hidden" name="name" value="${esc(obj.name)}">
              <button type="submit" onclick="return confirm('Delete this image?')"
                style="font:inherit;font-size:.72rem;font-weight:600;color:#c53030;background:none;border:1px solid #f5c6c6;border-radius:6px;padding:.2em .6em;cursor:pointer;width:100%;">
                Delete
              </button>
            </form>
          </div>`;
        }).join("")}
      </div>`
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
