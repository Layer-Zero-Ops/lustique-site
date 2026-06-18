import type { APIRoute } from "astro";

const SITE = "https://lustiqueco.co.za";
// Exclude: sample/transactional pages (your-quote, invoice, thank-you), error pages, booking-status pages.
const slugs = [
  "index.html", "about.html", "services.html", "team.html", "pricing.html", "portfolio.html",
  "faq.html", "guides.html", "contact.html", "quote.html", "terms.html", "privacy.html",
  "guide-skin-prep.html", "guide-timeline.html", "guide-artist.html",
  "blog.html", "blog-choosing-artist.html", "blog-bridal-trial.html", "blog-2026-trends.html",
];

const LASTMOD = "2026-06-18";

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${slugs
      .map((s) => `  <url><loc>${SITE}/${s === "index.html" ? "" : s}</loc><lastmod>${LASTMOD}</lastmod></url>`)
      .join("\n")}\n</urlset>`,
    { headers: { "Content-Type": "application/xml" } },
  );
