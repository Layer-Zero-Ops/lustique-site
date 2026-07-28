// worker/src/booking/aria-capabilities.test.ts
import { describe, it, expect } from "vitest";
import { CAPABILITIES, getCapability, assessRisk, classifyIntent } from "./aria-capabilities";

describe("capability registry", () => {
  it("has unique ids and valid risk tiers", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAPABILITIES) expect(["low", "med", "high"]).toContain(c.risk);
  });
  it("getCapability returns by id", () => {
    expect(getCapability("send-email")?.risk).toBe("high");
    expect(getCapability("nope")).toBeUndefined();
  });
});

describe("assessRisk", () => {
  it("low auto-runs, no approval, no notify", () => {
    const d = assessRisk("tidy-dashboard");
    expect(d).toEqual({ tier: "low", auto: true, requiresApproval: false, notify: false });
  });
  it("med auto-runs but notifies", () => {
    const d = assessRisk("mark-deposit-paid");
    expect(d.auto).toBe(true);
    expect(d.requiresApproval).toBe(false);
    expect(d.notify).toBe(true);
  });
  it("high requires approval and does not auto-run", () => {
    const d = assessRisk("send-email");
    expect(d.auto).toBe(false);
    expect(d.requiresApproval).toBe(true);
    expect(d.notify).toBe(true);
  });
  it("unknown capability treated as high (fail-closed)", () => {
    expect(assessRisk("mystery").requiresApproval).toBe(true);
  });
});

describe("classifyIntent", () => {
  it("maps natural requests to capabilities", () => {
    expect(classifyIntent("Can you tidy the dashboard?")).toBe("tidy-dashboard");
    expect(classifyIntent("Mark the deposit as paid from the EFT proof")).toBe("mark-deposit-paid");
    expect(classifyIntent("Send a confirmation to the bride")).toBe("send-confirmation");
    expect(classifyIntent("Issue a refund for the cancelled booking")).toBe("issue-refund");
    expect(classifyIntent("Summarise booking LQ-2026-0042")).toBe("summarise");
  });
  it("returns null when nothing matches", () => {
    expect(classifyIntent("hello there")).toBeNull();
  });
});
