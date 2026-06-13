# S5 — Balance Automation (EFT balance reminder + settle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The daily cron emails a bride her outstanding EFT balance 14 working days before the wedding, and Zandeline can mark the balance received to move the booking `deposit_paid → settled`.

**Architecture:** A new self-contained `worker/src/booking/balance.ts` mirrors the S4 `mark-paid` loop in `confirm.ts`, one state later (`deposit_paid → settled`, token purpose `"balance"`). A `balanceSweep()` runs inside the already-wired `scheduled()` handler. One new `db.ts` query helper finds due bookings. No migration, no new secrets, no site page — `settled_at` + `balance_reminder_sent_at` already exist (`supabase/migrations/0001_booking_core.sql:38-39`) and the cron is already firing (`worker/wrangler.toml` `crons = ["0 6 * * *"]`).

**Tech Stack:** TypeScript Cloudflare Worker (fetch-only, no SDK), PostgREST against Supabase, Brevo transactional email, Web Crypto HMAC tokens, Vitest with dependency-injected `fetch`/`now`.

**Why this reshapes the spec:** the 2026-06-05 booking-core spec routes the balance through a Yoco pay-link; Pieter locked **EFT-first, Yoco = v2** on 2026-06-12. S5 builds the EFT loop, not Yoco. (Spec balance section is superseded — a spec touch-up is a deferred follow-up, not part of this plan.)

