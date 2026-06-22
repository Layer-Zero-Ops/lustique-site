import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SANITY_PROJECT_ID", "testprojid");
vi.stubEnv("SANITY_DATASET", "production");
vi.stubEnv("SANITY_API_VERSION", "2026-06-21");

describe("resolvePhotoSrc", () => {
  it("uses assets/ prefix for legacy src string", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    expect(resolvePhotoSrc("hero.jpg", undefined)).toBe("assets/hero.jpg");
  });

  it("generates Sanity CDN URL for sanityImage", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    const asset: any = {
      _type: "image",
      asset: { _ref: "image-abc123xyz-400x400-jpg", _type: "reference" },
    };
    const url = resolvePhotoSrc(undefined, asset, 400, 400);
    expect(url).toContain("cdn.sanity.io");
    expect(url).toContain("testprojid");
    expect(url).toContain("w=400");
  });

  it("throws when neither src nor sanityImage provided", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    expect(() => resolvePhotoSrc(undefined, undefined)).toThrow(
      "resolvePhotoSrc requires either src or sanityImage"
    );
  });
});
