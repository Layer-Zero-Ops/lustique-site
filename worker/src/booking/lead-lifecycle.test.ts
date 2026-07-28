// worker/src/booking/lead-lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { deriveLifecycle, isOrphanRisk, advanceLifecycle, type LeadInput } from "./lead-lifecycle";

function lead(over: Partial<LeadInput>): LeadInput {
  return { enquiry_status: "new", booking_id: null, booking_status: null, archived_at: null, ...over };
}

describe("deriveLifecycle", () => {
  it("new enquiry, no booking -> new", () => {
    expect(deriveLifecycle(lead({}))).toBe("new");
  });
  it("contacted enquiry, no booking -> contacted", () => {
    expect(deriveLifecycle(lead({ enquiry_status: "contacted" }))).toBe("contacted");
  });
  it("enquiry with booking_id -> booked", () => {
    expect(deriveLifecycle(lead({ booking_id: "b1" }))).toBe("booked");
  });
  it("booking quoted (requested/quote_sent) -> quoted", () => {
    expect(deriveLifecycle(lead({ booking_id: "b1", booking_status: "requested" }))).toBe("quoted");
    expect(deriveLifecycle(lead({ booking_id: "b1", booking_status: "quote_sent" }))).toBe("quoted");
  });
  it("booking accepted/deposit/settled -> booked", () => {
    expect(deriveLifecycle(lead({ booking_id: "b1", booking_status: "accepted" }))).toBe("booked");
    expect(deriveLifecycle(lead({ booking_id: "b1", booking_status: "settled" }))).toBe("booked");
  });
  it("declined booking -> declined", () => {
    expect(deriveLifecycle(lead({ booking_status: "declined" }))).toBe("declined");
    expect(deriveLifecycle(lead({ enquiry_status: "closed" }))).toBe("declined");
  });
  it("archived wins", () => {
    expect(deriveLifecycle(lead({ archived_at: "2026-01-01", booking_id: "b1" }))).toBe("archived");
  });
  it("converted enquiry -> booked", () => {
    expect(deriveLifecycle(lead({ enquiry_status: "converted" }))).toBe("booked");
  });
});

describe("isOrphanRisk", () => {
  it("new enquiry with no booking is orphan risk", () => {
    expect(isOrphanRisk(lead({}))).toBe(true);
  });
  it("contacted with no booking is orphan risk", () => {
    expect(isOrphanRisk(lead({ enquiry_status: "contacted" }))).toBe(true);
  });
  it("booking linked -> not orphan", () => {
    expect(isOrphanRisk(lead({ booking_id: "b1" }))).toBe(false);
  });
  it("archived -> not orphan", () => {
    expect(isOrphanRisk(lead({ archived_at: "x" }))).toBe(false);
  });
});

describe("advanceLifecycle", () => {
  it("moves forward only", () => {
    expect(advanceLifecycle("new", "contacted")).toBe("contacted");
    expect(advanceLifecycle("booked", "new")).toBe("booked");
    expect(advanceLifecycle("quoted", "booked")).toBe("booked");
  });
});
