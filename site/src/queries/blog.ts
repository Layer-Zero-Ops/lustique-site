import type { PortableTextBlock } from "@portabletext/types";

export type SanityBlogPost = {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  publishedAt?: string;
  _updatedAt?: string;
};

export type SanityBlogPostFull = SanityBlogPost & {
  body: PortableTextBlock[];
};

/** Blog index: all posts ordered newest-first. */
export const BLOG_INDEX_QUERY = `
  *[_type == "blogPost"] | order(coalesce(publishedAt, _createdAt) desc) {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    category,
    publishedAt,
    _updatedAt
  }
` as const;

/** Slugs + updatedAt — used by getStaticPaths and sitemap to enumerate blog post routes. */
export const BLOG_SLUGS_QUERY = `
  *[_type == "blogPost" && defined(slug.current)] {
    "slug": slug.current,
    _updatedAt
  }
` as const;

/** Single post by slug — includes full body Portable Text. */
export const BLOG_POST_QUERY = `
  *[_type == "blogPost" && slug.current == $slug][0] {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    category,
    publishedAt,
    _updatedAt,
    body[] {
      ...,
      markDefs[] {
        ...,
        _type == "link" => {
          "href": @.href,
          "blank": @.blank
        }
      }
    }
  }
` as const;
