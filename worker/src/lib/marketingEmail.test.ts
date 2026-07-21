import { describe, it, expect } from "vitest";
import { marketingEmailHtml } from "./marketingEmail";

describe("marketingEmailHtml", () => {
  it("renders headline, paragraphs, and CTA", () => {
    const html = marketingEmailHtml({
      headline: "Now booking 2027",
      paragraphs: ["We have a few dates left.", "Reach out before they're gone."],
      ctaLabel: "Get your quote",
      ctaHref: "https://lustiqueco.co.za/quote.html",
    });
    expect(html).toContain("Now booking 2027");
    expect(html).toContain("We have a few dates left.");
    expect(html).toContain("Reach out before they");
    expect(html).toContain("Get your quote");
    expect(html).toContain("https://lustiqueco.co.za/quote.html");
    expect(html).toContain("Blessings,");
    expect(html).toContain("The Lustique Cosmetology Team");
  });

  it("escapes admin-entered text (no raw HTML injection from form fields)", () => {
    const html = marketingEmailHtml({
      headline: "<script>alert(1)</script>",
      paragraphs: ["<img src=x onerror=alert(1)>"],
      ctaLabel: "Go",
      ctaHref: "https://example.com",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("includes the optional highlight box when given", () => {
    const html = marketingEmailHtml({
      headline: "Off-peak offer",
      paragraphs: ["Marry in winter and save."],
      highlight: { label: "Save", value: "R1,000" },
      ctaLabel: "See pricing",
      ctaHref: "https://lustiqueco.co.za/pricing.html",
    });
    expect(html).toContain("Save");
    expect(html).toContain("R1,000");
  });

  it("omits the highlight box when not given", () => {
    const html = marketingEmailHtml({
      headline: "Simple note",
      paragraphs: ["Just checking in."],
      ctaLabel: "Visit",
      ctaHref: "https://lustiqueco.co.za",
    });
    expect(html).not.toContain('style="margin:0;font-size:10px');
  });

  it("includes the hero image when given", () => {
    const html = marketingEmailHtml({
      headline: "New looks",
      paragraphs: ["Check out our latest work."],
      ctaLabel: "View",
      ctaHref: "https://lustiqueco.co.za/portfolio.html",
      heroImage: "https://lustiqueco.co.za/assets/promo.jpg",
    });
    expect(html).toContain("https://lustiqueco.co.za/assets/promo.jpg");
  });

  it("appends the referenced promo's terms as a footnote", () => {
    const html = marketingEmailHtml({
      headline: "Weekday wonders",
      paragraphs: ["Say I do on a weekday."],
      ctaLabel: "Book now",
      ctaHref: "https://lustiqueco.co.za/quote.html",
      promoId: "weekday-wonders",
    });
    expect(html).toContain("destination weddings");
    expect(html.toLowerCase()).toContain("terms:");
  });

  it("omits the terms footnote when no promoId is given", () => {
    const html = marketingEmailHtml({
      headline: "Just a note",
      paragraphs: ["Hello."],
      ctaLabel: "Visit",
      ctaHref: "https://lustiqueco.co.za",
    });
    expect(html.toLowerCase()).not.toContain("terms:");
  });

  it("silently omits the footnote if an unknown promoId is passed (never throws on bad input)", () => {
    expect(() => marketingEmailHtml({
      headline: "x", paragraphs: ["y"], ctaLabel: "z", ctaHref: "https://a.com", promoId: "does-not-exist",
    })).not.toThrow();
  });
});
