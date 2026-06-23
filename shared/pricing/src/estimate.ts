import { PRICING, RATE_PER_KM, FREE_KM, EVENT_BASE, LESSONS, ASSISTANT_RATE } from "./constants";
import type { EstimateInput, EstimateResult, EstimateLine, HairBuckets, HairLength, Promo } from "./types";

const LENGTHS: readonly HairLength[] = ["short", "medium", "long", "xlong"];
const LEN_LABEL: Record<HairLength, string> = { short: "short", medium: "medium", long: "long", xlong: "x-long" };

/** Round-trip travel cost: free within 30 km, else round-trip distance × R7. */
export const travelForKm = (km: number): number =>
  km <= FREE_KM ? 0 : Math.round(km * 2 * RATE_PER_KM);

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

/**
 * Apply the active promo. `paidCount` = looks booked (for the "4+" threshold); `freebieCandidates`
 * = looks eligible to be comped (party adults + 12+ flower girls — never the bride, never an
 * under-12 flower girl). Returns the discount as a negative line, or null.
 */
function promoLine(promo: Promo, paidCount: number, freebieCandidates: number[]): EstimateLine | null {
  if (promo.kind === "none" || paidCount < promo.minPeople) return null;
  if (promo.kind === "cheapestLookFree" && freebieCandidates.length > 0) {
    return { label: "Promo — cheapest look free", amount: -Math.min(...freebieCandidates) };
  }
  return null;
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

  // Group lessons — tiered per-person (PRICING.md §7), minimum group of 6.
  if (input.occasion === "lessons") {
    const n = Math.max(LESSONS.minGroup, input.lessonsAttending ?? 0);
    const pp = n < LESSONS.threshold ? LESSONS.perPersonUnder10 : LESSONS.perPerson10Plus;
    lines.push({ label: `Group lesson × ${n}`, amount: n * pp });
    return { total: addTravel(n * pp), heads: n, destination: trav.destination, occasion: input.occasion, lines };
  }

  // Other non-wedding events — makeup faces × base + hair faces × event-hair.
  if (input.occasion !== "wedding") {
    const base = EVENT_BASE[input.occasion] ?? 750;
    const evMakeup = Math.max(0, input.evMakeup ?? 0);
    const evHair = Math.max(0, input.evHair ?? 0);
    const len = input.evHairLen ?? "medium";
    let total = 0;
    if (evMakeup > 0) { total += base * evMakeup; lines.push({ label: `Makeup × ${evMakeup}`, amount: base * evMakeup }); }
    if (evHair > 0) { const a = PRICING.hairAdult[len] * evHair; total += a; lines.push({ label: `Hair (${LEN_LABEL[len]}) × ${evHair}`, amount: a }); }
    return { total: addTravel(total), heads: Math.max(1, evMakeup, evHair), destination: trav.destination, occasion: input.occasion, lines };
  }

  // Wedding — full bridal logic.
  let total = PRICING.brideCore[input.brideHairLen];
  lines.push({ label: `Bride — makeup + hair, trial & wedding day (${LEN_LABEL[input.brideHairLen]})`, amount: total });
  const paid: number[] = [total];   // every paying look (incl. bride + flower girls) — for the "4+" threshold
  const freebie: number[] = [];     // looks eligible to be comped by the promo (not bride, not under-12 FG)

  const adultLengths = expandBuckets(input.partyHair);
  let hairIdx = 0;
  const nextAdultLen = (): HairLength => adultLengths[hairIdx++] ?? "medium";

  const addRole = (label: string, mk: number, hr: number, mkPrice: number, hairCost: () => number, eligible: boolean): number => {
    mk = Math.max(0, mk); hr = Math.max(0, hr);
    const heads = Math.max(mk, hr);
    let sub = 0, count = 0;
    for (let i = 0; i < heads; i++) {
      let c = 0;
      if (i < mk) c += mkPrice;
      if (i < hr) c += hairCost();
      if (c > 0) { total += c; sub += c; count++; paid.push(c); if (eligible) freebie.push(c); }
    }
    if (count > 0) {
      const services =
        mk > 0 && hr > 0
          ? mk === hr
            ? `makeup + hair × ${count}`
            : `makeup × ${mk}, hair × ${hr}`
          : mk > 0
            ? `makeup × ${count}`
            : `hair × ${count}`;
      lines.push({ label: `${label} — ${services}`, amount: sub });
    }
    return heads;
  };

  const adultHair = () => PRICING.hairAdult[nextAdultLen()];
  let heads = 1;
  heads += addRole("Bridesmaid look", input.bmMakeup, input.bmHair, PRICING.makeup.bridesmaid, adultHair, true);
  heads += addRole("Mother look", input.momMakeup, input.momHair, PRICING.makeup.mother, adultHair, true);
  heads += addRole("Guest look", input.guestMakeup, input.guestHair, PRICING.makeup.guest, adultHair, true);
  const fgUnder = input.fgAge === "under";
  const fgTable = fgUnder ? PRICING.hairFgUnder : PRICING.hairAdult;
  heads += addRole(
    fgUnder ? "Flower girl (under 12)" : "Flower girl (12+)",
    input.fgMakeup, input.fgHair,
    fgUnder ? PRICING.makeup.fgUnder : PRICING.makeup.fgOver,
    () => fgTable[input.fgHairLen],
    !fgUnder, // under-12 flower girls are never the promo's free look
  );

  // Additional artist(s) — only when the bride requests them (the assistant cost is otherwise included).
  const artists = Math.max(0, input.requestedArtists);
  if (artists > 0) { total += artists * ASSISTANT_RATE; lines.push({ label: `Additional artist × ${artists}`, amount: artists * ASSISTANT_RATE }); }

  total = addTravel(total);

  const promo = promoLine(input.promo, paid.length, freebie);
  if (promo) { total += promo.amount; lines.push(promo); }

  return { total, heads, destination: trav.destination, occasion: "wedding", lines };
}
