/**
 * LIVE post-intake smoke walk (design:
 * docs/superpowers/specs/2026-06-13-lustique-launch-readiness-design.md).
 *
 * Gated: runs ONLY when SMOKE_BASE_URL is set (`npm run smoke`); skipped in a
 * normal `vitest run`. Seeds a booking in Supabase, then drives
 *   confirm -> mark-paid -> mark-balance-paid
 * against the DEPLOYED worker with minted tokens, asserting the Supabase row +
 * audit after each step. NOT end-to-end: intake (/api/booking/request + Turnstile)
 * is covered by a manual form submission in the runbook.
 *
 * Required env: SMOKE_BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *               SIGNING_SECRET, SMOKE_BRIDE_EMAIL. Optional: SMOKE_KEEP=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signActionToken } from "./token";
import { buildSmokeBooking, evaluateStep } from "./smoke-helpers";

const BASE = process.env.SMOKE_BASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const SIGNING_SECRET = process.env.SIGNING_SECRET ?? "";
const BRIDE_EMAIL = process.env.SMOKE_BRIDE_EMAIL ?? "";
const KEEP = !!process.env.SMOKE_KEEP;
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

const sb = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
const sbHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };

async function sbInsert(row: Record<string, unknown>): Promise<void> {
  const r = await fetch(sb("bookings"), { method: "POST", headers: { ...sbHeaders, prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`seed insert ${r.status}: ${await r.text()}`);
}
async function sbReadBooking(id: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(sb(`bookings?id=eq.${id}&select=status,confirmed_at,deposit_paid_at,settled_at`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`read booking ${r.status}`);
  return ((await r.json()) as Array<Record<string, unknown>>)[0] ?? null;
}
async function sbReadAudit(id: string): Promise<Array<{ event_type: string }>> {
  const r = await fetch(sb(`audit_log?booking_id=eq.${id}&select=event_type&order=created_at.asc`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`read audit ${r.status}`);
  return (await r.json()) as Array<{ event_type: string }>;
}
/** Delete smoke bookings + their audit rows. audit_log FK is on-delete-set-null, so audit first. */
async function sbSweepSmoke(): Promise<void> {
  const r = await fetch(sb(`bookings?bride_name=like.SMOKE*&select=id`), { headers: sbHeaders });
  if (!r.ok) throw new Error(`sweep select ${r.status}`);
  for (const { id } of (await r.json()) as Array<{ id: string }>) {
    await fetch(sb(`audit_log?booking_id=eq.${id}`), { method: "DELETE", headers: sbHeaders });
  }
  await fetch(sb(`bookings?bride_name=like.SMOKE*`), { method: "DELETE", headers: sbHeaders });
}
/** POST form-encoded. Manual redirect: confirm 303s to the static site; don't follow it. */
async function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}
const actionToken = (id: string, purpose: string) =>
  signActionToken(id, new Date(Date.now() + NINETY_DAYS), SIGNING_SECRET, purpose);

describe.skipIf(!BASE)("live post-intake smoke walk", () => {
  let id = "";
  let confirmToken = "";

  beforeAll(async () => {
    for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY: SERVICE_KEY, SIGNING_SECRET, SMOKE_BRIDE_EMAIL: BRIDE_EMAIL })) {
      if (!v) throw new Error(`smoke walk needs env ${k}`);
    }
    await sbSweepSmoke();
    const seed = await buildSmokeBooking(SIGNING_SECRET, BRIDE_EMAIL);
    id = seed.id;
    confirmToken = seed.confirmToken;
    await sbInsert(seed.row);
  });

  afterAll(async () => { if (!KEEP) await sbSweepSmoke(); });

  it("seed -> confirmed", async () => {
    await postForm("/api/booking/confirm", { token: confirmToken, action: "confirm" });
    const fails = evaluateStep(
      { label: "confirm", status: "confirmed", timestampField: "confirmed_at", successEvent: "confirm.confirmed" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  }, 15_000);

  it("confirmed -> deposit_paid", async () => {
    const resp = await postForm("/api/booking/mark-paid", { token: await actionToken(id, "deposit") });
    expect(resp.status).toBe(200);
    const fails = evaluateStep(
      { label: "mark-paid", status: "deposit_paid", timestampField: "deposit_paid_at", successEvent: "payment.deposit-recorded" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  });

  it("deposit_paid -> settled", async () => {
    const resp = await postForm("/api/booking/mark-balance-paid", { token: await actionToken(id, "balance") });
    expect(resp.status).toBe(200);
    const fails = evaluateStep(
      { label: "mark-balance-paid", status: "settled", timestampField: "settled_at", successEvent: "payment.balance-recorded" },
      { row: await sbReadBooking(id), auditEvents: await sbReadAudit(id) },
    );
    expect(fails, fails.join("\n")).toEqual([]);
  });
});
