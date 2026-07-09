import { PRICING, RATE_PER_KM, FREE_KM, EVENT_BASE, LESSONS, ASSISTANT_RATE, OVERNIGHT_RATE_PER_ARTIST, DEST_MIN_NIGHTS } from "./constants";
import type { EstimateInput, EstimateResult, EstimateLine, HairBuckets, HairLength, Promo } from "./types";

const LENGTHS: readonly HairLength[] = ["short", "medium", "long", "xlong"];
const LEN_LABEL: Record<HairLength, string> = { short: "short", medium: "medium", long: "long", xlong: "x-long" };

/** Round-trip travel cost: free when the ROUND TRIP is within FREE_KM, else full round-trip × R7. */
export const travelForKm = (km: number): number => {
  const roundTrip = km * 2;
  return roundTrip <= FREE_KM ? 0 : Math.round(roundTrip * RATE_PER_KM);
};

/**
 * Indicative-only figures for a destination wedding (>200km one-way) — NOT the
 * official quoted total, which computeEstimate() always zeroes and flags
 * `destination: true` for so it stays a personally-confirmed number (PRICING.md
 * §4: the R7/km round-trip vs one-way reading, and how many artists actually
 * travel, are still open items worth Zandeline's confirmation for this segment).
 * Both figures below use rates already locked elsewhere in this file:
 * the same round-trip travel formula as travelForKm, and the R1000/artist/night
 * (min 2 nights) overnight rate from PRICING.md §4/§5. `heads` reuses the same
 * party-size tiers that already gate the included-assistant count.
 */
export function estimateDestinationExtras(
  kmOneWay: number,
  heads: number,
): { travelEstimate: number; artists: number; accommodationEstimate: number } {
  const travelEstimate = Math.round(kmOneWay * 2 * RATE_PER_KM);
  const artists = heads >= 9 ? 3 : heads >= 5 ? 2 : 1;
  const accommodationEstimate = artists * OVERNIGHT_RATE_PER_ARTIST * DEST_MIN_NIGHTS;
  return { travelEstimate, artists, accommodationEstimate };
}

/** Flatten a length distribution into an ordered list (short→x-long), one entry per head. */
function expandBuckets(b: HairBuckets): HairLength[] {
  const out: HairLength[] = [];
  for (const len of LENGTHS) for (let i = 0; i < Math.max(0, b[len]); i++) out.push(len);
  return out;
}

function resolveTravel(t: EstimateInput["travel"]): { cost: number; destination: boolean } {
  if ("cost" in t) return { cost: t.destination ? 0 : t.cost, destination: t.destination };
  const band = PRICING.travel[t.band];
  return { cost: band === null ? 0 : band, destination: band === null };
}

interface PromoContext {
  paidCount: number;          // looks booked, incl. the bride — the "N+" thresholds count against this
  freebieCandidates: number[]; // look costs eligible to be comped (never the bride, never an under-12 FG)
  weddingDayOfWeek?: number;
  weddingMonth?: number;
  monthsUntilWedding?: number;
}

interface PromoEffect {
  lines: EstimateLine[]; // discount lines (negative amounts) — appended to the breakdown
  perks: string[];       // zero-price-effect badges (e.g. "Free touch-up kit included")
  travelWaived: boolean; // true = skip the travel line entirely (any distance band)
}

const NO_EFFECT: PromoEffect = { lines: [], perks: [], travelWaived: false };

/**
 * Evaluate whichever promo is active against this booking. Each kind is one of the
 * curated presets in `promoPresets.ts` — Zandeline picks which is live from the
 * admin dashboard; this function just applies whatever config it's handed.
 */