**Out of scope (deferred):** token-expiry sweep · auto-cancel on non-payment · PII purge (blocked on retention periods) · Yoco rail (v2) · `payments`-table rows (EFT loop doesn't use them) · shared email/html helper extraction · S6 brand-voice email polish · SA public-holiday handling.

**Conventions to follow (read these first):**
- `worker/src/booking/confirm.ts` — the exact template. `mark-paid` (`:217-294`), `pageShell`/`htmlResponse`/`invalidHtml`/`expiredHtml`/`handledHtml` (`:54-78`), `brevoEmail` (`:117-133`), `esc`/`zar` (`:29-31`), admin link email (`:200-207`), `depositSecuredEmailHtml` (`:249-255`). **Copy these patterns; change only the documented deltas.**
- `worker/src/booking/db.ts` — `countBookingsOnDate` (`:200-215`) is the query template; `transitionBooking` (`:164`), `getBookingById` (`:149`), `CONFIRM_COLS` (`:128`).
- `worker/src/booking/token.ts` — `signActionToken`/`verifyActionToken` (purpose-scoped, `:110`/`:123`).
- `worker/src/booking/util.ts` — `workingDaysBefore(from, n)` (`:7`).
- `worker/src/booking/audit.ts` — `writeAudit(env, {bookingId, eventType, payload}, f?, now?)`.
- Test templates: `worker/src/booking/confirm.test.ts` (`res`/`env`/`bookingRow` fixtures, mark-paid GET/POST specs) and `db.test.ts`.

---

### Task 1: `listBookingsDueForBalanceReminder` query helper

**Files:**
- Modify: `worker/src/booking/db.ts` (add after `countBookingsOnDate`, ~`:215`)
- Test: `worker/src/booking/db.test.ts`

- [ ] **Step 1: Write the failing test** (append to `db.test.ts`)

```ts
import { /* …existing… */ listBookingsDueForBalanceReminder } from "./db";

describe("listBookingsDueForBalanceReminder", () => {
  it("queries deposit_paid, unsent, balance>0, within the wedding-date window", async () => {
    const rows = [{ id: "b1", status: "deposit_paid", wedding_date: "2026-07-01", balance_reminder_sent_at: null, balance_net_cents: 441300 }];
    const f = vi.fn().mockResolvedValue(res(rows));
    const got = await listBookingsDueForBalanceReminder(env, "2026-06-13", "2026-07-04", f as unknown as typeof fetch);
    expect(got).toEqual(rows);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain("status=eq.deposit_paid");
    expect(url).toContain("balance_reminder_sent_at=is.null");
    expect(url).toContain("balance_net_cents=gt.0");
    expect(url).toContain("wedding_date=gte.2026-06-13");
    expect(url).toContain("wedding_date=lte.2026-07-04");
    expect(url).toContain("balance_reminder_sent_at"); // present in the select list
  });
  it("returns [] when nothing is due", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await listBookingsDueForBalanceReminder(env, "2026-06-13", "2026-07-04", f as unknown as typeof fetch)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd worker && npx vitest run src/booking/db.test.ts` → FAIL (`listBookingsDueForBalanceReminder is not a function`).

- [ ] **Step 3: Implement** (in `db.ts`, mirroring `countBookingsOnDate`)

```ts
/** Bookings due a balance reminder: deposit_paid, not yet reminded, real balance, wedding within window. */
export async function listBookingsDueForBalanceReminder(
  env: DbEnv,
  todayYMD: string,      // "YYYY-MM-DD"
  windowEndYMD: string,  // today + ~21 calendar days (index-backed pre-filter)
  f: typeof fetch = fetch,
): Promise<Array<ConfirmBookingRow & { balance_reminder_sent_at: string | null }>> {
  const q =
    `bookings?status=eq.deposit_paid&balance_reminder_sent_at=is.null&balance_net_cents=gt.0` +
    `&wedding_date=gte.${todayYMD}&wedding_date=lte.${windowEndYMD}` +
    `&select=${CONFIRM_COLS},balance_reminder_sent_at`;
  const r = await f(rest(env, q), { headers: headers(env) });
  if (!r.ok) throw new Error(`listBookingsDueForBalanceReminder ${r.status}`);
  return (await r.json()) as Array<ConfirmBookingRow & { balance_reminder_sent_at: string | null }>;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run src/booking/db.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add worker/src/booking/db.ts worker/src/booking/db.test.ts && git commit -m "feat(worker): listBookingsDueForBalanceReminder query (S5)"`

---

### Task 2: `balance.ts` — token load + GET render (mark-balance-paid)

**Files:**
- Create: `worker/src/booking/balance.ts`
- Test: `worker/src/booking/balance.test.ts`

This is an exact mirror of `confirm.ts` mark-paid GET (`:217-268`). Deltas vs mark-paid: token purpose `"deposit"`→`"balance"`; required state `"confirmed"`→`"deposit_paid"`; show `balance_net_cents` not `deposit_net_cents`; form action `/api/booking/mark-paid`→`/api/booking/mark-balance-paid`. Reuse the same `BookingConfirmEnv`, `esc`, `zar`, `pageShell`, `htmlResponse`, `invalidHtml`/`expiredHtml`/`handledHtml`, `brevoEmail` shapes (copy them into `balance.ts`, matching the existing per-file convention).

- [ ] **Step 1: Write the failing test** (`balance.test.ts` — fixtures copied from `confirm.test.ts:1-33`, plus a balance token)

```ts
import { describe, it, expect, vi } from "vitest";
import { renderMarkBalancePaidPage, handleMarkBalancePaid, balanceSweep } from "./balance";
import { signActionToken } from "./token";

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BOOKING_ID = "11111111-2222-3333-4444-555555555555";
const SIGNING_SECRET = "signing-secret";
const env = {
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "svc",
  BREVO_API_KEY: "brevo-key", NOTIFY_EMAIL: "z@lustique.co.za",
  ALLOWED_ORIGIN: "https://lustiqueco.co.za", SIGNING_SECRET,
  EFT_BANK: "FNB", EFT_ACCOUNT_NAME: "Lustique Co", EFT_ACCOUNT_NO: "62000000000", EFT_BRANCH_CODE: "250655",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};
const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING_ID, reference: "LUS-2026-111122", status: "deposit_paid",
  bride_name: "Anke van der Berg", bride_email: "anke@example.com", wedding_date: "2027-11-14",
  venue: "Red Ivory", town: "Hartbeespoort", province: "Gauteng", party_size: 7,
  total_cents: 882600, deposit_pct: 50, deposit_net_cents: 441300, balance_net_cents: 441300,
  confirm_token_expires_at: "2027-01-01T00:00:00Z", confirm_token_used_at: null,
  balance_reminder_sent_at: null, ...over,
});
const balanceToken = (ttlMs = 90 * 24 * 3600 * 1000) =>
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "balance");
const getReq = (t: string) => new Request(`https://worker/api/booking/mark-balance-paid?token=${encodeURIComponent(t)}`);

describe("renderMarkBalancePaidPage (GET render-only)", () => {
  it("renders the balance-received page for a deposit_paid booking", async () => {
    const t = await balanceToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow()])); // getBookingById
    const resp = await renderMarkBalancePaidPage(env, getReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("balance");
    expect(html).toContain('action="/api/booking/mark-balance-paid"');
    expect(f).toHaveBeenCalledOnce();
  });
  it("shows 'already handled' when the booking isn't deposit_paid", async () => {
    const t = await balanceToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow({ status: "settled" })]));
    const html = await (await renderMarkBalancePaidPage(env, getReq(t), f as unknown as typeof fetch)).text();
    expect(html).toContain("already");
  });
  it("rejects a deposit-purpose token replayed here (wrong purpose), no DB call", async () => {
    const deposit = await signActionToken(BOOKING_ID, new Date(Date.now() + 1e6), SIGNING_SECRET, "deposit");
    const f = vi.fn();
    const resp = await renderMarkBalancePaidPage(env, getReq(deposit), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/booking/balance.test.ts` → FAIL (module/exports missing).

- [ ] **Step 3: Implement `balance.ts` load + GET** (mirror `confirm.ts:1-115,217-268`; deltas applied)

```ts
import { getBookingById, transitionBooking, type ConfirmBookingRow } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { signActionToken, verifyActionToken } from "./token";

export interface BookingBalanceEnv extends AuditEnv {
  BREVO_API_KEY: string; NOTIFY_EMAIL: string; ALLOWED_ORIGIN: string; SIGNING_SECRET: string;
  EFT_BANK: string; EFT_ACCOUNT_NAME: string; EFT_ACCOUNT_NO: string; EFT_BRANCH_CODE: string;
}
const BALANCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// esc, zar, htmlResponse, pageShell, invalidHtml, expiredHtml, handledHtml, brevoEmail:
//   copy verbatim from confirm.ts:29-78,117-133.

type Load = { ok: true; booking: ConfirmBookingRow } | { ok: false; reason: "invalid" | "expired" | "handled" };
async function loadDepositPaidBooking(env: BookingBalanceEnv, token: string, f: typeof fetch): Promise<Load> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "balance");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "deposit_paid") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

function markBalancePaidPageBody(b: ConfirmBookingRow, token: string): string {
  return `<h1>Record balance received</h1>
<p>Confirm you've received <strong>${esc(b.bride_name)}</strong>'s balance payment. This completes her booking and emails her the all-paid confirmation.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Balance</td><td><strong>${zar(b.balance_net_cents)}</strong></td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/mark-balance-paid"><input type="hidden" name="token" value="${esc(token)}"><button class="confirm" type="submit">Balance received — complete her booking</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">Only do this once the money reflects in the account.</p>`;
}

export async function renderMarkBalancePaidPage(env: BookingBalanceEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadDepositPaidBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Record balance", markBalancePaidPageBody(loaded.booking, token)));
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run src/booking/balance.test.ts` → PASS (GET specs).

- [ ] **Step 5: Commit** — `git add worker/src/booking/balance.ts worker/src/booking/balance.test.ts && git commit -m "feat(worker): mark-balance-paid GET render + token load (S5)"`

---

### Task 3: `handleMarkBalancePaid` (POST) — settle + bride email

**Files:** Modify `worker/src/booking/balance.ts`, `worker/src/booking/balance.test.ts`

Mirror of `handleMarkPaid` (`confirm.ts:271-294`). Deltas: guard `"confirmed"`→`"deposit_paid"`; patch `{ status: "settled", settled_at }`; bride email = "fully paid"; audit `payment.deposit-recorded`→`payment.balance-recorded`; success page text → settled.

- [ ] **Step 1: Write the failing test** (append to `balance.test.ts`)

```ts
const postReq = (t: string) => new Request("https://worker/api/booking/mark-balance-paid", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ token: t }).toString(),
});

