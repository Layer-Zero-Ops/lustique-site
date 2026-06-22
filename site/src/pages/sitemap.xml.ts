import type { APIRoute } from "astro";
import { sanityClient } from "../lib/sanity";
import { BLOG_SLUGS_QUERY } from "../queries/blog";

const SITE = "https://lustiqueco.co.za";

const staticSlugs = [
  "index.html", "about.html", "services.html", "team.html", "pricing.html", "portfolio.html",
  "faq.html", "guides.html", "contact.html", "quote.html", "terms.html", "privacy.html",
  "guide-skin-prep.html", "guide-timeline.html", "guide-artist.html",
  "blog.html",
];

const STATIC_LASTMOD = "2026-06-21";

export const GET: APIRoute = async () => {
  let blogEntries: { slug: string; lastmod: string }[] = [];
  try {
    const posts = await sanityClient.fetch<{ slug: string; _updatedAt?: string }[]>(BLOG_SLUGS_QUERY);
    blogEntries = posts.map((p) => ({
      slug: `blog/${p.slug}.html`,
      lastmod: p._updatedAt ? p._updatedAt.slice(0, 10) : STATIC_LASTMOD,
    }));
  } catch {
    blogEntries = [];
  }

  const staticEntries = staticSlugs.map((s) => ({ slug: s, lastmod: STATIC_LASTMOD }));
  const allEntries = [...staticEntries, ...blogEntries];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allEntries
    .map((e) => `  <url><loc>${SITE}/${e.slug === "index.html" ? "" : e.slug}</loc><lastmod>${e.lastmod}</lastmod></url>`)
    .join("\n")}\n</urlset>`;

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
