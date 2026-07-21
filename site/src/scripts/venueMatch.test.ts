import { describe, it, expect } from "vitest";
import { findKnownVenue, normalizeVenueName, venueLabel, buildGeocodeQuery, isPreciseGeocodeResult, type KnownVenue } from "./venueMatch";

const avianto: KnownVenue = {
  name: "Avianto Function Venue",
  town: "Muldersdrift",
  province: "Gauteng",
  address: "Muldersdrift, Mogale City, Gauteng, South Africa",
  lat: -26.01268,
  lng: 27.86882,
  source: "sa-venues.com",
  precision: "town",
  verified: true,
};

const gandhiHall: KnownVenue = {
  name: "Gandhi Hall",
  town: null,
  province: null,
  address: null,
  lat: -26.31714,
  lng: 27.84582,
  source: "openstreetmap",
  precision: "poi",
  verified: true,
};

const venues = [avianto, gandhiHall];

describe("venueLabel", () => {
  it("appends the town when present", () => {
    expect(venueLabel(avianto)).toBe("Avianto Function Venue — Muldersdrift");
  });
  it("omits the dash when town is missing", () => {
    expect(venueLabel(gandhiHall)).toBe("Gandhi Hall");
  });
});

describe("findKnownVenue", () => {
  it("matches the exact datalist label", () => {
    expect(findKnownVenue("Avianto Function Venue — Muldersdrift", venues)).toBe(avianto);
  });

  it("matches the exact name, case-insensitively", () => {
    expect(findKnownVenue("avianto function venue", venues)).toBe(avianto);
  });

  it("fuzzy-matches a bare venue name missing its suffix", () => {
    expect(findKnownVenue("Avianto", venues)).toBe(avianto);
  });

  it("fuzzy-matches with an unrelated suffix word swapped in", () => {
    expect(findKnownVenue("Avianto Estate", venues)).toBe(avianto);
  });

  it("does not match unrelated text", () => {
    expect(findKnownVenue("Some Other Place", venues)).toBeUndefined();
  });

  it("does not match empty or whitespace-only input", () => {
    expect(findKnownVenue("   ", venues)).toBeUndefined();
  });

  it("does not fuzzy-match on a bare suffix word alone", () => {
    // "Hall" normalizes to "" (it's a stripped suffix word) — must not match Gandhi Hall.
    expect(findKnownVenue("Hall", venues)).toBeUndefined();
  });

  it("does not fuzzy-match very short input even if it's a substring", () => {
    expect(findKnownVenue("Avi", venues)).toBeUndefined();
  });
});

describe("buildGeocodeQuery", () => {
  // Regression test: the quote form used to let a bride-typed town or defaulted-to-
  // "Gauteng" province leak into the geocode query text. Confirmed live against HERE's
  // Geocode API that either one can hijack the result — a province default sent a real
  // Western Cape venue ("Val de Vie Estate") hundreds of km off, and a town name alone
  // can resolve to that town's centre instead of the actual venue. The query is venue +
  // country only — no other free-text location ever makes it in.
  it("joins venue and country", () => {
    expect(buildGeocodeQuery("Val de Vie Estate")).toBe("Val de Vie Estate, South Africa");
  });

  it("trims whitespace", () => {
    expect(buildGeocodeQuery("  Val de Vie Estate  ")).toBe("Val de Vie Estate, South Africa");
  });

  it("returns just the country qualifier when venue is empty", () => {
    expect(buildGeocodeQuery("")).toBe("South Africa");
  });
});

describe("isPreciseGeocodeResult", () => {
  // Regression: "Meulstroom Lodge, Bronkhorstspruit, South Africa" resolved to the
  // resultType "locality" — i.e. HERE matched the town, not the lodge — and was
  // silently accepted as the venue's location, underquoting travel by tens of km.
  it("rejects town/area-level matches", () => {
    expect(isPreciseGeocodeResult("locality")).toBe(false);
    expect(isPreciseGeocodeResult("administrativeArea")).toBe(false);
    expect(isPreciseGeocodeResult("country")).toBe(false);
    expect(isPreciseGeocodeResult("postalCode")).toBe(false);
  });

  it("accepts address/POI-level matches", () => {
    expect(isPreciseGeocodeResult("houseNumber")).toBe(true);
    expect(isPreciseGeocodeResult("place")).toBe(true);
    expect(isPreciseGeocodeResult("street")).toBe(true);
  });

  it("rejects a missing resultType", () => {
    expect(isPreciseGeocodeResult(undefined)).toBe(false);
  });
});

describe("normalizeVenueName", () => {
  it("strips punctuation, case, and common suffix words", () => {
    expect(normalizeVenueName("Avianto Function Venue")).toBe("avianto");
    expect(normalizeVenueName("Avianto Estate")).toBe("avianto");
  });

  it("collapses a bare suffix word to empty", () => {
    expect(normalizeVenueName("Hall")).toBe("");
  });
});
