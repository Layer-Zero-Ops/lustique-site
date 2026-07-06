import { describe, it, expect } from "vitest";
import { PROMO_PRESETS, getPromoPreset } from "./promoPresets";

describe("PROMO_PRESETS", () => {
  it("has exactly 10 curated presets", () => {
    expect(PROMO_PRESETS).toHaveLength(10);
  });

  it("every preset has a unique id", () => {
    const ids = PROMO_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every live-estimate preset has a computable promo (not 'none')", () => {
    for (const p of PROMO_PRESETS.filter((p) => p.appliesToLiveEstimate)) {
      expect(p.promo.kind).not.toBe("none");
    }
  });

  it("every manual (non-live) preset carries a note explaining how it's applied", () => {
    for (const p of PROMO_PRESETS.filter((p) => !p.appliesToLiveEstimate)) {
      expect(p.manualNote).toBeTruthy();
      expect(p.promo.kind).toBe("none");
    }
  });

  it("getPromoPreset finds a known preset and misses an unknown one", () => {
    expect(getPromoPreset("cheapest-look-free")?.name).toBe("Least-Expensive Look, On Us");
    expect(getPromoPreset("does-not-exist")).toBeUndefined();
  });

  it("every preset carries non-empty terms — the tagline alone can read as an unconditional promise", () => {
    for (const p of PROMO_PRESETS) {
      expect(p.terms.trim().length).toBeGreaterThan(0);
    }
  });

  it("every promo that can waive travel discloses the destination-wedding boundary in its terms", () => {
    const travelWaivingIds = PROMO_PRESETS.filter((p) => {
      if (p.promo.kind === "weekdayDiscount") return !!p.promo.travelWaived;
      if (p.promo.kind === "milestoneTiers") return p.promo.tiers.some((t) => t.travelWaived);
      return false;
    }).map((p) => p.id);

    // Guards against a future travel-waiving promo shipping without the same disclosure —
    // if this list is ever empty, the two known travel-waiver presets were removed/renamed.
    expect(travelWaivingIds).toEqual(expect.arrayContaining(["weekday-wonders", "glam-squad-milestones"]));

    for (const id of travelWaivingIds) {
      const terms = getPromoPreset(id)!.terms;
      expect(terms.toLowerCase()).toMatch(/destination|200\s*km/);
    }
  });
});
