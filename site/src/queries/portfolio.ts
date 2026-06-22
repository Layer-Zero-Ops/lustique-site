import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityPortfolioImage = {
  _id: string;
  title: string;
  image: SanityImageObject;
  alt: string;
  category: "makeup" | "hair" | "party";
  artistId: string;
  displayOrder?: number;
};

export const PORTFOLIO_QUERY = `
  *[_type == "portfolioImage"] | order(coalesce(displayOrder, 999) asc) {
    _id,
    title,
    "image": image { asset->, hotspot, crop },
    alt,
    category,
    artistId,
    displayOrder
  }
` as const;
