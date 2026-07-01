import { describe, it, expect } from "vitest";
import { computeEstimate, travelForKm, estimateDestinationExtras } from "./estimate";
import { ACTIVE_PROMO } from "./constants";
import type { EstimateInput } from "./types";

const base: EstimateInput = {
  occasion: "wedding", brideHairLen: "medium",
  partyHair: { short: 0, medium: 0, long: 0, xlong: 0 },
  bmMakeup: 0, bmHair: 0, momMakeup: 0, momHair: 0,
  fgAge: "under", fgMakeup: 0, fgHair: 0, fgHairLen: "medium",
  guestMakeup: 0, guestHair: 0,
  requestedArtists: 0,
  promo: ACTIVE_PROMO,
  travel: { band: "studio" },
};

// A 5-person party reused across tests: bride + 1 bridesmaid + 1 mother + 1 guest (all mk+hr, medium).
const party4 = {
  ...base,
  bmMakeup: 1, bmHair: 1, momMakeup: 1, momHair: 1, guestMakeup: 1, guestHair: 1,
  partyHair: { short: 0, medium: 3, long: 0, xlong: 0 },
};

describe("travelForKm", () => {
  it("is free when round-trip is within FREE_KM (15 km one-way = 30 km return)", () => expect(travelForKm(15)).toBe(0));
  it("is free right at the new 40 km round-trip boundary (20 km one-way)", () => expect(travelForKm(20)).toBe(0));
  it("charges beyond the free zone: Big Red Barn 22 km one-way = 44 km return = R308", () => expect(travelForKm(22)).toBe(308));
  it("charges full round-trip × R7 for 50 km one-way", () => expect(travelForKm(50)).toBe(700));
});

describe("travel bands (fallback, re-derived from R7/km round-trip)", () => {
  it("mid = R770", () => expect(computeEstimate({ ...base, travel: { band: "mid" } }).total).toBe(2890 + 770));
  it("far = R1610", () => expect(computeEstimate({ ...base, travel: { band: "far" } }).total).toBe(2890 + 1610));
  it("very-far = R2450", () => expect(computeEstimate({ ...base, travel: { band: "veryfar" } }).total).toBe(2890 + 2450));
  it("destination zeroes travel + flags destination", () => {
    const r = computeEstimate({ ...base, travel: { band: "destination" } });
    expect(r.destination).toBe(true);
    expect(r.total).toBe(2890);
  });
});

describe("estimateDestinationExtras (indicative-only, never the official total)", () => {
  it("solo bride (1 artist, 2 nights min) at 250km one-way", () => {
    const r = estimateDestinationExtras(250, 1);
    expect(r.travelEstimate).toBe(250 * 2 * 7); // same round-trip × R7 formula as travelForKm
    expect(r.artists).toBe(1);
    expect(r.accommodationEstimate).toBe(1 * 1000 * 2);
  });
  it("5+ heads bumps to 2 artists (matches the included-assistant tier)", () => {
    expect(estimateDestinationExtras(300, 5).artists).toBe(2);
  });
  it("9+ heads bumps to 3 artists", () => {
    expect(estimateDestinationExtras(300, 9).artists).toBe(3);
  });
  it("4 heads stays at 1 artist (below the assistant threshold)", () => {
    expect(estimateDestinationExtras(300, 4).artists).toBe(1);
  });
});