function evaluatePromo(promo: Promo, ctx: PromoContext): PromoEffect {
  switch (promo.kind) {
    case "none":
      return NO_EFFECT;

    case "cheapestLookFree": {
      if (ctx.paidCount < promo.minPeople || !ctx.freebieCandidates.length) return NO_EFFECT;
      return { lines: [{ label: "Promo — cheapest look free", amount: -Math.min(...ctx.freebieCandidates) }], perks: [], travelWaived: false };
    }

    case "flatCreditOnMinParty": {
      if (ctx.paidCount < promo.minPeople) return NO_EFFECT;
      return { lines: [{ label: `Promo — R${promo.amount} off your booking`, amount: -promo.amount }], perks: [], travelWaived: false };
    }

    case "milestoneTiers": {
      const qualifying = promo.tiers
        .filter((t) => ctx.paidCount >= t.minPeople)
        .sort((a, b) => a.minPeople - b.minPeople);
      if (!qualifying.length) return NO_EFFECT;
      const lines: EstimateLine[] = [];
      const perks: string[] = [];
      let travelWaived = false;
      // Perks are cumulative once a tier is reached — a 7-person party still gets the 4+
      // tier's free look AND the 7+ tier's badge. The discount % takes the BEST (largest)
      // among all qualifying tiers, not just the highest-minPeople one, since a higher tier
      // may only add a perk/waiver without redefining the look discount itself.
      const bestFreeLookPercent = Math.max(0, ...qualifying.map((t) => t.freeLookPercent ?? 0));
      if (bestFreeLookPercent > 0 && ctx.freebieCandidates.length) {
        const cheapest = Math.min(...ctx.freebieCandidates);
        const amount = Math.round(cheapest * (bestFreeLookPercent / 100));
        if (amount > 0) {
          const label = bestFreeLookPercent >= 100 ? "Promo — cheapest look free" : `Promo — ${bestFreeLookPercent}% off cheapest look`;
          lines.push({ label, amount: -amount });
        }
      }
      for (const t of qualifying) {
        if (t.travelWaived) travelWaived = true;
        if (t.perkLabel) perks.push(t.perkLabel);
      }
      return { lines, perks, travelWaived };
    }

    case "weekdayDiscount": {
      if (ctx.weddingDayOfWeek == null || !promo.applyOnDays.includes(ctx.weddingDayOfWeek)) return NO_EFFECT;
      return {
        lines: promo.amount > 0 ? [{ label: "Promo — weekday wedding discount", amount: -promo.amount }] : [],
        perks: [],
        travelWaived: !!promo.travelWaived,
      };
    }

    case "seasonalWindow": {
      if (ctx.weddingMonth == null) return NO_EFFECT;
      const inWindow = promo.startMonth <= promo.endMonth
        ? ctx.weddingMonth >= promo.startMonth && ctx.weddingMonth <= promo.endMonth
        : ctx.weddingMonth >= promo.startMonth || ctx.weddingMonth <= promo.endMonth; // wraps year-end (e.g. Nov-Feb)
      if (!inWindow) return NO_EFFECT;
      return { lines: [{ label: "Promo — off-peak season rate", amount: -promo.amount }], perks: [], travelWaived: false };
    }

    case "earlyBirdLeadTime": {
      if (ctx.monthsUntilWedding == null || ctx.monthsUntilWedding < promo.minMonthsAhead) return NO_EFFECT;
      return { lines: [{ label: "Promo — early-bird booking bonus", amount: -promo.amount }], perks: [], travelWaived: false };
    }

    case "bundledValueAdd": {
      if (ctx.paidCount < promo.minPeople) return NO_EFFECT;
      return { lines: [], perks: [promo.perkLabel], travelWaived: false };
    }
  }
}

/**
 * Pure component arithmetic (PRICING.md §1). The browser estimator and the Worker both call this,
 * so the price a bride sees can never drift from the price she's quoted. Returns an itemised
 * breakdown so she can see what builds her price.
 *
 * Two rules locked with Pieter (2026-06-04): the additional-artist cost is already inside the
 * per-person prices for 5+/9+ parties — it's NOT auto-added, only charged when the bride requests
 * artists for her timeline. And under-12 flower girls are juniors: cheaper hair table AND never the
 * promo's free look (so adding one never steals the discount).
 */
