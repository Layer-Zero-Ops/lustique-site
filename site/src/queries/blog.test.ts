import { describe, it, expect } from "vitest";
import {
  BLOG_INDEX_QUERY,
  BLOG_SLUGS_QUERY,
  BLOG_POST_QUERY,
  type SanityBlogPost,
} from "./blog";

describe("blog queries", () => {
  it("BLOG_INDEX_QUERY targets blogPost type and orders by publishedAt", () => {
    expect(BLOG_INDEX_QUERY).toContain('"blogPost"');
    expect(BLOG_INDEX_QUERY).toContain("publishedAt");
    expect(BLOG_INDEX_QUERY).toContain("excerpt");
  });

  it("BLOG_SLUGS_QUERY fetches slugs and _updatedAt", () => {
    expect(BLOG_SLUGS_QUERY).toContain('"blogPost"');
    expect(BLOG_SLUGS_QUERY).toContain("slug.current");
    expect(BLOG_SLUGS_QUERY).toContain("_updatedAt");
  });

  it("BLOG_POST_QUERY fetches by $slug param and includes body", () => {
    expect(BLOG_POST_QUERY).toContain("$slug");
    expect(BLOG_POST_QUERY).toContain("body");
    expect(BLOG_POST_QUERY).toContain("[0]");
  });

  it("SanityBlogPost type has required fields", () => {
    const sample: SanityBlogPost = {
      _id: "abc",
      title: "Test post",
      slug: "test-post",
      excerpt: "Short excerpt",
      category: "Guide",
    };
    expect(sample.slug).toBe("test-post");
  });
});
