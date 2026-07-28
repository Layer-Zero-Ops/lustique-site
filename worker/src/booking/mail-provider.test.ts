// worker/src/booking/mail-provider.test.ts
import { describe, it, expect } from "vitest";
import { normalise, pickNew, makeSpacemailProvider, type RawMessage } from "./mail-provider";

const msg = (id: string, from: string): RawMessage => ({
  externalId: id,
  fromEmail: from,
  snippet: "Hi, is the 12 Sept date still open?",
  receivedAt: "2026-08-01T09:00:00Z",
});

describe("normalise", () => {
  it("tags provider + defaults flags", () => {
    const row = normalise("spacemail", msg("u1", "kerry@gc-sat.com"));
    expect(row.provider).toBe("spacemail");
    expect(row.external_id).toBe("u1");
    expect(row.from_email).toBe("kerry@gc-sat.com");
    expect(row.is_read).toBe(false);
    expect(row.is_archived).toBe(false);
  });
  it("handles missing optional fields", () => {
    const row = normalise("gmail", msg("g1", "a@b.com"));
    expect(row.thread_id).toBeNull();
    expect(row.subject).toBeNull();
  });
});

describe("pickNew", () => {
  it("filters out already-known external ids", () => {
    const raw = [msg("u1", "a@b.com"), msg("u2", "c@d.com"), msg("u3", "e@f.com")];
    const known = new Set(["u2"]);
    const out = pickNew(raw, known);
    expect(out.map((m) => m.externalId).sort()).toEqual(["u1", "u3"]);
  });
  it("returns all when nothing known", () => {
    expect(pickNew([msg("u1", "a")], new Set()).length).toBe(1);
  });
});

describe("providers", () => {
  it("spacemail provider reports name + no-op fetch until creds land", async () => {
    const p = makeSpacemailProvider({ imapHost: "imap.spacemail.io", imapPort: 993, username: "info@lustiqueco.co.za", password: "app" });
    expect(p.name).toBe("spacemail");
    expect(await p.fetchNew(null, 10)).toEqual([]);
  });
});