export function computeEstimate(input: EstimateInput): EstimateResult {
  const trav = resolveTravel(input.travel);
  const lines: EstimateLine[] = [];
  const addTravel = (total: number): number => {
    if (trav.destination || trav.cost <= 0) return total;
    lines.push({ label: "Travel (round trip)", amount: trav.cost });
    return total + trav.cost;
  };

  // Group lessons — tiered per-person (PRICING.md §7), minimum group of 6. Promos are a
  // bridal-party lever only — not applied here.
  if (input.occasion === "lessons") {
    const n = Math.max(LESSONS.minGroup, input.lessonsAttending ?? 0);
    const pp = n < LESSONS.threshold ? LESSONS.perPersonUnder10 : LESSONS.perPerson10Plus;
    lines.push({ label: `Group lesson × ${n}`, amount: n * pp });
    return { total: addTravel(n * pp), heads: n, destination: trav.destination, occasion: input.occasion, lines, perks: [] };
  }

  // Other non-wedding events — makeup faces × base + hair faces × event-hair. No promos here either.
  if (input.occasion !== "wedding") {
    const base = EVENT_BASE[input.occasion] ?? 750;
    const evMakeup = Math.max(0, input.evMakeup ?? 0);
    const evHair = Math.max(0, input.evHair ?? 0);
    const len = input.evHairLen ?? "medium";
    let total = 0;
    if (evMakeup > 0) { total += base * evMakeup; lines.push({ label: `Makeup × ${evMakeup}`, amount: base * evMakeup }); }
    if (evHair > 0) { const a = PRICING.hairAdult[len] * evHair; total += a; lines.push({ label: `Hair (${LEN_LABEL[len]}) × ${evHair}`, amount: a }); }
    return { total: addTravel(total), heads: Math.max(1, evMakeup, evHair), destination: trav.destination, occasion: input.occasion, lines, perks: [] };
  }

  // Wedding — full bridal logic. The bride picks makeup, hair, or both, and whether her
  // selection includes the trial — trial and wedding-day sessions are priced identically,
  // so a single unit price × (2 for trial+day, 1 for day-only) covers either service.
  const trialMult = input.brideWantsTrial ? 2 : 1;
  let total = 0;
  if (input.brideWantsMakeup) total += PRICING.brideMakeupUnit * trialMult;
  if (input.brideWantsHair) total += PRICING.brideHairUnit[input.brideHairLen] * trialMult;
  const brideServiceParts = [
    input.brideWantsMakeup ? "makeup" : null,
    input.brideWantsHair ? `hair (${LEN_LABEL[input.brideHairLen]})` : null,
  ].filter(Boolean);
  const brideSessionDesc = input.brideWantsTrial ? "trial & wedding day" : "wedding day only";
  lines.push({ label: `Bride — ${brideServiceParts.join(" + ") || "no services selected"}, ${brideSessionDesc}`, amount: total });
  const paid: number[] = [];        // every full (hair + makeup) look — for the "4+" threshold
  const freebie: number[] = [];     // looks eligible to be comped by the promo (never the bride, never under-12 FG)
  // A "look" means both hair AND makeup — the bride only counts toward the promo threshold
  // (and is still never the comped one, per the rule below) when she's booked both.
  if (input.brideWantsMakeup && input.brideWantsHair) paid.push(total);

  const adultLengths = expandBuckets(input.partyHair);
  let hairIdx = 0;
  const nextAdultLen = (): HairLength => adultLengths[hairIdx++] ?? "medium";

  const addRole = (label: string, mk: number, hr: number, mkPrice: number, hairCost: () => number, eligible: boolean): number => {
    mk = Math.max(0, mk); hr = Math.max(0, hr);
    const heads = Math.max(mk, hr);
    let mkSub = 0, hrSub = 0;
    for (let i = 0; i < heads; i++) {
      const hasMakeup = i < mk;
      const hasHair = i < hr;
      let lookCost = 0;
      if (hasMakeup) { mkSub += mkPrice; lookCost += mkPrice; }
      if (hasHair) { const hc = hairCost(); hrSub += hc; lookCost += hc; }
      // A "look" at Lustique means both hair AND makeup — partial (makeup-only or
      // hair-only) services never qualify, either toward the promo's "4+" party-size
      // threshold or as the comped item itself. `eligible` further narrows which full
      // looks may be the one that's comped (e.g. never an under-12 flower girl).
      if (hasMakeup && hasHair) { paid.push(lookCost); if (eligible) freebie.push(lookCost); }
    }
    if (mkSub > 0) { total += mkSub; lines.push({ label: `${label} Makeup × ${mk}`, amount: mkSub }); }
    if (hrSub > 0) { total += hrSub; lines.push({ label: `${label} Hair Styling × ${hr}`, amount: hrSub }); }
    return heads;
  };

  const adultHair = () => PRICING.hairAdult[nextAdultLen()];
  let heads = 1;
  heads += addRole("Bridesmaid", input.bmMakeup, input.bmHair, PRICING.makeup.bridesmaid, adultHair, true);
  heads += addRole("Mother", input.momMakeup, input.momHair, PRICING.makeup.mother, adultHair, true);
  heads += addRole("Guest", input.guestMakeup, input.guestHair, PRICING.makeup.guest, adultHair, true);
  const fgUnder = input.fgAge === "under";
  const fgTable = fgUnder ? PRICING.hairFgUnder : PRICING.hairAdult;
  heads += addRole(
    fgUnder ? "Flower Girl (under 12)" : "Flower Girl (12+)",
    input.fgMakeup, input.fgHair,
    fgUnder ? PRICING.makeup.fgUnder : PRICING.makeup.fgOver,
    () => fgTable[input.fgHairLen],
    !fgUnder, // under-12 flower girls are never the promo's free look
  );

  // Additional artist(s) — only when the bride requests them (the assistant cost is otherwise included).
  const artists = Math.max(0, input.requestedArtists);
  if (artists > 0) { total += artists * ASSISTANT_RATE; lines.push({ label: `Additional artist × ${artists}`, amount: artists * ASSISTANT_RATE }); }

  const effect = evaluatePromo(input.promo, {
    paidCount: paid.length,
    freebieCandidates: freebie,
    weddingDayOfWeek: input.weddingDayOfWeek,
    weddingMonth: input.weddingMonth,
    monthsUntilWedding: input.monthsUntilWedding,
  });

  // A travel-waiver promo skips the travel line entirely; destination weddings already
  // zero travel inside addTravel regardless, so this only changes local-band bookings.
  total = (effect.travelWaived && !trav.destination) ? total : addTravel(total);
  for (const ln of effect.lines) { total += ln.amount; lines.push(ln); }

  return { total, heads, destination: trav.destination, occasion: "wedding", lines, perks: effect.perks };
}
