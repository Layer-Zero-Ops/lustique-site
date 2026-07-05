// Fetches real Google Business Profile reviews via the Places API (New), at BUILD time only
// (called from page frontmatter, never client-side) — so request volume tracks deploys, not
// visitors, and stays well inside Google's free monthly credit. See SETUP.md for how to get
// GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID.
//
// Returns null when not configured or the request fails — callers must fall back to the
// existing static testimonials rather than break the build on a missing/expired key.

const API_KEY = import.meta.env.GOOGLE_PLACES_API_KEY as string | undefined;
const PLACE_ID = import.meta.env.GOOGLE_PLACE_ID as string | undefined;

export type GoogleReview = {
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number;
  text: string;
  publishTime: string;
  relativeTime: string;
};

export type GooglePlaceReviews = {
  rating: number;
  userRatingCount: number;
  reviews: GoogleReview[];
};

export async function fetchGoogleReviews(): Promise<GooglePlaceReviews | null> {
  if (!API_KEY || !PLACE_ID) return null;

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}`, {
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "rating,userRatingCount,reviews",
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (typeof data.rating !== "number") return null;

    const reviews: GoogleReview[] = (data.reviews ?? []).map((r: any) => ({
      authorName: r.authorAttribution?.displayName ?? "A Google reviewer",
      authorPhotoUrl: r.authorAttribution?.photoUri ?? null,
      rating: r.rating,
      text: r.text?.text ?? r.originalText?.text ?? "",
      publishTime: r.publishTime,
      relativeTime: r.relativePublishTimeDescription ?? "",
    })).filter((r: GoogleReview) => r.text.trim().length > 0);

    return { rating: data.rating, userRatingCount: data.userRatingCount ?? reviews.length, reviews };
  } catch {
    return null;
  }
}
