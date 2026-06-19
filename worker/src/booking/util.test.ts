import { describe, it, expect } from "vitest";
import { workingDaysBefore, makeReference } from "./util";

describe("workingDaysBefore", () => {
  it("1 working day before Mon 2024-01-08 is Fri 2024-01-05", () => {
    expect(workingDaysBefore(new Date("2024-01-08T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2024-01-05");
  });

  // 2024-01-01 is New Year's Day (SA public holiday) — now correctly skipped.
  // 5 working days before Mon 2024-01-08 lands on Fri 2023-12-29 instead.
  it("5 working days before Mon 2024-01-08 skips New Year's Day and lands on Fri 2023-12-29", () => {
    expect(workingDaysBefore(new Date("2024-01-08T00:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2023-12-29");
  });

  it("never lands on a weekend", () => {
    for (let n = 1; n <= 30; n++) {
      const day = workingDaysBefore(new Date("2024-03-01T00:00:00Z"), n).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("skips Good Friday (Easter-relative SA holiday)", () => {
    // Good Friday 2024 = 2024-03-29. 1 working day before Tue 2024-04-02 should skip it.
    // Mon 2024-04-01 = Family Day (also a holiday). So 1 working day before 2024-04-02 → Fri 2024-03-28? No:
    // Step back from 2024-04-02: 2024-04-01 (Mon, Family Day — skip), 2024-03-29 (Fri, Good Friday — skip), 2024-03-28 (Thu) ✓
    expect(workingDaysBefore(new Date("2024-04-02T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2024-03-28");
  });

  it("skips Freedom Day (Apr 27)", () => {
    // 1 working day before Mon 2024-04-29: Apr 28 (Sun, skip), Apr 27 (Sat AND Freedom Day, skip), Apr 26 (Fri) ✓
    // Actually Apr 28 is Sun (skip), Apr 27 is Sat (skip as weekend already), Apr 26 is Fri ✓
    // Use Mon Apr 29 → step back: Apr 28 Sun, Apr 27 Sat, Apr 26 Fri ✓ (Freedom Day on Sat, no extra skip needed)
    // Better: 1 working day before Tue 2026-04-28: Apr 27 2026 is Mon AND Freedom Day → skip → Apr 24 Fri ✓
    expect(workingDaysBefore(new Date("2026-04-28T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-04-24");
  });
});

describe("makeReference", () => {
  it("formats a human reference from the uuid + year", () => {
    expect(makeReference("1a2b3c4d-5e6f-7081-9213-456789abcdef", 2026)).toBe("LUS-2026-1A2B3C");
  });
});
