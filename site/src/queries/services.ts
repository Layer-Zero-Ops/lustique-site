import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityService = {
  _id: string;
  title: string;
  category: "bridal" | "beyond-bridal";
  description: string;
  priceDisplay: string;
  image?: SanityImageObject;
  displayOrder: number;
  indicative?: boolean;
};

export const SERVICES_QUERY = `
  *[_type == "service"] | order(displayOrder asc) {
    _id,
    title,
    category,
    description,
    priceDisplay,
    "image": image { asset->, hotspot, crop },
    displayOrder,
    indicative
  }
` as const;
