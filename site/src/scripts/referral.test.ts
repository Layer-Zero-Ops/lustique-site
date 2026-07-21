import { describe, it, expect, beforeEach } from "vitest";
import { captureReferralSource, readReferralSource } from "./referral";

// Minimal in-memory sessionStorage stand-in — the site's vitest environment is
// plain Node (no jsdom/happy-dom dependency installed), and this project's
// convention is that only Pieter's terminal runs `npm install`, so this test
// stubs just the two methods referral.ts actually calls rather than pulling in
// a DOM environment dependency.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { sessionStorage: FakeStorage }).sessionStorage = new FakeStorage();

describe("captureReferralSource", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores ?ref= from the query string", () => {
    captureReferralSource("?ref=avianto");
    expect(readReferralSource()).toBe("avianto");
  });

  it("stores utm_source as a fallback when ref is absent", () => {
    captureReferralSource("?utm_source=instagram");
    expect(readReferralSource()).toBe("instagram");
  });

  it("prefers ref over utm_source when both are present", () => {
    captureReferralSource("?ref=avianto&utm_source=instagram");
    expect(readReferralSource()).toBe("avianto");
  });

  it("does nothing when neither is present — keeps whatever was already stored", () => {
    captureReferralSource("?ref=avianto");
    captureReferralSource(""); // a later page load with no query string
    expect(readReferralSource()).toBe("avianto"); // still attributed to the original link
  });

  it("readReferralSource returns undefined when nothing was ever captured", () => {
    expect(readReferralSource()).toBeUndefined();
  });
});
