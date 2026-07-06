import type { APIRoute } from "astro";
import { supabaseGet } from "../lib/supabase";

const SITE = "https://lustiqueco.co.za";

const staticSlugs = [
  "index.html", "about.html", "services.html", "team.html", "pricing.html", "portfolio.html",
  "faq.html", "guides.html", "contact.html", "quote.html", "terms.html", "privacy.html",
  "guide-skin-prep.html", "guide-timeline.html", "guide-artist.html",
  "blog.html",
  // Real, live blog content — not yet migrated to the blog_posts/[slug] CMS system (that table
  // is currently empty), so these static pages are the actual URLs to index. See public/_redirects.
  "blog-choosing-artist.html", "blog-bridal-trial.html", "blog-2026-trends.html",
];

export const GET: APIRoute = async () => {
  // Static pages carry no <lastmod> — we don't track their real change dates, and a fake
  // constant is worse than omitting the tag (it teaches crawlers to distrust it).
  // Blog posts DO have a real updated_at from the CMS, so they get an honest lastmod.
  type BlogSlug = { slug: string; updated_at: string };
  let blogEntries: { slug: string; lastmod: string | null }[] = [];
  try {
    const posts = await supabaseGet<BlogSlug>(
      "blog_posts?select=slug,updated_at&published=eq.true"
    );
    blogEntries = posts.map((p) => ({
      slug: `blog/${p.slug}.html`,
      lastmod: p.updated_at ? p.updated_at.slice(0, 10) : null,
    }));
  } catch {
    blogEntries = [];
  }

  const staticEntries = staticSlugs.map((s) => ({ slug: s, lastmod: null as string | null }));
  const allEntries = [...staticEntries, ...blogEntries];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allEntries
    .map((e) => `  <url><loc>${SITE}/${e.slug === "index.html" ? "" : e.slug}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>`;

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
