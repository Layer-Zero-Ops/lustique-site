import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SANITY_PROJECT_ID", "testprojid");
vi.stubEnv("SANITY_DATASET", "production");
vi.stubEnv("SANITY_API_VERSION", "2026-06-21");

describe("sanity client wrapper", () => {
  it("creates a client with the injected project ID", async () => {
    const { sanityClient } = await import("./sanity");
    const config = sanityClient.config();
    expect(config.projectId).toBe("testprojid");
    expect(config.dataset).toBe("production");
    expect(config.apiVersion).toBe("2026-06-21");
    expect(config.useCdn).toBe(true);
  });

  it("urlFor returns a builder with a url() method", async () => {
    const { urlFor } = await import("./sanity");
    const builder = urlFor({ _type: "image", asset: { _ref: "image-abc123-200x200-jpg", _type: "reference" } });
    expect(typeof builder.url).toBe("function");
    const url = builder.width(200).url();
    expect(url).toContain("cdn.sanity.io");
    expect(url).toContain("testprojid");
  });
});
