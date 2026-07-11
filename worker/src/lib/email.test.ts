import { describe, it, expect } from "vitest";
import { emailShell } from "./email";

describe("emailShell", () => {
  it("signs off with the BRAND.md-mandated line, not the old 'Lustique Co.' only", () => {
    const html = emailShell({ heading: "Test", body: "<p>body</p>", btnZone: "<a>go</a>" });
    expect(html).toContain("Blessings,");
    expect(html).toContain("The Lustique Cosmetology Team");
  });
});
