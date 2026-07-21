// Curated list of venues/photographers/planners Lustique genuinely recommends —
// a small, hand-picked list (not the full 300+ venue directory used for travel
// pricing in sa-wedding-venues.json). Zandeline adds/edits entries here directly;
// no admin UI for v1 since this changes rarely and the list stays short.

export type VendorCategory = "Venue" | "Photographer" | "Planner" | "Other";

export type RecommendedVendor = {
  name: string;
  category: VendorCategory;
  note: string;  // one line — why Lustique recommends them
  url: string;   // their website or Instagram
};

export const RECOMMENDED_VENDORS: RecommendedVendor[] = [
  // Populate with Zandeline's actual real partners before publishing —
  // deliberately left empty here since inventing placeholder vendor names
  // would be fabricated business content on a live page.
];
