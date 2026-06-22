import { describe, it, expect } from "vitest";
import { HOME_SETTINGS_QUERY, type SanityHomeSettingsQuery, type SanityTestimonial } from "./home";

describe("home query", () => {
  it("HOME_SETTINGS_QUERY fetches siteSettings and featured testimonials", () => {
    expect(HOME_SETTINGS_QUERY).toContain('"siteSettings"');
    expect(HOME_SETTINGS_QUERY).toContain('"testimonial"');
    expect(HOME_SETTINGS_QUERY).toContain("featured == true");
    expect(HOME_SETTINGS_QUERY).toContain("heroHeadline");
    expect(HOME_SETTINGS_QUERY).toContain("quote");
  });

  it("SanityHomeSettingsQuery has nested settings shape", () => {
    const sample: SanityHomeSettingsQuery = {
      settings: { heroHeadline: "Feel most like yourself.", heroSubheadline: "Sub text." },
      testimonials: [],
    };
    expect(sample.settings?.heroHeadline).toBe("Feel most like yourself.");
  });

  it("SanityHomeSettingsQuery settings can be null (before content is entered)", () => {
    const sample: SanityHomeSettingsQuery = { settings: null, testimonials: [] };
    expect(sample.settings?.heroHeadline).toBeUndefined();
  });

  it("SanityHomeSettingsQuery testimonials has correct shape", () => {
    const t: SanityTestimonial = {
      _id: "t1",
      quote: "They were wonderful.",
      attribution: "A Lustique Bride",
      rating: 5,
    };
    const sample: SanityHomeSettingsQuery = { settings: null, testimonials: [t] };
    expect(sample.testimonials[0].quote).toBe("They were wonderful.");
  });
});
