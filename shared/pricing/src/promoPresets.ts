import type { Promo } from "./types";

/**
 * The curated promo library (PRICING.md §4 promo review, 2026-07-01). Zandeline
 * picks up to 5 of these into her active library from the admin dashboard, and
 * one of those 5 (or none) is "live" on the estimator at a time — never a
 * hardcoded rule, and never more than one live rule at once (they don't stack).
 *
 * `appliesToLiveEstimate: false` presets don't touch computeEstimate at all —
 * they depend on real-world verification (a second booking, a repeat client)
 * that the live estimator can't know about. Those are applied manually by
 * Zandeline at invoicing time; the dashboard/site only carry the marketing copy.
 *
 * `requiresSetup` flags a preset that isn't launch-ready as-is — it depends on a
 * real pricing decision Zandeline hasn't made yet (e.g. a genuine VIP tier price),
 * so activating it without that groundwork would risk a false reference-price claim.
 */
export interface PromoPreset {
  id: string;
  name: string;
  tagline: string; // bride-facing marketing line
  mechanic: string; // plain-English explanation of what it actually does, for Zandeline
  promo: Promo;
  appliesToLiveEstimate: boolean;
  manualNote?: string; // how Zandeline applies it when appliesToLiveEstimate is false
  requiresSetup?: string;
}

export const PROMO_PRESETS: PromoPreset[] = [
  {
    id: "cheapest-look-free",
    name: "Least-Expensive Look, On Us",
    tagline: "Book hair & makeup for 4 or more and the least-expensive look in your party is completely free.",
    mechanic: "Book 4+ full looks (hair+makeup) and the cheapest one is free. Never the bride, never an under-12 flower girl.",
    promo: { kind: "cheapestLookFree", minPeople: 4 },
    appliesToLiveEstimate: true,
  },
  {
    id: "flat-1000-off",
    name: "R1,000 Off Your Big Day",
    tagline: "Book 5+ looks and take R1,000 straight off your total.",
    mechanic: "A flat, predictable rand credit instead of a party-composition-dependent discount — easier to budget for on your side, and capped exposure per booking on Zandeline's.",
    promo: { kind: "flatCreditOnMinParty", minPeople: 5, amount: 1000 },
    appliesToLiveEstimate: true,
  },
  {
    id: "glam-squad-milestones",
    name: "Glam Squad Milestones",
    tagline: "The bigger your glam squad, the more you get — free look at 4+, a free touch-up kit at 7+, and free travel at 9+.",
    mechanic: "Escalating perks reward bigger bookings: 4+ frees the cheapest look, 7+ adds a bundled touch-up kit, 9+ waives travel entirely — each funded by the extra heads' own revenue.",
    promo: {
      kind: "milestoneTiers",
      tiers: [
        { minPeople: 4, freeLookPercent: 100 },
        { minPeople: 7, perkLabel: "Complimentary touch-up kit" },
        { minPeople: 9, travelWaived: true },
      ],
    },
    appliesToLiveEstimate: true,
  },
  {
    id: "weekday-wonders",
    name: "Weekday Wonders",
    tagline: "Say \"I do\" on a weekday and travel is on us, plus R500 off.",
    mechanic: "Fills genuinely lower-demand weekday dates (Mon-Fri) at low opportunity cost — travel waived + a flat R500 off, only when the chosen wedding date isn't a Saturday.",
    promo: { kind: "weekdayDiscount", applyOnDays: [1, 2, 3, 4, 5], amount: 500, travelWaived: true },
    appliesToLiveEstimate: true,
  },
  {
    id: "off-peak-season",
    name: "Off-Peak Wedding Rate",
    tagline: "Marry in winter (June–August) and save R1,000.",
    mechanic: "Standard demand-based event-industry pricing for genuinely lower-demand months — a real, defensible discount off the real price for that time of year, not a fabricated reference price.",
    promo: { kind: "seasonalWindow", startMonth: 6, endMonth: 8, amount: 1000 },
    appliesToLiveEstimate: true,
  },
  {
    id: "early-bird-bonus",
    name: "Early Bird Booking Bonus",
    tagline: "Lock in your date 6+ months out and get R750 off your balance.",
    mechanic: "Rewards early commitment — locks the date sooner, improves cash-flow predictability, and reduces late-cancellation risk. A legitimate incentive, not a discount off an inflated number.",
    promo: { kind: "earlyBirdLeadTime", minMonthsAhead: 6, amount: 750 },
    appliesToLiveEstimate: true,
  },
  {
    id: "touch-up-kit-treat",
    name: "Touch-Up Kit, Our Treat",
    tagline: "Book 4+ looks and we'll include a complimentary touch-up kit — lip, blot papers, mini spray — on the house.",
    mechanic: "Zero price change, zero legal risk — nothing is 'discounted', it's simply included. Low marginal cost to Zandeline, high perceived value to the bride.",
    promo: { kind: "bundledValueAdd", minPeople: 4, perkLabel: "Complimentary touch-up kit included" },
    appliesToLiveEstimate: true,
  },
  {
    id: "vip-bridal-upgrade",
    name: "VIP Bridal Upgrade Bundle",
    tagline: "Add the VIP Bridal Experience for your 4+ party and save on the upgrade.",
    mechanic: "A genuinely new, separately-priced tier (extra artist buffer time, premium product upgrade) with a real bundle discount for 4+ parties. Legitimate reference pricing since the VIP tier is a real, standalone price point — NOT a markdown off the core service.",
    promo: { kind: "bundledValueAdd", minPeople: 4, perkLabel: "VIP Bridal Experience upgrade discount" },
    appliesToLiveEstimate: true,
    requiresSetup: "Requires Zandeline to define the VIP tier's real inclusions and price first — do not activate until that pricing exists, or the 'save on the upgrade' claim has nothing real to reference.",
  },
  {
    id: "bring-your-bestie",
    name: "Bring Your Bestie",
    tagline: "Refer a friend who books Lustique and you BOTH get R500 off.",
    mechanic: "Viral referral loop — the R500-per-side cost comes out of the margin on a booking that wouldn't have existed otherwise, so it's a strongly positive trade, not a giveaway.",
    promo: { kind: "none" },
    appliesToLiveEstimate: false,
    manualNote: "Not shown on the live estimator — depends on verifying a second, real booking. Apply the R500 credit manually on both brides' invoices once the referred wedding's deposit is paid.",
  },
  {
    id: "welcome-back-loyalty",
    name: "Welcome Back Loyalty",
    tagline: "Booked with us before? Welcome back — R500 off your wedding package.",
    mechanic: "Rewards repeat clients (e.g. a past matric-farewell or event client now booking her wedding) — retention-focused, low cost relative to the value of a client relationship that already exists.",
    promo: { kind: "none" },
    appliesToLiveEstimate: false,
    manualNote: "Not shown on the live estimator — depends on recognising a returning client. Apply the R500 credit manually once Zandeline confirms the bride's prior booking history.",
  },
];

export function getPromoPreset(id: string): PromoPreset | undefined {
  return PROMO_PRESETS.find((p) => p.id === id);
}
