export const SITE = "https://lustiqueco.co.za";
export const OG_IMG = SITE + "/assets/og-share.jpg";

// [label, href] — hrefs keep the .html suffix so internal links match the prototype
// (astro.config build.format: "file" emits /about.html etc.)
export const NAV: [string, string][] = [
  ["About", "about.html"], ["Services", "services.html"], ["The Team", "team.html"],
  ["Portfolio", "portfolio.html"], ["Pricing", "pricing.html"], ["Guides", "guides.html"], ["Journal", "blog.html"],
];

export const SITE_JSONLD = {
  "@context": "https://schema.org", "@type": "HealthAndBeautyBusiness",
  name: "Lustique Co.",
  description: "Bridal hair and makeup artistry in Pretoria — a team of nine artists serving Gauteng and beyond.",
  image: OG_IMG, "@id": SITE + "/", url: SITE + "/", telephone: "+27-67-925-3894", priceRange: "R500–R8000",
  address: { "@type": "PostalAddress", streetAddress: "242 Frangipani Street, La Montagne", addressLocality: "Pretoria", addressRegion: "Gauteng", postalCode: "0184", addressCountry: "ZA" },
  geo: { "@type": "GeoCoordinates", latitude: -25.8062, longitude: 28.2652 },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Tuesday","Wednesday","Thursday","Friday"], opens: "08:00", closes: "17:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "07:00", closes: "14:00" },
  ],
  areaServed: ["Gauteng", "Limpopo", "Mpumalanga", "North West"],
  founder: { "@type": "Person", name: "Zandeline Kemp" },
  sameAs: ["https://www.instagram.com/lustique_cosmetology/", "https://www.facebook.com/LustiqueCosmetology", "https://www.tiktok.com/@lustique_co"],
};

// GA4 Measurement ID — replace with real ID when GA4 property is created.
// Consent-gated: GA4 is NOT loaded until the visitor clicks Accept on the cookie banner.
export const GA_MEASUREMENT_ID = "G-XXXXXXXXXX";

// Cloudflare Turnstile site key — public (safe to commit).
// Dev/test: "1x00000000000000000000AA" (always passes). Replace with real key at deploy.
export const TURNSTILE_SITE_KEY = "0x4AAAAAADklnz5LQDyAFEKV";
