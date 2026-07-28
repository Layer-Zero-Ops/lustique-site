// worker/src/booking/aria-bridge.test.ts
import { describe, it, expect } from "vitest";
import { buildAriaDirective } from "./aria-bridge";

describe("buildAriaDirective", () => {
  it("shapes a desktop->aria directive", () => {
    const d = buildAriaDirective({ bookingId: "b1", reference: "LUS-1", brideName: "Janeke", task: "draft-follow-up" });
    expect(d.direction).toBe("desktop->aria");
    expect(d.type).toBe("directive");
    expect(d.payload.action).toBe("draft-follow-up");
    expect(d.payload.booking_id).toBe("b1");
    expect(d.payload.reference).toBe("LUS-1");
    expect(d.payload.bride_name).toBe("Janeke");
    expect(d.payload.requested_by).toBe("dashboard");
    expect(d.payload.note).toBeNull();
  });
  it("carries an optional note", () => {
    const d = buildAriaDirective({ bookingId: "b2", reference: "LUS-2", brideName: "Amy", task: "custom", note: "chase deposit" });
    expect(d.payload.note).toBe("chase deposit");
  });
  it("supports review-nudge task", () => {
    const d = buildAriaDirective({ bookingId: "b3", reference: "LUS-3", brideName: "Bo", task: "draft-review-nudge" });
    expect(d.payload.action).toBe("draft-review-nudge");
  });
});
