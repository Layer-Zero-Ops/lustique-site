import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityTeamMember = {
  _id: string;
  name: string;
  slug: string;
  role: string;
  bio: string;
  photo?: SanityImageObject;
  displayOrder: number;
};

export const TEAM_QUERY = `
  *[_type == "teamMember"] | order(displayOrder asc) {
    _id,
    name,
    "slug": slug.current,
    role,
    bio,
    "photo": photo { asset->, hotspot, crop },
    displayOrder
  }
` as const;