describe("computeEstimate — wedding", () => {
  it("solo bride, medium hair = bride core only, with one breakdown line", () => {
    const r = computeEstimate(base);
    expect(r.total).toBe(2890);
    expect(r.heads).toBe(1);
    expect(r.lines).toEqual([{ label: "Bride — makeup + hair, trial & wedding day (medium)", amount: 2890 }]);
  });

  it("full party: NO auto-assistant; promo frees the cheapest ADULT look (not the flower girl)", () => {
    // bride 2890 + 3 bridesmaids 3135 + 2 mothers 1990 + 1 flower-girl<12 (mk+hr) 500 = 8515
    // promo frees the cheapest eligible adult (a mother, 995); no assistant fee → 7520
    const r = computeEstimate({
      ...base, bmMakeup: 3, bmHair: 3, momMakeup: 2, momHair: 2, fgMakeup: 1, fgHair: 1,
      partyHair: { short: 0, medium: 5, long: 0, xlong: 0 },
    });
    expect(r.total).toBe(7520);
    expect(r.heads).toBe(7);
    expect(r.lines).toEqual([
      { label: "Bride — makeup + hair, trial & wedding day (medium)", amount: 2890 },
      { label: "Bridesmaid Makeup × 3", amount: 1650 },
      { label: "Bridesmaid Hair Styling × 3", amount: 1485 },
      { label: "Mother Makeup × 2", amount: 1000 },
      { label: "Mother Hair Styling × 2", amount: 990 },
      { label: "Flower Girl (under 12) Makeup × 1", amount: 250 },
      { label: "Flower Girl (under 12) Hair Styling × 1", amount: 250 },
      { label: "Promo — cheapest look free", amount: -995 },
    ]);
  });

  it("a configurable promo of { none } keeps the full price", () => {
    const r = computeEstimate({
      ...base, bmMakeup: 3, bmHair: 3, momMakeup: 2, momHair: 2, fgMakeup: 1, fgHair: 1,
      partyHair: { short: 0, medium: 5, long: 0, xlong: 0 }, promo: { kind: "none" },
    });
    expect(r.total).toBe(8515);
  });

  it("adding 1 flower-girl makeup adds ONLY her price (the reported R2000-jump bug)", () => {
    const before = computeEstimate(party4);
    const after = computeEstimate({ ...party4, fgMakeup: 1 });
    expect(before.total).toBe(4980);
    expect(after.total).toBe(5230);
    expect(after.total - before.total).toBe(250);
  });

  it("partial-service adults (makeup only) and under-12 flower girls never qualify for the free look", () => {
    // bride + 1 bridesmaid (mk only, no hair) + 1 guest (mk only) + 1 flower-girl<12 (mk only) = 4240
    // 4 paid looks → promo threshold met, but nobody has a full look (hair+makeup) → no discount
    const r = computeEstimate({ ...base, bmMakeup: 1, guestMakeup: 1, fgMakeup: 1 });
    expect(r.total).toBe(4240);
  });

  it("additional artists are added only when the bride requests them (R850 each)", () => {
    const r = computeEstimate({ ...base, requestedArtists: 2 });
    expect(r.total).toBe(2890 + 1700);
    expect(r.lines).toContainEqual({ label: "Additional artist × 2", amount: 1_700 });
  });

  it("mixed party-hair lengths price each adult head at its own length", () => {
    // 4 bridesmaids one of each length + 1 makeup-only mother, no flower girl, no assistant.
    // bride 2890 + adult hair (395+495+595+695=2180) + 4×550 makeup + 500 mom = 7770
    // Promo: mom is makeup-only (no "look") → cheapest full look = bridesmaid (short): 550+395=945 → 7770-945=6825
    const r = computeEstimate({
      ...base, bmMakeup: 4, bmHair: 4, momMakeup: 1, momHair: 0,
      partyHair: { short: 1, medium: 1, long: 1, xlong: 1 },
    });
    expect(r.total).toBe(6825);
    expect(r.heads).toBe(6);
  });
});

