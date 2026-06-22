import { describe, it, expect } from "vitest";
import { TEAM_QUERY, type SanityTeamMember } from "./team";

describe("team query", () => {
  it("TEAM_QUERY targets teamMember type", () => {
    expect(TEAM_QUERY).toContain('"teamMember"');
    expect(TEAM_QUERY).toContain("slug.current");
    expect(TEAM_QUERY).toContain("displayOrder");
  });

  it("SanityTeamMember type has required fields", () => {
    const sample: SanityTeamMember = {
      _id: "t1",
      name: "Maroné",
      slug: "marone",
      role: "Bridal Artist",
      bio: "A warm and talented artist.",
      displayOrder: 7,
    };
    expect(sample.slug).toBe("marone");
    expect(sample.photo).toBeUndefined();
  });
});
