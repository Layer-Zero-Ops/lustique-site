import { describe, it, expect } from "vitest";
import { PORTFOLIO_QUERY, type SanityPortfolioImage } from "./portfolio";

describe("portfolio query", () => {
  it("query string targets portfolioImage type", () => {
    expect(PORTFOLIO_QUERY).toContain('"portfolioImage"');
    expect(PORTFOLIO_QUERY).toContain("artistId");
    expect(PORTFOLIO_QUERY).toContain("category");
    expect(PORTFOLIO_QUERY).toContain("asset->");
  });

  it("SanityPortfolioImage type shape is correct", () => {
    const sample: SanityPortfolioImage = {
      _id: "abc",
      title: "Test image",
      image: { asset: { _ref: "image-abc-jpg", _type: "reference" }, _type: "image" },
      alt: "Test alt",
      category: "makeup",
      artistId: "zandeline",
      displayOrder: 1,
    };
    expect(sample.artistId).toBe("zandeline");
    expect(sample.category).toBe("makeup");
  });
});