describe("handleMarkBalancePaid (POST)", () => {
  it("transitions deposit_paid→settled, emails 'fully paid', audits, 200s", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))  // getBookingById
      .mockResolvedValueOnce(res([bookingRow({ status: "settled" })]))        // transitionBooking
      .mockResolvedValueOnce(res({ messageId: "m" }, 201))                    // Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                                   // audit
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.deposit_paid");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("settled");
    expect(patch.settled_at).toBeTruthy();
    const bride = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(bride.htmlContent).toMatch(/fully paid|all paid|settled|see you/i);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-recorded");
  });
  it("does not re-email when the booking already moved on (0-row guard)", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))
      .mockResolvedValueOnce(res([])); // lost the race
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("still 200s and logs payment.email-failed when Brevo throws post-transition", async () => {
    const t = await balanceToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))
      .mockResolvedValueOnce(res([bookingRow({ status: "settled" })]))
      .mockRejectedValueOnce(new Error("Brevo 503"))
      .mockResolvedValueOnce(res({}, 201)); // payment.email-failed audit
    const resp = await handleMarkBalancePaid(env, postReq(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const audit = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.email-failed");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/booking/balance.test.ts` → FAIL (`handleMarkBalancePaid` missing).

- [ ] **Step 3: Implement** (in `balance.ts`, mirror `confirm.ts:271-294`)

```ts
const balanceRecordedHtml = (b: ConfirmBookingRow) =>
  pageShell("Balance recorded", `<h1>Balance recorded ✓</h1><p><strong>${esc(b.bride_name)}</strong>'s booking for <strong>${esc(b.wedding_date)}</strong> is now fully paid, and she's been emailed her all-paid confirmation. You can close this tab.</p>`);

function fullyPaidEmailHtml(b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>🎉 Your balance is in — <strong>${esc(b.wedding_date)}</strong> is fully paid and all set. We can't wait to be part of your day.</p>
<p>We've received your balance of <strong>${zar(b.balance_net_cents)}</strong> (ref ${esc(b.reference)}). Nothing further is needed from you.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

export async function handleMarkBalancePaid(env: BookingBalanceEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadDepositPaidBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }
  const b = loaded.booking;
  const updated = await transitionBooking(env, b.id, "deposit_paid", { status: "settled", settled_at: new Date().toISOString() }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200);
  try {
    await brevoEmail(env, { email: b.bride_email, name: b.bride_name }, "You're all set — fully paid 🎉 · Lustique Co.", fullyPaidEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(balanceRecordedHtml(b));
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run src/booking/balance.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add worker/src/booking/balance.ts worker/src/booking/balance.test.ts && git commit -m "feat(worker): mark-balance-paid POST → settled + bride confirmation (S5)"`

---

### Task 4: `balanceSweep` — the daily cron reminder sweep

**Files:** Modify `worker/src/booking/balance.ts`, `worker/src/booking/balance.test.ts`

New logic (no S4 equivalent). Sends the bride her EFT balance reminder + Zandeline the `mark-balance-paid` link, then stamps `balance_reminder_sent_at` only on success. `now` and `fetch` injected for determinism.

- [ ] **Step 1: Write the failing test** (append to `balance.test.ts`)

```ts
// wedding 14 working days after 2026-06-15 (Mon) = 2026-07-03 (Fri); cron "today" = 2026-06-15.
const NOW = () => new Date("2026-06-15T06:00:00Z");
const dueRow = (over = {}) => bookingRow({ status: "deposit_paid", wedding_date: "2026-07-03", balance_reminder_sent_at: null, ...over });

describe("balanceSweep", () => {
  it("emails bride + Zandeline, stamps balance_reminder_sent_at, audits — for a due booking", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow()]))               // listBookingsDueForBalanceReminder
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201)) // Brevo → bride
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201)) // Brevo → Zandeline
      .mockResolvedValueOnce(res([dueRow({ balance_reminder_sent_at: "2026-06-15T06:00:00Z" })])) // transition stamp
      .mockResolvedValueOnce(res({}, 201));                 // audit sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    const bride = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(bride.to[0].email).toBe("anke@example.com");
    expect(bride.htmlContent).toContain("62000000000");        // EFT account no
    expect(bride.htmlContent).toContain("LUS-2026-111122");    // reference
    const zan = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(zan.to[0].email).toBe(env.NOTIFY_EMAIL);
    expect(zan.htmlContent).toContain("/api/booking/mark-balance-paid?token=");
    const patchUrl = f.mock.calls[3]![0] as string;
    expect(patchUrl).toContain("status=eq.deposit_paid");
    const patch = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(patch.balance_reminder_sent_at).toBeTruthy();
    const audit = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-reminder.sent");
  });
  it("skips a booking still more than 14 working days out (no emails)", async () => {
    const far = dueRow({ wedding_date: "2026-12-31" });
    const f = vi.fn().mockResolvedValueOnce(res([far])); // query only; nothing sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not stamp when the bride email fails — next run retries", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow()]))
      .mockRejectedValueOnce(new Error("Brevo 503")) // bride email fails
      .mockResolvedValueOnce(res({}, 201));           // failure audit
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    const calls = f.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("status=eq.deposit_paid") && u.includes("bookings?id="))).toBe(false); // no stamp PATCH
    const audit = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(audit.event_type).toBe("payment.balance-reminder.failed");
  });
  it("one booking's failure does not abort the others", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res([dueRow({ id: "aaaaaaaa-0000-0000-0000-000000000001" }), dueRow({ id: "bbbbbbbb-0000-0000-0000-000000000002" })]))
      .mockRejectedValueOnce(new Error("Brevo 503")) // booking 1 bride email fails
      .mockResolvedValueOnce(res({}, 201))            // booking 1 failure audit
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // booking 2 bride
      .mockResolvedValueOnce(res({ messageId: "m" }, 201)) // booking 2 Zandeline
      .mockResolvedValueOnce(res([dueRow()], 200))         // booking 2 stamp
      .mockResolvedValueOnce(res({}, 201));                // booking 2 audit sent
    await balanceSweep(env, f as unknown as typeof fetch, NOW);
    expect(f.mock.calls.length).toBe(7);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/booking/balance.test.ts` → FAIL (`balanceSweep` missing).

- [ ] **Step 3: Implement** (in `balance.ts`)

```ts
import { listBookingsDueForBalanceReminder } from "./db";
import { workingDaysBefore } from "./util";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function balanceReminderEmailHtml(env: BookingBalanceEnv, b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Your wedding on <strong>${esc(b.wedding_date)}</strong> is coming up — your remaining balance of <strong>${zar(b.balance_net_cents)}</strong> is now due. Please pay by EFT using the details below.</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Balance due</td><td><strong>${zar(b.balance_net_cents)}</strong></td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(env.EFT_BANK)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(env.EFT_ACCOUNT_NAME)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(env.EFT_ACCOUNT_NO)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(env.EFT_BRANCH_CODE)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(b.reference)}</strong> as your reference so we can match the payment. Once it reflects we'll send your all-paid confirmation.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

function balanceAdminEmailHtml(b: ConfirmBookingRow, markUrl: string): string {
  return `<p><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — balance reminder sent. She owes <strong>${zar(b.balance_net_cents)}</strong> (ref <strong>${esc(b.reference)}</strong>) by EFT.</p>
<p style="margin:1.2rem 0;"><a href="${esc(markUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the balance lands — mark received &amp; complete her booking</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the money reflects. This completes the booking and emails her the all-paid confirmation. Link valid 90 days.</p>`;
}

export async function balanceSweep(
  env: BookingBalanceEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<void> {
  const today = now();
  const windowEnd = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
  const origin = env.ALLOWED_ORIGIN || "";
  const candidates = await listBookingsDueForBalanceReminder(env, ymd(today), ymd(windowEnd), fetchImpl);
  const due = candidates.filter(
    (b) => workingDaysBefore(new Date(`${b.wedding_date}T00:00:00Z`), 14).getTime() <= today.getTime(),
  );
  for (const b of due) {
    try {
      const token = await signActionToken(b.id, new Date(today.getTime() + BALANCE_TTL_MS), env.SIGNING_SECRET, "balance");
      const markUrl = `${origin}/api/booking/mark-balance-paid?token=${encodeURIComponent(token)}`;
      await brevoEmail(env, { email: b.bride_email, name: b.bride_name }, "Your balance is due — Lustique Co.", balanceReminderEmailHtml(env, b), fetchImpl);
      await brevoEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" }, `Balance reminder sent · ${b.bride_name} · ${b.wedding_date}`, balanceAdminEmailHtml(b, markUrl), fetchImpl);
      const stamped = await transitionBooking(env, b.id, "deposit_paid", { balance_reminder_sent_at: today.toISOString() }, fetchImpl);
      if (stamped) {
        await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.sent", payload: { reference: b.reference, balanceNetCents: b.balance_net_cents } }, fetchImpl);
      }
    } catch {
      await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-reminder.failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
    }
  }
}
```

> Note for the "skips far booking" test: the 21-day DB window already excludes a 2026-12-31 wedding, but the in-code `workingDaysBefore` filter is the authoritative guard — both stop it. Keep the test asserting only the query fetch fired.

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run src/booking/balance.test.ts` → PASS (all sweep specs).

- [ ] **Step 5: Commit** — `git add worker/src/booking/balance.ts worker/src/booking/balance.test.ts && git commit -m "feat(worker): balanceSweep — 14-working-day EFT balance reminder (S5)"`

---

### Task 5: Wire routes + cron in `index.ts`

**Files:** Modify `worker/src/index.ts`

- [ ] **Step 1: Add imports** (top of `index.ts`, after the confirm import on `:4`)

```ts
import { renderMarkBalancePaidPage, handleMarkBalancePaid, balanceSweep } from "./booking/balance";
```

- [ ] **Step 2: Add the routes** (in `fetch`, after the mark-paid block ~`:136`)

```ts
// GET /api/booking/mark-balance-paid?token= — render-only balance-received page (S5, prefetch-safe)
if (req.method === "GET" && url.pathname === "/api/booking/mark-balance-paid") {
  return renderMarkBalancePaidPage(env, req);
}
// POST /api/booking/mark-balance-paid — record EFT balance → settled (S5)
if (req.method === "POST" && url.pathname === "/api/booking/mark-balance-paid") {
  return handleMarkBalancePaid(env, req);
}
```

- [ ] **Step 3: Call the sweep in `scheduled()`** (replace the body at `:201-208`)

```ts
async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    (async () => {
      await keepWarm(env);
      await writeAudit(env, { bookingId: null, eventType: "cron.keepwarm", payload: {} });
      await balanceSweep(env);
    })().catch(() => {}), // never throw out of the scheduled handler
  );
},
```

- [ ] **Step 4: Verify the whole suite + build**

Run: `cd worker && npm test` → Expected: all green (71 prior + new S5 specs).
Run: `cd worker && npx wrangler deploy --dry-run` → Expected: bundles clean, no type errors.

- [ ] **Step 5: Commit** — `git add worker/src/index.ts && git commit -m "feat(worker): wire mark-balance-paid routes + balanceSweep cron (S5)"`

---

## Verification (end-to-end)

Lean per house standard (build + grep + tests; no account access needed):

- `cd worker && npm test` → all green.
- `cd worker && npx wrangler deploy --dry-run` → clean bundle.
- `grep -n "mark-balance-paid" worker/src/index.ts` → both routes wired.
- `grep -n "balanceSweep" worker/src/index.ts` → called inside `scheduled()`.
- `grep -n '"balance"' worker/src/booking/balance.ts` → token purpose is `"balance"` (distinct from `"deposit"`).
- **Live smoke is deferred to the account-gated go-live** (cron fires → real Brevo emails → DB `deposit_paid → settled`), run alongside Phase C's smoke test — same blocked critical path, not part of S5's build verification.

## Self-Review (done at authoring)

- **Spec coverage:** balance reminder 14 working days out (Task 4) ✓ · EFT details + reference in bride email (Task 4) ✓ · settle loop `deposit_paid → settled` (Tasks 2-3) ✓ · idempotency via `balance_reminder_sent_at` guard (Task 4) ✓ · audit trail (Tasks 3-4) ✓ · cron keep-warm preserved (Task 5) ✓.
- **No placeholders:** boilerplate is "copy confirm.ts:X-Y, change A→B" with the deltas enumerated — not vague. New logic shown in full.
- **Type consistency:** `BookingBalanceEnv`, `loadDepositPaidBooking`, `renderMarkBalancePaidPage`, `handleMarkBalancePaid`, `balanceSweep`, `listBookingsDueForBalanceReminder` used consistently across tasks; token purpose `"balance"` and state `deposit_paid`/`settled` consistent throughout.
- **Idempotency edge:** stamp happens only after both emails succeed; a stamp-after-send DB failure can double-remind on the next run (rare, acceptable — better than never).
```
