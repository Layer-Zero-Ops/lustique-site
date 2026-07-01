/* ============================================================
   Venue directory matching — pure functions, no DOM.
   Kept separate from estimator.ts so the matching logic (which
   directly affects the travel fee a bride is quoted) is testable
   in isolation.
   ============================================================ */

export type KnownVenue = {
  name: string;
  town: string | null;
  province: string | null;
  address: string | null;
  lat: number;
  lng: number;
  source: string;
  precision?: string;
  verified?: boolean;
};

// Words too common to carry identity — stripped before fuzzy comparison so
// "Avianto" or "Avianto Estate" still resolves to "Avianto Function Venue".
const SUFFIX_WORDS = /\b(wedding|function|conference|venue|and|the|estate|centre|center|events?|hall)\b/gi;

export function venueLabel(v: KnownVenue): string {
  return v.name + (v.town ? ` — ${v.town}` : "");
}

export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(SUFFIX_WORDS, "")
    .replace(/\s+/g, "")
    .trim();
}

// Cheap, dependency-free substring-overlap score in [0, 1]. Good enough for
// short venue names; a full edit-distance metric would be overkill here.
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.includes(shorter) ? shorter.length / longer.length : 0;
}

const MIN_FUZZY_LENGTH = 4;
const FUZZY_THRESHOLD = 0.8;

/**
 * Resolve free-typed venue text against the known-venue directory.
 * Tries an exact match first (datalist selection, or an exact type-out),
 * then falls back to a normalized fuzzy match so minor formatting
 * differences ("avianto", "Avianto Estate") still resolve — but only
 * above a high similarity bar, since a wrong silent match here means a
 * bride gets a travel quote for the wrong location.
 */
export function findKnownVenue(input: string, venues: KnownVenue[]): KnownVenue | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const trimmedLower = trimmed.toLowerCase();

  const exact = venues.find(
    (v) => venueLabel(v).toLowerCase() === trimmedLower || v.name.toLowerCase() === trimmedLower,
  );
  if (exact) return exact;

  const normInput = normalizeVenueName(trimmed);
  if (normInput.length < MIN_FUZZY_LENGTH) return undefined;

  let best: KnownVenue | undefined;
  let bestScore = 0;
  for (const v of venues) {
    const score = similarity(normInput, normalizeVenueName(v.name));
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return bestScore >= FUZZY_THRESHOLD ? best : undefined;
}
