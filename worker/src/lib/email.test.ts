import { describe, it, expect } from "vitest";
import { emailShell } from "./email";

describe("emailShell", () => {
  it("signs off with the BRAND.md-mandated line, not the old 'Lustique Co.' only", () => {
    const html = emailShell({ heading: "Test", body: "<p>body</p>", btnZone: "<a>go</a>" });
    expect(html).toContain("Blessings,");
    expect(html).toContain("The Lustique Cosmetology Team");
  });

  it("renders the logo as a crisp 160px image from the CDN", () => {
    const html = emailShell({ heading: "Test", body: "<p>body</p>", btnZone: "<a>go</a>" });
    expect(html).toContain("logo.png");
    expect(html).toContain("160");
    expect(html).toContain("<img");
  });
});
