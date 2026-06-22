export type SanityTestimonial = {
  _id: string;
  quote: string;
  attribution?: string;
  rating: number;
};

/**
 * Query-shaped type for the home GROQ projection.
 * The projection returns a nested object with `settings` and `testimonials` keys.
 * Access hero headline as: homeData.settings?.heroHeadline
 * NOT as: homeData.heroHeadline (flat access will not typecheck).
 */
export type SanityHomeSettingsQuery = {
  settings: { heroHeadline?: string; heroSubheadline?: string } | null;
  testimonials: SanityTestimonial[];
};

export const HOME_SETTINGS_QUERY = `
  {
    "settings": *[_type == "siteSettings"][0] {
      heroHeadline,
      heroSubheadline
    },
    "testimonials": *[_type == "testimonial" && featured == true] | order(_createdAt asc) {
      _id,
      quote,
      attribution,
      rating
    }
  }
` as const;
