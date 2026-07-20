export const SITE = "https://lustiqueco.co.za";
export const OG_IMG = SITE + "/assets/og-share.jpg";

// Real bride testimonials, shown on the homepage. Also feeds the `review` schema below —
// keep the two in sync so the JSON-LD never claims more reviews than the page actually shows.
export const TESTIMONIALS = [
  {
    id: "t1",
    quote:
      "They felt less like a vendor and more like the calmest people in the room. I looked like me — just the version I always hoped to be on my wedding day.",
    attribution: "A Lustique Bride",
  },
  {
    id: "t2",
    quote:
      "My whole bridal party was ready, relaxed and glowing. Not one moment of stress all morning.",
    attribution: "A Lustique Bride",
  },
  {
    id: "t3",
    quote:
      "The trial sold me. They listened, adjusted, and on the day my makeup lasted from the first photo to the last dance.",
    attribution: "A Lustique Bride",
  },
];

// [label, href] — hrefs keep the .html suffix so internal links match the prototype
// (astro.config build.format: "file" emits /about.html etc.)
export const NAV: [string, string][] = [
  ["About", "about.html"], ["Services", "services.html"], ["The Team", "team.html"],
  ["Portfolio", "portfolio.html"], ["Pricing", "pricing.html"], ["Guides", "guides.html"], ["Journal", "blog.html"],
];

export const SITE_JSONLD = {
  "@context": "https://schema.org", "@type": ["HealthAndBeautyBusiness", "BeautySalon"],
  name: "Lustique Co.",
  description: "Bridal makeup artists and hair stylists in Pretoria — a team of nine specialists serving Gauteng and beyond since 2018.",
  image: OG_IMG, "@id": SITE + "/", url: SITE + "/", telephone: "+27-67-925-3894", priceRange: "R500–R8000",
  address: { "@type": "PostalAddress", streetAddress: "242 Frangipani Street, La Montagne", addressLocality: "Pretoria", addressRegion: "Gauteng", postalCode: "0184", addressCountry: "ZA" },
  geo: { "@type": "GeoCoordinates", latitude: -25.8062, longitude: 28.2652 },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Tuesday","Wednesday","Thursday","Friday"], opens: "08:00", closes: "17:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "07:00", closes: "14:00" },
  ],
  hasMap: "https://share.google/R6t6HICG43BFPqSLz",
  areaServed: [
    { "@type": "City", name: "Pretoria" },
    { "@type": "State", name: "Gauteng" },
    { "@type": "State", name: "Limpopo" },
    { "@type": "State", name: "Mpumalanga" },
    { "@type": "State", name: "North West" },
  ],
  knowsAbout: ["Bridal Makeup", "Bridal Hair Styling", "Wedding Beauty", "Airbrush Makeup", "Bridal Trials"],
  paymentAccepted: "Cash, EFT",
  currenciesAccepted: "ZAR",
  founder: { "@type": "Person", name: "Zandeline Kemp" },
  sameAs: ["https://www.instagram.com/lustique_cosmetology/", "https://www.facebook.com/LustiqueCosmetology", "https://www.tiktok.com/@lustique_co"],
  // Deliberately no `review`/`aggregateRating` here: the homepage testimonials are anonymised
  // ("A Lustique Bride") and self-hosted, not independently verifiable — adding review schema
  // for them would violate Google's self-serving-reviews guideline and risks a manual action
  // against rich results, not just a missed opportunity. Local-pack star ratings come from the
  // Google Business Profile's real reviews regardless of this file; that's the correct place to
  // earn them (see the SEO spec, Part B2). Revisit this once testimonials carry a real, named,
  // ideally third-party-linked source.
};

// GA4 Measurement ID — Lustique GA4 property (created 2026-07-17).
// Consent-gated: site.js only loads gtag.js after the visitor clicks Accept
// on the cookie banner (POPIA). Placeholder-skip guard in site.js stays as a
// safety net should this ever be reset to G-XXXXXXXXXX.
export const GA_MEASUREMENT_ID = "G-VVNWW17TER";

// Cloudflare Turnstile site key — public (safe to commit).
// Dev/test: "1x00000000000000000000AA" (always passes). Replace with real key at deploy.
export const TURNSTILE_SITE_KEY = "0x4AAAAAADklnz5LQDyAFEKV";