describe("promo kinds (Zandeline's dashboard-selected library)", () => {
  it("flatCreditOnMinParty: flat rand credit once the party threshold is met", () => {
    // party4 gross = bride 2890 + bridesmaid 1045 + mother 995 + guest 1045 = 5975
    const promo = { kind: "flatCreditOnMinParty" as const, minPeople: 4, amount: 1000 };
    const r = computeEstimate({ ...party4, promo });
    expect(r.total).toBe(5975 - 1000);
    expect(r.lines).toContainEqual({ label: "Promo — R1000 off your booking", amount: -1000 });
  });

  it("flatCreditOnMinParty: no discount below the threshold", () => {
    const promo = { kind: "flatCreditOnMinParty" as const, minPeople: 5, amount: 1000 };
    const r = computeEstimate({ ...party4, promo }); // party4 = 4 paid looks, threshold is 5
    expect(r.total).toBe(5975);
  });

  it("milestoneTiers: only the 4+ tier qualifies for a 4-look party — free look, no travel waiver", () => {
    const promo = {
      kind: "milestoneTiers" as const,
      tiers: [
        { minPeople: 4, freeLookPercent: 100 },
        { minPeople: 7, perkLabel: "Free touch-up kit" },
        { minPeople: 9, travelWaived: true },
      ],
    };
    const r = computeEstimate({ ...party4, promo, travel: { band: "mid" } });
    expect(r.total).toBe(5975 - 995 + 770); // cheapest look (the mother, 995) freed; travel still charged
    expect(r.perks).toEqual([]);
  });

  it("milestoneTiers: a 7-person party unlocks the touch-up perk badge on top of the free look", () => {
    const promo = {
      kind: "milestoneTiers" as const,
      tiers: [
        { minPeople: 4, freeLookPercent: 100 },
        { minPeople: 7, perkLabel: "Free touch-up kit" },
        { minPeople: 9, travelWaived: true },
      ],
    };
    const r = computeEstimate({
      ...base, promo, travel: { band: "mid" },
      bmMakeup: 3, bmHair: 3, momMakeup: 2, momHair: 2, fgMakeup: 1, fgHair: 1,
      partyHair: { short: 0, medium: 5, long: 0, xlong: 0 },
    }); // 7 heads
    expect(r.perks).toEqual(["Free touch-up kit"]);
    expect(r.lines).toContainEqual({ label: "Promo — cheapest look free", amount: -995 });
  });

  it("milestoneTiers: a 9-person party also waives travel entirely", () => {
    const promo = {
      kind: "milestoneTiers" as const,
      tiers: [
        { minPeople: 4, freeLookPercent: 100 },
        { minPeople: 9, travelWaived: true },
      ],
    };
    const r = computeEstimate({
      ...base, promo, travel: { band: "veryfar" },
      bmMakeup: 4, bmHair: 4, momMakeup: 2, momHair: 2, guestMakeup: 2, guestHair: 2,
      partyHair: { short: 0, medium: 8, long: 0, xlong: 0 },
    }); // 9 heads
    expect(r.lines.some((l) => l.label === "Travel (round trip)")).toBe(false);
  });

  it("weekdayDiscount: applies only on the configured days, using caller-supplied weddingDayOfWeek", () => {
    const promo = { kind: "weekdayDiscount" as const, applyOnDays: [1, 2, 3, 4, 5], amount: 500, travelWaived: true };
    const friday = computeEstimate({ ...base, promo, weddingDayOfWeek: 5, travel: { band: "mid" } });
    const saturday = computeEstimate({ ...base, promo, weddingDayOfWeek: 6, travel: { band: "mid" } });
    expect(friday.total).toBe(2890 - 500); // travel waived + R500 off
    expect(saturday.total).toBe(2890 + 770); // Saturday not in applyOnDays — full price
  });

  it("seasonalWindow: applies within the month range (inclusive)", () => {
    const promo = { kind: "seasonalWindow" as const, startMonth: 6, endMonth: 8, amount: 1000 };
    const june = computeEstimate({ ...base, promo, weddingMonth: 6 });
    const december = computeEstimate({ ...base, promo, weddingMonth: 12 });
    expect(june.total).toBe(2890 - 1000);
    expect(december.total).toBe(2890);
  });

  it("seasonalWindow: wraps across year-end (e.g. Nov-Feb)", () => {
    const promo = { kind: "seasonalWindow" as const, startMonth: 11, endMonth: 2, amount: 500 };
    const january = computeEstimate({ ...base, promo, weddingMonth: 1 });
    const july = computeEstimate({ ...base, promo, weddingMonth: 7 });
    expect(january.total).toBe(2890 - 500);
    expect(july.total).toBe(2890);
  });

  it("earlyBirdLeadTime: rewards booking far enough ahead", () => {
    const promo = { kind: "earlyBirdLeadTime" as const, minMonthsAhead: 6, amount: 750 };
    const early = computeEstimate({ ...base, promo, monthsUntilWedding: 8 });
    const late = computeEstimate({ ...base, promo, monthsUntilWedding: 2 });
    expect(early.total).toBe(2890 - 750);
    expect(late.total).toBe(2890);
  });

  it("bundledValueAdd: zero price effect, just a perk badge once the threshold is met", () => {
    const promo = { kind: "bundledValueAdd" as const, minPeople: 4, perkLabel: "Complimentary touch-up kit included" };
    const r = computeEstimate({ ...party4, promo });
    expect(r.total).toBe(5975); // unchanged — no discount lines
    expect(r.perks).toEqual(["Complimentary touch-up kit included"]);
  });

  it("bundledValueAdd: no badge below the threshold", () => {
    const promo = { kind: "bundledValueAdd" as const, minPeople: 5, perkLabel: "Complimentary touch-up kit included" };
    const r = computeEstimate({ ...party4, promo });
    expect(r.perks).toEqual([]);
  });

  it("date-aware promos are simply inert when the caller hasn't supplied the date facts yet", () => {
    const weekday = computeEstimate({ ...base, promo: { kind: "weekdayDiscount", applyOnDays: [1], amount: 500 } });
    const seasonal = computeEstimate({ ...base, promo: { kind: "seasonalWindow", startMonth: 1, endMonth: 2, amount: 500 } });
    const earlyBird = computeEstimate({ ...base, promo: { kind: "earlyBirdLeadTime", minMonthsAhead: 6, amount: 500 } });
    expect(weekday.total).toBe(2890);
    expect(seasonal.total).toBe(2890);
    expect(earlyBird.total).toBe(2890);
  });
});

describe("computeEstimate — events", () => {
  it("matric: makeup faces × base + hair × event-hair", () => {
    const r = computeEstimate({ ...base, occasion: "matric", evMakeup: 3, evHair: 2 });
    expect(r.total).toBe(750 * 3 + 495 * 2); // 3240
    expect(r.lines).toEqual([
      { label: "Makeup × 3", amount: 2250 },
      { label: "Hair (medium) × 2", amount: 990 },
    ]);
  });
  it("corporate: a single face = base", () =>
    expect(computeEstimate({ ...base, occasion: "corporate", evMakeup: 1 }).total).toBe(650));
});

describe("computeEstimate — group lessons", () => {
  it("under 10 attendees = R700pp", () =>
    expect(computeEstimate({ ...base, occasion: "lessons", lessonsAttending: 6 }).total).toBe(4200));
  it("10+ attendees = R600pp", () =>
    expect(computeEstimate({ ...base, occasion: "lessons", lessonsAttending: 12 }).total).toBe(7200));
});
