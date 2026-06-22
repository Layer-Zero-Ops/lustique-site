import { createClient } from "@sanity/client";
import imageUrlBuilder from "@sanity/image-url";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";

/**
 * Read-only Sanity client for build-time content fetches.
 * All three env vars must be set in site/.env (local) and CF Pages build env vars (production).
 * Dataset is public — no token required.
 */
export const sanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID as string,
  dataset: (import.meta.env.SANITY_DATASET as string) ?? "production",
  apiVersion: (import.meta.env.SANITY_API_VERSION as string) ?? "2026-06-21",
  useCdn: true,
  perspective: "published",
});

const _builder = imageUrlBuilder(sanityClient);

/**
 * Returns an image URL builder for a Sanity image reference.
 * Example: urlFor(artist.photo).width(400).height(400).fit("crop").auto("format").url()
 */
export function urlFor(source: SanityImageSource) {
  return _builder.image(source);
}
