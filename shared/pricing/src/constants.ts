import type { HairLength, Promo, TravelBand } from "./types";

type LenMap = Record<HairLength, number>;

// Component prices verbatim from PRICING.md §3 (reconciled against the 2026–2027 PDF).
// Travel bands are the map-fallback only; re-derived 2026-06-04 from PRICING.md §4
// (R7/km round-trip) at each range's midpoint one-way distance — the exact figure comes
// from the map-pin route (travelForKm) whenever geocoding succeeds.
export const PRICING = {
  // Bride's own tables (PRICING.md §3) — distinct from the party's hairAdult table below.
  // Trial and wedding-day sessions are priced identically, so a single "unit" price times
  // 1 (day only) or 2 (trial + day) covers both — the bride picks makeup, hair, both, and
  // whether to include the trial.
  brideMakeupUnit: 850,
  brideHairUnit: { short: 495, medium: 595, long: 695, xlong: 795 } as LenMap,
  makeup: { bridesmaid: 550, mother: 500, guest: 550, fgUnder: 250, fgOver: 500 },
  hairAdult: { short: 395, medium: 495, long: 595, xlong: 695 } as LenMap,
  hairFgUnder: { short: 200, medium: 250, long: 300, xlong: 400 } as LenMap,
  // studio: ≤40 km round trip free · mid: ~55 km → 770 · far: ~115 km → 1610 · veryfar: ~175 km → 2450 · destination: custom
  travel: { studio: 0, mid: 770, far: 1610, veryfar: 2450, destination: null } as Record<TravelBand, number | null>,
};

/**
 * Additional-artist rate (PRICING.md §3). NOT auto-added: for 5+/9+ parties the assistant cost is
 * already inside the per-person prices. Charged only when the bride requests extra artists for her
 * timeline — `requestedArtists × ASSISTANT_RATE`.
 */
export const ASSISTANT_RATE = 850;

/** The promo currently running (later CMS-driven by Zandeline). Swap this — never hardcode the rule. */
export const ACTIVE_PROMO: Promo = { kind: "cheapestLookFree", minPeople: 4 };

export const RATE_PER_KM = 7;
export const FREE_KM = 40;
export const DEST_KM = 200;

// Destination-wedding overnight artist accommodation (PRICING.md §4/§5) —
// R1000 per artist per night, client covers a minimum of 2 nights. This is
// used for the *indicative* destination estimate only (estimateDestinationExtras);
// computeEstimate() still zeroes travel and returns destination:true for the
// official quoted total, which stays a personally-confirmed number.
export const OVERNIGHT_RATE_PER_ARTIST = 1000;
export const DEST_MIN_NIGHTS = 2;

// Non-wedding per-face base prices (PRICING.md §6).
export const EVENT_BASE: Record<string, number> = {
  matric: 750, editorial: 750, engagement: 650, corporate: 650, pageant: 950, lessons: 600,
};

// Group lessons (PRICING.md §7): R700pp under 10 attendees, R600pp for 10+, minimum group of 6.
export const LESSONS = { perPersonUnder10: 700, perPerson10Plus: 600, threshold: 10, minGroup: 6 };
