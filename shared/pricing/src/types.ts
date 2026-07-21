export type HairLength = "short" | "medium" | "long" | "xlong";

/** A length distribution: how many heads need hair at each length. */
export type HairBuckets = Record<HairLength, number>;

export type Occasion =
  | "wedding" | "matric" | "event" | "editorial" | "engagement" | "corporate" | "pageant" | "lessons";

export type TravelBand = "studio" | "mid" | "far" | "veryfar" | "destination";

/**
 * A configurable promotion. Zandeline picks the *active* promo from the curated
 * library (`promoPresets.ts`) via the admin dashboard; the estimator and the quote
 * both apply whatever is active — never a hardcoded rule. A milestone tier's perk
 * fields are all optional — only set the ones that tier actually grants.
 */
export type Promo =
  | { kind: "none" }
  | { kind: "cheapestLookFree"; minPeople: number }
  | { kind: "flatCreditOnMinParty"; minPeople: number; amount: number }
  | {
      kind: "milestoneTiers";
      tiers: Array<{
        minPeople: number;
        freeLookPercent?: number; // 0-100 — % off the cheapest eligible look
        travelWaived?: boolean;   // waives travel entirely, any distance
        perkLabel?: string;       // informational only — no price effect (e.g. "Free touch-up kit")
      }>;
    }
  // Date-aware kinds read caller-derived facts (weddingDayOfWeek/weddingMonth/monthsUntilWedding)
  // on EstimateInput rather than calling Date.now() themselves, so computeEstimate stays pure.
  | { kind: "weekdayDiscount"; applyOnDays: number[]; amount: number; travelWaived?: boolean } // 0=Sun..6=Sat
  | { kind: "seasonalWindow"; startMonth: number; endMonth: number; amount: number } // 1-12, inclusive
  | { kind: "earlyBirdLeadTime"; minMonthsAhead: number; amount: number }
  | { kind: "bundledValueAdd"; minPeople: number; perkLabel: string }; // zero price effect — badge only

/** One itemised line of an estimate/quote — what contributes to the price. */
export interface EstimateLine {
  label: string;
  amount: number; // negative for discounts
}

export interface EstimateInput {
  occasion: Occasion;
  /** Whether the bride wants makeup / hair done at all — she may pick either, or both. */
  brideWantsMakeup: boolean;
  brideWantsHair: boolean;
  /** Whether her selected service(s) include a trial session, or wedding-day only. */
  brideWantsTrial: boolean;
  /** Only meaningful (and only priced) when brideWantsHair is true. */
  brideHairLen: HairLength;
  /**
   * Adult party hair (bridesmaids + mothers + guests) as a length distribution —
   * "of those needing hair, how many short / medium / long / x-long". Priced exactly,
   * independent of party size.
   */
  partyHair: HairBuckets;
  bmMakeup: number;  bmHair: number;
  momMakeup: number; momHair: number;
  /** Flower-girls under 12 keep the cheaper hair table AND are never the promo's free look. */
  fgAge: "under" | "over"; fgMakeup: number; fgHair: number; fgHairLen: HairLength;
  guestMakeup: number; guestHair: number;
  /**
   * Additional artist(s) the BRIDE requests for a tighter morning (R850 each). NOT auto-added —
   * the cost of the assistant for 5+/9+ parties is already included in the per-person prices.
   */
  requestedArtists: number;
  // Non-wedding events (matric/editorial/engagement/corporate/pageant) — simple face counts:
  evMakeup?: number; evHair?: number; evHairLen?: HairLength;
  // Group lessons (6+ attendees):
  lessonsAttending?: number;
  /** The promo to apply (the active one, or { kind: "none" } when off). */
  promo: Promo;
  /** Either a named band, or an exact override from the map-pin route. */
  travel: { band: TravelBand } | { cost: number; destination: boolean };
  /**
   * Wedding-date facts for date-aware promos — computed by the CALLER (from the
   * bride's chosen date) rather than read via Date.now() inside computeEstimate,
   * so the pricing function stays pure and deterministic for tests. Omit any/all
   * when no date has been chosen yet; those promo kinds simply won't apply.
   */
  weddingDayOfWeek?: number;   // 0=Sun..6=Sat
  weddingMonth?: number;       // 1-12
  monthsUntilWedding?: number; // floor'd whole months from "today" to the wedding date
}

export interface EstimateResult {
  total: number;
  heads: number;
  destination: boolean;
  occasion: Occasion;
  /** Itemised breakdown (bride, each role, travel, requested artists, promo discount). */
  lines: EstimateLine[];
  /** Zero-price-effect promo perks to badge/display (e.g. "Free touch-up kit included"). */
  perks: string[];
}
