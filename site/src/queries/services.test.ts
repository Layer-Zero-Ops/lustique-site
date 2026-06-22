import { describe, it, expect } from "vitest";
import { SERVICES_QUERY } from "./services";

describe("services query", () => {
  it("SERVICES_QUERY fetches service type and orders by displayOrder", () => {
    expect(SERVICES_QUERY).toContain('"service"');
    expect(SERVICES_QUERY).toContain("displayOrder");
    expect(SERVICES_QUERY).toContain("priceDisplay");
    expect(SERVICES_QUERY).toContain("description");
  });
});
