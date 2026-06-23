// worker/src/booking/blog.ts
// Blog management — Supabase blog_posts table (migration 0016).
//
// Admin routes (JWT-gated):
//   GET  /api/admin/blog                — list all posts
//   GET  /api/admin/blog/new            — new post form
//   POST /api/admin/blog/new            — create post
//   GET  /api/admin/blog/:id/edit       — edit form
//   POST /api/admin/blog/:id/edit       — save post
//   POST /api/admin/blog/:id/publish    — toggle published/draft
//   POST /api/admin/blog/:id/delete     — delete post (PRG)
//
// Public routes (no auth — served via index.ts):
//   GET  /api/blog                      — list published posts (JSON, for Astro)
//   GET  /api/blog/:slug                — single published post (JSON, for Astro)

import { getAdminSession } from "./auth";
import type { Env } from "../index";
import type { ShellFn } from "./enquiries";

export interface BlogEnv extends Env {
  SUPABASE_JWT_SECRET: string;
}

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

function jsonResponse(data: unknown, status = 200, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "cache-control": "public, max-age=300",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/** Convert plain text (double-newline paragraphs) to safe HTML for display. */
function renderBody(text: string): string {
  return text
    .split(/\n\n+/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Generate a URL-safe slug from a title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

// ── DB types ──────────────────────────────────────────────────────────────────

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_url: string | null;
  tags: string[];
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function supabaseHeaders(env: BlogEnv): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
  };
}

function restUrl(env: BlogEnv, path: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${path}`;
}

// ── Shared form HTML ──────────────────────────────────────────────────────────

function postForm(action: string, post?: BlogPost): string {
  const v = (field: keyof BlogPost, fallback = "") =>
    esc(String(post?.[field] ?? fallback));
  const excerptLen = (post?.excerpt ?? "").length;
  return `
    <form method="POST" action="${esc(action)}" id="post-form" style="max-width:800px;">
      <input type="hidden" name="publish" id="publish-flag" value="">
      <div style="margin-bottom:1.1rem;">
        <label style="display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.4rem;">Title *</label>
        <input name="title" type="text" required value="${v("title")}" maxlength="200"
          style="width:100%;font:inherit;font-size:1.05rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .7em;background:#faf7f4;"
          oninput="autoSlug(this.value)" placeholder="e.g. 5 Bridal Hair Trends for 2027">
      </div>
      <div style="margin-bottom:1.1rem;">
        <label style="display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.4rem;">Slug (URL path) *</label>
        <input id="slug-field" name="slug" type="text" required value="${v("slug")}" maxlength="100"
          pattern="[a-z0-9-]+" title="Lowercase letters, numbers and hyphens only"
          style="width:100%;font:inherit;font-size:.92rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;font-family:monospace;">
        <div style="font-size:.75rem;color:#8a7d72;margin-top:.3rem;">lustiqueco.co.za/blog/<span id="slug-preview">${v("slug")}</span></div>
      </div>
      <div style="margin-bottom:1.1rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.4rem;">
          <label style="display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;">Excerpt <span style="font-weight:400;text-transform:none;">(shown in blog list)</span></label>
          <span id="exc-count" style="font-size:.72rem;color:#8a7d72;">${excerptLen}/500</span>
        </div>
        <textarea name="excerpt" id="excerpt-field" rows="2" maxlength="500"
          oninput="document.getElementById('exc-count').textContent=this.value.length+'/500'"
          style="width:100%;font:inherit;font-size:.9rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.5em .7em;background:#faf7f4;resize:vertical;"
          placeholder="A short teaser readers see on the blog list page.">${v("excerpt")}</textarea>
      </div>
      <div style="margin-bottom:1.1rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.4rem;">
          <label style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;">Body * <span style="font-weight:400;text-transform:none;">(blank line = new paragraph)</span></label>
          <span id="word-count" style="font-size:.72rem;color:#8a7d72;"></span>
        </div>
        <textarea name="body" id="body-field" rows="24" required maxlength="50000"
          oninput="var w=this.value.trim().split(/\\s+/).filter(Boolean).length;document.getElementById('word-count').textContent=w+' word'+(w===1?'':'s');"
          style="width:100%;font:inherit;font-size:.92rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.6em .75em;background:#faf7f4;resize:vertical;line-height:1.75;">${v("body")}</textarea>
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem;">
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.4rem;">Cover image URL</label>
          <input name="cover_url" type="url" value="${v("cover_url")}" maxlength="500"
            style="width:100%;font:inherit;font-size:.88rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;"
            placeholder="https://…  (paste from Portfolio tab)">
        </div>
        <div style="flex:1;min-width:200px;">
          <label style="display:block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#8a7d72;margin-bottom:.4rem;">Tags (comma-separated)</label>
          <input name="tags" type="text" value="${esc((post?.tags ?? []).join(", "))}" maxlength="300"
            style="width:100%;font:inherit;font-size:.88rem;border:1.5px solid #c9bfb8;border-radius:8px;padding:.45em .7em;background:#faf7f4;"
            placeholder="bridal, tips, inspiration">
        </div>
      </div>
      <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;">
        <button type="submit" onclick="document.getElementById('publish-flag').value=''"
          style="font:inherit;font-weight:700;font-size:.9rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.55em 1.4em;cursor:pointer;">
          Save draft
        </button>
        <button type="submit" onclick="document.getElementById('publish-flag').value='1'"
          style="font:inherit;font-weight:700;font-size:.9rem;background:#276749;color:#fff;border:none;border-radius:8px;padding:.55em 1.4em;cursor:pointer;">
          Save &amp; publish
        </button>
        <a href="/api/admin/blog" style="color:#8a7d72;text-decoration:none;font-size:.88rem;">Cancel</a>
      </div>
    </form>
    <script>
    function autoSlug(title){
      if(document.getElementById('slug-field').dataset.edited)return;
      var slug=title.toLowerCase().replace(/[^a-z0-9\\s-]/g,'').trim().replace(/\\s+/g,'-').replace(/-+/g,'-').slice(0,80);
      document.getElementById('slug-field').value=slug;
      document.getElementById('slug-preview').textContent=slug;
    }
    document.getElementById('slug-field').addEventListener('input',function(){
      this.dataset.edited='1';
      document.getElementById('slug-preview').textContent=this.value;
    });
    (function(){var b=document.getElementById('body-field');if(b&&b.value){var w=b.value.trim().split(/\\s+/).filter(Boolean).length;document.getElementById('word-count').textContent=w+' word'+(w===1?'':'s');}})();
    </script>
  `;
}

// ── Admin handlers ────────────────────────────────────────────────────────────

/** GET /api/admin/blog — list all posts */
export async function handleAdminBlog(
  req: Request,
  env: BlogEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const res = await f(
    restUrl(env, "blog_posts?select=id,title,slug,published,published_at,created_at,updated_at&order=created_at.desc"),
    { headers: supabaseHeaders(env) },
  );
  const posts: BlogPost[] = res.ok ? ((await res.json()) as BlogPost[]) : [];

  const rows = posts.length
    ? posts.map((p) => {
        const pubBadge = p.published
          ? `<span style="display:inline-block;padding:.1em .5em;border-radius:20px;font-size:.72rem;font-weight:700;background:#edfcf2;color:#276749;">LIVE</span>`
          : `<span style="display:inline-block;padding:.1em .5em;border-radius:20px;font-size:.72rem;font-weight:700;background:#f7fafc;color:#718096;">Draft</span>`;
        return `<tr>
          <td><a class="row-link" href="/api/admin/blog/${esc(p.id)}/edit">${esc(p.title)}</a></td>
          <td style="font-size:.82rem;font-family:monospace;color:#5c3d47;">${esc(p.slug)}</td>
          <td>${pubBadge}</td>
          <td style="font-size:.82rem;">${fmtDate(p.published_at ?? p.created_at)}</td>
          <td>
            <form method="POST" action="/api/admin/blog/${esc(p.id)}/publish" style="display:inline;">
              <button type="submit" style="font:inherit;font-size:.78rem;font-weight:600;color:#8a3a52;background:none;border:1px solid #e0c8c8;border-radius:6px;padding:.2em .7em;cursor:pointer;margin-right:.4rem;">
                ${p.published ? "Unpublish" : "Publish"}
              </button>
            </form>
            <a href="/api/admin/blog/${esc(p.id)}/edit" style="font-size:.78rem;font-weight:600;color:#5c3d47;text-decoration:none;border:1px solid #ede7e0;border-radius:6px;padding:.2em .7em;margin-right:.4rem;">Edit</a>
            <form method="POST" action="/api/admin/blog/${esc(p.id)}/delete" style="display:inline;" onsubmit="return confirm('Delete this post permanently?')">
              <button type="submit" style="font:inherit;font-size:.78rem;font-weight:600;color:#c53030;background:none;border:1px solid #f5c6c6;border-radius:6px;padding:.2em .7em;cursor:pointer;">Delete</button>
            </form>
          </td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="5" class="empty">no posts yet — <a class="row-link" href="/api/admin/blog/new">write your first one</a> ✦</td></tr>`;

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";

  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ Post saved.</div>` : ""}
    <div style="margin-bottom:1.2rem;">
      <a href="/api/admin/blog/new"
        style="display:inline-block;font:inherit;font-weight:700;font-size:.88rem;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.5em 1.2em;cursor:pointer;text-decoration:none;">
        + New post
      </a>
    </div>
    <table>
      <thead><tr>
        <th>Title</th><th>Slug</th><th>Status</th><th>Date</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  return htmlResponse(shell("Blog", user, inner, new URL(req.url).pathname));
}

