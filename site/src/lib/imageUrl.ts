import { urlFor } from "./sanity";
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

/**
 * Pure function: derive the final img src string from either a legacy path
 * (under /assets/) or a Sanity image reference (CDN URL via @sanity/image-url).
 * Extracted from Photo.astro so it can be unit-tested without Astro rendering.
 */
export function resolvePhotoSrc(
  src: string | undefined,
  sanityImage: SanityImageObject | undefined,
  width = 800,
  height = 800
): string {
  if (sanityImage) {
    return urlFor(sanityImage)
      .width(width)
      .height(height)
      .fit("crop")
      .auto("format")
      .quality(85)
      .url();
  }
  if (src) {
    return `assets/${src}`;
  }
  throw new Error("resolvePhotoSrc requires either src or sanityImage");
}