/** GET /api/admin/blog/new — new post form */
export async function handleAdminBlogNew(
  req: Request,
  env: BlogEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  if (req.method === "POST") {
    let title = "", slug = "", excerpt = "", body = "", coverUrl = "", tags = "", publish = "";
    try {
      const fd = await req.formData();
      title    = ((fd.get("title")     as string | null) ?? "").trim();
      slug     = ((fd.get("slug")      as string | null) ?? "").trim();
      excerpt  = ((fd.get("excerpt")   as string | null) ?? "").trim();
      body     = ((fd.get("body")      as string | null) ?? "").trim();
      coverUrl = ((fd.get("cover_url") as string | null) ?? "").trim();
      tags     = ((fd.get("tags")      as string | null) ?? "").trim();
      publish  = ((fd.get("publish")   as string | null) ?? "").trim();
    } catch {
      return htmlResponse(`<p>Invalid form. <a href="/api/admin/blog/new">Back</a></p>`, 400);
    }

    if (!title || !slug || !body) {
      return htmlResponse(shell("New post", user, `<p style="color:#c53030;">Title, slug and body are required.</p>${postForm("/api/admin/blog/new")}`, "/api/admin/blog/new"));
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return htmlResponse(shell("New post", user, `<p style="color:#c53030;">Slug may only contain lowercase letters, numbers and hyphens.</p>${postForm("/api/admin/blog/new")}`, "/api/admin/blog/new"));
    }

    const tagArr = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const publishNow = publish === "1";

    const insertRes = await f(restUrl(env, "blog_posts?select=id"), {
      method: "POST",
      headers: { ...supabaseHeaders(env), prefer: "return=representation" },
      body: JSON.stringify({
        title,
        slug: slugify(slug),
        excerpt: excerpt || null,
        body,
        cover_url: coverUrl || null,
        tags: tagArr,
        published: publishNow,
        published_at: publishNow ? new Date().toISOString() : null,
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      if (errText.includes("unique") || errText.includes("duplicate")) {
        return htmlResponse(shell("New post", user, `<p style="color:#c53030;">A post with that slug already exists — please choose a different slug.</p>${postForm("/api/admin/blog/new")}`, "/api/admin/blog/new"));
      }
      return htmlResponse(shell("New post", user, `<p style="color:#c53030;">Could not save post. Please try again.</p>${postForm("/api/admin/blog/new")}`, "/api/admin/blog/new"));
    }

    return redirect("/api/admin/blog?saved=1");
  }

  return htmlResponse(shell("New post", user, postForm("/api/admin/blog/new"), "/api/admin/blog/new"));
}

/** GET /api/admin/blog/:id/edit — edit form; POST — save */
export async function handleAdminBlogEdit(
  req: Request,
  env: BlogEnv,
  shell: ShellFn,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const getPost = async (): Promise<BlogPost | null> => {
    const r = await f(restUrl(env, `blog_posts?id=eq.${encodeURIComponent(id)}&select=*`), {
      headers: supabaseHeaders(env),
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as BlogPost[];
    return rows[0] ?? null;
  };

  if (req.method === "POST") {
    let title = "", slug = "", excerpt = "", body = "", coverUrl = "", tags = "", publish = "";
    try {
      const fd = await req.formData();
      title    = ((fd.get("title")     as string | null) ?? "").trim();
      slug     = ((fd.get("slug")      as string | null) ?? "").trim();
      excerpt  = ((fd.get("excerpt")   as string | null) ?? "").trim();
      body     = ((fd.get("body")      as string | null) ?? "").trim();
      coverUrl = ((fd.get("cover_url") as string | null) ?? "").trim();
      tags     = ((fd.get("tags")      as string | null) ?? "").trim();
      publish  = ((fd.get("publish")   as string | null) ?? "").trim();
    } catch {
      return htmlResponse(`<p>Invalid form.</p>`, 400);
    }

    if (!title || !slug || !body) {
      const post = await getPost();
      return htmlResponse(shell("Edit post", user, `<p style="color:#c53030;">Title, slug and body are required.</p>${postForm(`/api/admin/blog/${id}/edit`, post ?? undefined)}`, `/api/admin/blog/${id}/edit`));
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      const post = await getPost();
      return htmlResponse(shell("Edit post", user, `<p style="color:#c53030;">Slug: lowercase letters, numbers and hyphens only.</p>${postForm(`/api/admin/blog/${id}/edit`, post ?? undefined)}`, `/api/admin/blog/${id}/edit`));
    }

    const tagArr = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const publishNow = publish === "1";
    const existing = await getPost();
    const alreadyPublished = existing?.published ?? false;

    const patch: Record<string, unknown> = {
      title,
      slug: slugify(slug),
      excerpt: excerpt || null,
      body,
      cover_url: coverUrl || null,
      tags: tagArr,
      updated_at: new Date().toISOString(),
    };
    if (publishNow && !alreadyPublished) {
      patch.published = true;
      patch.published_at = new Date().toISOString();
    }

    await f(restUrl(env, `blog_posts?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { ...supabaseHeaders(env), prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });

    return redirect("/api/admin/blog?saved=1");
  }

  const post = await getPost();
  if (!post) return htmlResponse(`<p>Post not found. <a href="/api/admin/blog">Back</a></p>`, 404);

  const inner = `
    <div style="margin-bottom:1.2rem;display:flex;align-items:center;gap:.8rem;">
      <a href="/api/admin/blog" style="color:#8a7d72;text-decoration:none;font-size:.85rem;">← All posts</a>
      <span style="color:#c0a898;">|</span>
      <span style="font-size:.85rem;color:#5c3d47;">${post.published ? "🟢 Live" : "⚪ Draft"}</span>
    </div>
    ${postForm(`/api/admin/blog/${id}/edit`, post)}
  `;

  return htmlResponse(shell(`Edit: ${post.title}`, user, inner, new URL(req.url).pathname));
}

/** POST /api/admin/blog/:id/publish — toggle published */
export async function handleAdminBlogPublish(
  req: Request,
  env: BlogEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const getRes = await f(restUrl(env, `blog_posts?id=eq.${encodeURIComponent(id)}&select=published`), {
    headers: supabaseHeaders(env),
  });
  if (!getRes.ok) return redirect("/api/admin/blog");
  const rows = (await getRes.json()) as Array<{ published: boolean }>;
  const current = rows[0];
  if (!current) return redirect("/api/admin/blog");

  const nowPublished = !current.published;
  await f(restUrl(env, `blog_posts?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(env), prefer: "return=minimal" },
    body: JSON.stringify({
      published: nowPublished,
      published_at: nowPublished ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });

  return redirect("/api/admin/blog?saved=1");
}

/** POST /api/admin/blog/:id/delete — permanently delete */
export async function handleAdminBlogDelete(
  req: Request,
  env: BlogEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  await f(restUrl(env, `blog_posts?id=eq.${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: supabaseHeaders(env),
  });

  return redirect("/api/admin/blog");
}

// ── Public API (for Astro site) ───────────────────────────────────────────────

/** GET /api/blog — list published posts */
export async function handlePublicBlogList(
  env: Env,
  origin: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  const res = await f(
    `${env.SUPABASE_URL}/rest/v1/blog_posts` +
      `?published=eq.true&select=id,title,slug,excerpt,cover_url,tags,published_at&order=published_at.desc`,
    { headers: hdr },
  );
  if (!res.ok) return jsonResponse({ error: "failed" }, 500, origin);
  const posts = await res.json();
  return jsonResponse(posts, 200, origin);
}

/** GET /api/blog/:slug — single published post */
export async function handlePublicBlogPost(
  env: Env,
  slug: string,
  origin: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const hdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  const res = await f(
    `${env.SUPABASE_URL}/rest/v1/blog_posts` +
      `?published=eq.true&slug=eq.${encodeURIComponent(slug)}&select=*`,
    { headers: hdr },
  );
  if (!res.ok) return jsonResponse({ error: "failed" }, 500, origin);
  const rows = (await res.json()) as BlogPost[];
  if (!rows.length) return jsonResponse({ error: "not found" }, 404, origin);
  const post = rows[0]!;
  // Attach rendered HTML body for convenience
  return jsonResponse({ ...post, body_html: renderBody(post.body) }, 200, origin);
}
