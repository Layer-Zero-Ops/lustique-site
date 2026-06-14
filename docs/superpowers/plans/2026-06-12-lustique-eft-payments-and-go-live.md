# Lustique S4 — EFT Payments + Go-Live Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans for Phases A–B. Phase C is an ops runbook (mostly Pieter/Zandeline + a few `wrangler` commands), not TDD.

**Goal:** Make the EFT booking flow correct (bride is only told her date is *booked* once the deposit is *received*) and get the site live on EFT.

**Architecture:** Two payment touch-points become two distinct, payment-gated emails. (1) At Zandeline's **confirm**, the bride gets a payment *invitation* (EFT details), not a confirmation. (2) A new **mark-paid** step — a purpose-scoped, single-use signed link emailed to Zandeline at confirm — transitions `confirmed → deposit_paid` when she records the EFT, and *that* fires the bride's "your date is secured" email. This mark-paid step is exactly what Yoco's webhook will automate later (S4-v2), so it's not throwaway. Then a go-live runbook wires the worker route, secrets, Supabase, Pages, and DNS.

**Tech Stack:** TypeScript Cloudflare Worker (Web Crypto HMAC, PostgREST + injected `fetch`, Brevo), Vitest (DI-fetch, no SDK mocks), Astro static (Cloudflare Pages), Supabase.

---

## Context

**What prompted this:** S3 shipped a confirm gate whose bride email (confirm.ts:135) reads *"your date is confirmed… to secure it, pay your deposit."* Pieter's rule (2026-06-12): **the bride must only receive a "date booked" confirmation once the EFT deposit has actually been received** — not when Zandeline approves availability. The booking core (S1→S3) otherwise runs end-to-end on EFT, so the site is launch-ready once the flow is corrected and deployed. Yoco is deferred to S4-v2 (it automates the manual mark-paid step).

**The corrected EFT flow:**
1. Bride requests → `requested` (S2, unchanged).
2. Zandeline confirms availability → `confirmed`. Bride gets a **payment invitation** ("your date is available — pay your deposit by EFT to book it"). Zandeline gets a **mark-paid link** to use when the money lands. *(Phase A reword + Phase B Zandeline email.)*
3. EFT arrives → Zandeline clicks her mark-paid link → `deposit_paid`. Bride gets **"your date is secured 🎉"**. *(Phase B.)*

**Phasing / ASAP note:** Phase A (email reword) + Phase C (deploy) alone yield a *correct, launchable* EFT site where the post-payment confirmation is sent by Zandeline manually. **Phase B automates that post-payment step.** Recommended: ship A+B before launch (fully self-running). If launch pressure is high, A+C can go live first and B follows as a fast-follow — the flow is correct either way.

**Reused as-is (do not reinvent):** `signToken`/`verifyToken`/`hashToken`/`hmacHex`/`toBase64Url`/`fromBase64Url`/`timingSafeEqualHex` ([token.ts](worker/src/booking/token.ts)); `getBookingByTokenHash`/`transitionRequestedBooking`/`ConfirmBookingRow`/`CONFIRM_COLS` ([db.ts](worker/src/booking/db.ts)); `loadBooking`/`pageShell`/`esc`/`zar`/`htmlResponse`/`redirect`/`brevoEmail`/`writeAudit` ([confirm.ts](worker/src/booking/confirm.ts)). The mark-paid step mirrors the confirm step's shape exactly.

---

## File Structure

- `worker/src/booking/token.ts` *(modify)* — add `signActionToken` + `verifyActionToken` (purpose-scoped, 4-part).
- `worker/src/booking/db.ts` *(modify)* — add `getBookingById`; generalize the guard to `transitionBooking(env,id,fromStatus,patch,f)` and make `transitionRequestedBooking` a thin wrapper.
- `worker/src/booking/confirm.ts` *(modify)* — reword the bride email to an invitation; at confirm, email Zandeline the mark-paid link; add `loadConfirmedBooking` + `renderMarkPaidPage` (GET) + `handleMarkPaid` (POST) + the "date secured" email.
- `worker/src/index.ts` *(modify)* — wire `GET`+`POST /api/booking/mark-paid`.
- `worker/wrangler.toml` *(modify, Phase C)* — add the `lustiqueco.co.za/api/*` route + the `EFT_*` secret names to the comment inventory.
- `site/src/pages/booking-confirmed.astro` *(modify, small)* — copy: mention the mark-paid email Zandeline just received.
- Test files: `token.test.ts`, `db.test.ts`, `confirm.test.ts` *(modify)*.

Mark-paid lives in `confirm.ts` (reusing its private helpers) rather than a new file — keeps the diff tight and avoids extracting/duplicating the page+email helpers for launch. Revisit extraction in S4-v2 if it grows.

---

## Phase A — Reword the bride's confirm email (invitation, not confirmation)

**Files:** Modify `worker/src/booking/confirm.ts`; update `worker/src/booking/confirm.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `confirm.test.ts`:

```ts
describe("confirm email is a payment invitation (not a confirmation)", () => {
  it("invites payment without claiming the date is booked", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))                        // getBookingByTokenHash
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })])) // transition
      .mockResolvedValue(res({ messageId: "m" }, 201));                  // all emails + audit
    await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    const brideEmail = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(brideEmail.htmlContent).toMatch(/available/i);
    expect(brideEmail.htmlContent).not.toMatch(/is confirmed|date is secured|officially secure/i);
    expect(brideEmail.subject).not.toMatch(/confirmed/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd worker && npx vitest run src/booking/confirm.test.ts`) on the wording assertions.

- [ ] **Step 3: Reword `confirmEmailHtml` + its subject** in `confirm.ts`. Replace the opening line and the closing line:

```ts
function confirmEmailHtml(env: BookingConfirmEnv, b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>Wonderful news — <strong>${esc(b.wedding_date)}</strong> is available! To book your date, please pay your deposit by EFT. As soon as it reflects, we'll confirm your booking and your date is secured.</p>
<table style="border-collapse:collapse;font:15px/1.7 system-ui,sans-serif;margin:.6rem 0 1rem;">
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Deposit due</td><td><strong>${zar(b.deposit_net_cents)}</strong> (${b.deposit_pct}%)</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Bank</td><td>${esc(env.EFT_BANK)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account name</td><td>${esc(env.EFT_ACCOUNT_NAME)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Account no.</td><td>${esc(env.EFT_ACCOUNT_NO)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Branch code</td><td>${esc(env.EFT_BRANCH_CODE)}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 14px 2px 0;">Payment reference</td><td><strong>${esc(b.reference)}</strong></td></tr>
</table>
<p style="font-size:.92rem;color:#8a7d72;">Please use <strong>${esc(b.reference)}</strong> as your payment reference so we can match it to your booking. The balance of ${zar(b.balance_net_cents)} is payable closer to your day.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}
```

And change the confirm-branch subject in `handleBookingConfirm`:

```ts
        "Your date is available — secure it with your deposit · Lustique Co.", confirmEmailHtml(env, b), fetchImpl);
```

- [ ] **Step 4: Run — expect PASS.** Existing confirm tests that assert the EFT account no. + reference still pass (the table is unchanged).

- [ ] **Step 5: Commit** — `git commit -m "fix(worker): bride confirm email is a payment invitation, not a confirmation (S4)"`

---

## Phase B — Self-serve mark-paid flow (`confirmed → deposit_paid` → "date secured")

### Task B1: purpose-scoped action token (`token.ts`)

**Files:** Modify `worker/src/booking/token.ts` + `token.test.ts`.

- [ ] **Step 1: Failing tests** — append to `token.test.ts`:

```ts
import { signActionToken, verifyActionToken } from "./token";

describe("action tokens (purpose-scoped)", () => {
  const SECRET = "signing-secret";
  const ID = "11111111-2222-3333-4444-555555555555";

  it("round-trips with the matching purpose", async () => {
    const t = await signActionToken(ID, new Date(Date.now() + 60_000), SECRET, "deposit");
    const v = await verifyActionToken(t, SECRET, "deposit");
    expect(v?.bookingId).toBe(ID);
  });

  it("rejects a token verified under a different purpose", async () => {
    const t = await signActionToken(ID, new Date(Date.now() + 60_000), SECRET, "deposit");
    expect(await verifyActionToken(t, SECRET, "refund")).toBeNull();
  });

  it("a 3-part confirm token never verifies as an action token", async () => {
    const confirm = await signToken(ID, new Date(Date.now() + 60_000), SECRET);
    expect(await verifyActionToken(confirm, SECRET, "deposit")).toBeNull();
  });

  it("rejects a tampered action token", async () => {
    const t = await signActionToken(ID, new Date(Date.now() + 60_000), SECRET, "deposit");
    expect(await verifyActionToken(t + "x", SECRET, "deposit")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (functions not exported).

- [ ] **Step 3: Implement** — append to `token.ts` (reuses `hmacHex`, `toBase64Url`, `fromBase64Url`, `timingSafeEqualHex`):

```ts
/**
 * Sign a PURPOSE-scoped, single-action token (e.g. "deposit" for the EFT
 * mark-paid link). 4-part payload `purpose|booking_id|exp|hmac` — structurally
 * distinct from the 3-part confirm token, so the two can never be cross-replayed.
 */
export async function signActionToken(
  bookingId: string,
  expiresAt: Date,
  secret: string,
  purpose: string,
): Promise<string> {
  const exp = expiresAt.toISOString();
  const payload = `${purpose}|${bookingId}|${exp}`;
  const hmac = await hmacHex(payload, secret);
  return toBase64Url(`${payload}|${hmac}`);
}

/** Verify a purpose-scoped action token. Authenticity only — caller checks expiry. */
export async function verifyActionToken(
  token: string,
  secret: string,
  purpose: string,
): Promise<{ bookingId: string; expiresAt: Date } | null> {
  let decoded: string;
  try { decoded = fromBase64Url(token); } catch { return null; }
  const parts = decoded.split("|");
  if (parts.length !== 4) return null;
  const [p, bookingId, exp, mac] = parts as [string, string, string, string];
  if (p !== purpose) return null;
  const expected = await hmacHex(`${p}|${bookingId}|${exp}`, secret);
  if (!timingSafeEqualHex(mac, expected)) return null;
  const expiresAt = new Date(exp);
  if (Number.isNaN(expiresAt.getTime())) return null;
  return { bookingId, expiresAt };
}
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** — `feat(worker): purpose-scoped action tokens for mark-paid (S4)`.

### Task B2: `getBookingById` + generalized guard (`db.ts`)

**Files:** Modify `worker/src/booking/db.ts` + `db.test.ts`.

- [ ] **Step 1: Failing tests** — append to `db.test.ts`:

```ts
import { getBookingById, transitionBooking } from "./db";

describe("getBookingById", () => {
  it("selects by id and returns the row", async () => {
    const row = { id: "b1", status: "confirmed" };
    const f = vi.fn().mockResolvedValue(res([row]));
    const got = await getBookingById(dbEnv, "b1", f as unknown as typeof fetch);
    expect(got).toEqual(row);
    expect(f.mock.calls[0]![0] as string).toContain("id=eq.b1");
  });
  it("returns null when absent", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await getBookingById(dbEnv, "x", f as unknown as typeof fetch)).toBeNull();
  });
});

describe("transitionBooking (generalized guard)", () => {
  it("guards on the given fromStatus", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "b1", status: "deposit_paid" }]));
    await transitionBooking(dbEnv, "b1", "confirmed", { status: "deposit_paid" }, f as unknown as typeof fetch);
    expect(f.mock.calls[0]![0] as string).toContain("status=eq.confirmed");
  });
  it("returns null on 0-row guard miss", async () => {
    const f = vi.fn().mockResolvedValue(res([]));
    expect(await transitionBooking(dbEnv, "b1", "confirmed", { status: "deposit_paid" }, f as unknown as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `db.ts`, add `getBookingById`, add the generalized `transitionBooking`, and replace the body of `transitionRequestedBooking` with a thin wrapper (preserves its S3 callsite + tests):

```ts
/** Look a booking up by id (same columns as the confirm gate needs). */
export async function getBookingById(
  env: DbEnv,
  id: string,
  f: typeof fetch = fetch,
): Promise<ConfirmBookingRow | null> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(id)}&select=${CONFIRM_COLS}`), { headers: headers(env) });
  if (!r.ok) throw new Error(`getBookingById ${r.status}`);
  const rows = (await r.json()) as ConfirmBookingRow[];
  return rows.length ? rows[0]! : null;
}

/**
 * Guarded transition: PATCH only while status === fromStatus (atomic compare-and-set).
 * Returns the updated row, or null if 0 rows matched (already moved on).
 */
export async function transitionBooking(
  env: DbEnv,
  id: string,
  fromStatus: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const r = await f(
    rest(env, `bookings?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}`),
    { method: "PATCH", headers: { ...headers(env), prefer: "return=representation" }, body: JSON.stringify(patch) },
  );
  if (!r.ok) throw new Error(`transitionBooking ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  return rows.length ? rows[0]! : null;
}

/** S3 confirm/decline guard — now a thin wrapper over the generalized transition. */
export function transitionRequestedBooking(
  env: DbEnv,
  id: string,
  patch: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  return transitionBooking(env, id, "requested", patch, f);
}
```
(Delete the old standalone `transitionRequestedBooking` implementation.)

- [ ] **Step 4: Run — expect PASS** (existing `transitionRequestedBooking` tests still green via the wrapper). **Step 5: Commit** — `feat(worker): getBookingById + generalized transitionBooking guard (S4)`.

### Task B3: mark-paid handlers + "date secured" email + Zandeline link (`confirm.ts`)

**Files:** Modify `worker/src/booking/confirm.ts` + `confirm.test.ts`.

- [ ] **Step 1: Failing tests** — append to `confirm.test.ts` (add `renderMarkPaidPage`, `handleMarkPaid` to the import; add a `markPaidReq` helper + a token minted via `signActionToken(..., "deposit")`):

```ts
import { renderMarkPaidPage, handleMarkPaid } from "./confirm";
import { signActionToken } from "./token";

const depositToken = (ttlMs = 90 * 24 * 3600 * 1000) =>
  signActionToken(BOOKING_ID, new Date(Date.now() + ttlMs), SIGNING_SECRET, "deposit");
const markPaidGet = (t: string) => new Request(`https://worker/api/booking/mark-paid?token=${encodeURIComponent(t)}`);
const markPaidPost = (t: string) =>
  new Request("https://worker/api/booking/mark-paid", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: t }).toString(),
  });

describe("mark-paid (GET render-only)", () => {
  it("renders the deposit-received page for a confirmed booking", async () => {
    const t = await depositToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })])); // getBookingById
    const resp = await renderMarkPaidPage(env, markPaidGet(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("deposit");
    expect(html).toContain('action="/api/booking/mark-paid"');
  });
  it("shows 'already handled' if the booking isn't confirmed", async () => {
    const t = await depositToken();
    const f = vi.fn().mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]));
    const html = await (await renderMarkPaidPage(env, markPaidGet(t), f as unknown as typeof fetch)).text();
    expect(html).toContain("already");
  });
});

describe("mark-paid (POST)", () => {
  it("transitions confirmed→deposit_paid, emails the bride 'secured', 200s", async () => {
    const t = await depositToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })]))          // getBookingById
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))        // transitionBooking
      .mockResolvedValueOnce(res({ messageId: "m" }, 201))                         // Brevo → bride
      .mockResolvedValueOnce(res({}, 201));                                        // audit
    const resp = await handleMarkPaid(env, markPaidPost(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    const patchUrl = f.mock.calls[1]![0] as string;
    expect(patchUrl).toContain("status=eq.confirmed");
    const patch = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(patch.status).toBe("deposit_paid");
    expect(patch.deposit_paid_at).toBeTruthy();
    const bride = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(bride.htmlContent).toMatch(/secured|confirmed/i);
  });
  it("does not re-email if the booking already moved on (0-row guard)", async () => {
    const t = await depositToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })]))
      .mockResolvedValueOnce(res([])); // lost the race
    const resp = await handleMarkPaid(env, markPaidPost(t), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("rejects a confirm token replayed at mark-paid (wrong purpose)", async () => {
    const confirmTok = await validToken();
    const f = vi.fn();
    const resp = await handleMarkPaid(env, markPaidPost(confirmTok), f as unknown as typeof fetch);
    expect(resp.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("confirm also emails Zandeline her mark-paid link", () => {
  it("sends a 2nd email to NOTIFY_EMAIL containing /api/booking/mark-paid", async () => {
    const token = await validToken();
    const f = vi.fn()
      .mockResolvedValueOnce(res([bookingRow()]))                          // getBookingByTokenHash
      .mockResolvedValueOnce(res([bookingRow({ status: "confirmed" })]))   // transition
      .mockResolvedValue(res({ messageId: "m" }, 201));                    // bride + Zandeline + audit
    await handleBookingConfirm(env, postReq(token, "confirm"), f as unknown as typeof fetch);
    const zandeline = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(zandeline.to[0].email).toBe(env.NOTIFY_EMAIL);
    expect(zandeline.htmlContent).toContain("/api/booking/mark-paid?token=");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (handlers not exported; confirm only sends 1 email today).

- [ ] **Step 3: Implement** in `confirm.ts`:

(a) Add imports: `getBookingById, transitionBooking` from `./db`; `signActionToken, verifyActionToken` from `./token`. Add `const MARK_PAID_TTL_MS = 90 * 24 * 60 * 60 * 1000;`.

(b) In `handleBookingConfirm`'s confirm branch, after the bride invitation email, email Zandeline her mark-paid link:

```ts
      const markPaidToken = await signActionToken(b.id, new Date(Date.now() + MARK_PAID_TTL_MS), env.SIGNING_SECRET, "deposit");
      const markPaidUrl = `${origin}/api/booking/mark-paid?token=${encodeURIComponent(markPaidToken)}`;
      await brevoEmail(env, { email: env.NOTIFY_EMAIL, name: "Lustique" },
        `Confirmed — awaiting EFT · ${b.bride_name} · ${b.wedding_date}`,
        `<p><strong>${esc(b.bride_name)}</strong> — ${esc(b.wedding_date)} — confirmed. The bride has her EFT deposit details (${zar(b.deposit_net_cents)}, ref <strong>${esc(b.reference)}</strong>).</p>
<p style="margin:1.2rem 0;"><a href="${esc(markPaidUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">When the EFT lands — mark deposit received &amp; secure her date</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Only click once the deposit reflects in the account. This secures the date and emails her the confirmation. Link valid 90 days.</p>`,
        fetchImpl);
```
(Place this inside the existing `try { … }` so a Brevo failure routes to the same `confirm.email-failed` audit path.)

(c) Add the mark-paid load/render/handle functions (mirror `loadBooking`/`renderConfirmPage`/`handleBookingConfirm`):

```ts
type ConfirmedLoad =
  | { ok: true; booking: ConfirmBookingRow }
  | { ok: false; reason: "invalid" | "expired" | "handled" };

async function loadConfirmedBooking(env: BookingConfirmEnv, token: string, f: typeof fetch): Promise<ConfirmedLoad> {
  const v = await verifyActionToken(token, env.SIGNING_SECRET, "deposit");
  if (!v) return { ok: false, reason: "invalid" };
  if (v.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const booking = await getBookingById(env, v.bookingId, f);
  if (!booking) return { ok: false, reason: "invalid" };
  if (booking.status !== "confirmed") return { ok: false, reason: "handled" };
  return { ok: true, booking };
}

function markPaidPageBody(b: ConfirmBookingRow, token: string): string {
  return `<h1>Record deposit received</h1>
<p>Confirm you've received <strong>${esc(b.bride_name)}</strong>'s EFT deposit. This secures her date and emails her the confirmation.</p>
<table>
<tr><td class="k">Bride</td><td><strong>${esc(b.bride_name)}</strong></td></tr>
<tr><td class="k">Date</td><td><strong>${esc(b.wedding_date)}</strong></td></tr>
<tr><td class="k">Deposit</td><td><strong>${zar(b.deposit_net_cents)}</strong></td></tr>
<tr><td class="k">Reference</td><td>${esc(b.reference)}</td></tr>
</table>
<div class="actions">
<form method="POST" action="/api/booking/mark-paid"><input type="hidden" name="token" value="${esc(token)}"><button class="confirm" type="submit">Deposit received — secure her date</button></form>
</div>
<p class="muted" style="margin-top:1.4rem;">Only do this once the money reflects in the account.</p>`;
}

const depositRecordedHtml = (b: ConfirmBookingRow) =>
  pageShell("Deposit recorded", `<h1>Deposit recorded ✓</h1><p><strong>${esc(b.bride_name)}</strong>'s date <strong>${esc(b.wedding_date)}</strong> is now secured, and she's been emailed her confirmation. You can close this tab.</p>`);

function depositSecuredEmailHtml(b: ConfirmBookingRow): string {
  return `<p>Hi ${esc(b.bride_name)},</p>
<p>🎉 Your deposit is in and <strong>${esc(b.wedding_date)}</strong> is officially yours. We can't wait.</p>
<p>We've received <strong>${zar(b.deposit_net_cents)}</strong> (ref ${esc(b.reference)}). The balance of <strong>${zar(b.balance_net_cents)}</strong> is payable closer to your day — we'll send a reminder.</p>
<p>We'll be in touch soon to start planning the details.</p>
<p>Blessings,<br/>The Lustique Cosmetology Team</p>`;
}

/** GET — render-only deposit-received page. */
export async function renderMarkPaidPage(env: BookingConfirmEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return htmlResponse(invalidHtml(), 400);
  const loaded = await loadConfirmedBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "expired") return htmlResponse(expiredHtml(), 410);
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(invalidHtml(), 400);
  }
  return htmlResponse(pageShell("Record deposit", markPaidPageBody(loaded.booking, token)));
}

/** POST — guarded confirmed→deposit_paid, email the bride "secured". */
export async function handleMarkPaid(env: BookingConfirmEnv, req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return htmlResponse(invalidHtml(), 400);

  const loaded = await loadConfirmedBooking(env, token, fetchImpl);
  if (!loaded.ok) {
    if (loaded.reason === "handled") return htmlResponse(handledHtml(), 200);
    return htmlResponse(loaded.reason === "expired" ? expiredHtml() : invalidHtml(), loaded.reason === "expired" ? 410 : 400);
  }

  const b = loaded.booking;
  const updated = await transitionBooking(env, b.id, "confirmed", { status: "deposit_paid", deposit_paid_at: new Date().toISOString() }, fetchImpl);
  if (!updated) return htmlResponse(handledHtml(), 200); // already paid — don't email twice

  try {
    await brevoEmail(env, { email: b.bride_email, name: b.bride_name },
      "Your date is secured 🎉 · Lustique Co.", depositSecuredEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.deposit-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(depositRecordedHtml(b));
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run src/booking/confirm.test.ts`).

- [ ] **Step 5: Commit** — `feat(worker): EFT mark-paid flow → deposit_paid + bride confirmation (S4)`.

### Task B4: wire mark-paid routes (`index.ts`)

- [ ] **Step 1:** add to the import — `import { renderConfirmPage, handleBookingConfirm, renderMarkPaidPage, handleMarkPaid } from "./booking/confirm";`
- [ ] **Step 2:** after the confirm routes, add:

```ts
    // GET /api/booking/mark-paid?token= — render-only deposit-received page (S4, prefetch-safe)
    if (req.method === "GET" && url.pathname === "/api/booking/mark-paid") {
      return renderMarkPaidPage(env, req);
    }
    // POST /api/booking/mark-paid — record EFT deposit → deposit_paid (S4)
    if (req.method === "POST" && url.pathname === "/api/booking/mark-paid") {
      return handleMarkPaid(env, req);
    }
```

- [ ] **Step 3:** small copy tweak to `site/src/pages/booking-confirmed.astro` — add a line so Zandeline knows to expect the mark-paid email: e.g. *"We've emailed you a link to mark the deposit received once it lands — that's what secures her date."*
- [ ] **Step 4: Verify** — `cd worker && npx vitest run && npx wrangler deploy --dry-run --outdir /tmp/s4-dry` (all green; bundle typechecks); `cd ../site && npm run build` (26 pages).
- [ ] **Step 5: Commit** — `feat(worker): wire GET+POST /api/booking/mark-paid routes (S4)`.

---

## Phase C — Go-live runbook (EFT launch)

> **⚠️ Superseded (2026-06-13):** the authoritative go-live procedure is now
> `docs/RUNBOOK-go-live.md` (covers through S5 + the live smoke walk). This Phase C
> is kept for history only.

Mechanical `wrangler`/build steps are Sonnet-runnable; 🛑 steps are account-gated (Pieter/Zandeline). Do the account prerequisites first; they unblock the rest.

**1. Account prerequisites (🛑 Pieter/Zandeline — parallelizable):**
- **Supabase:** Zandeline creates the client-owned project (region `af-south-1`), invites `hello@layerzerostudios.com` as Administrator. Apply the migration: paste `supabase/migrations/0001_booking_core.sql` into the Supabase **SQL editor** and run (no CLI config exists). Capture the project URL + the **service-role** key.
- **Turnstile:** create a widget for `lustiqueco.co.za` → note the **site key** + **secret**.
- **Brevo:** verify `info@lustiqueco.co.za` as a sender; capture the **API key**.
- **EFT details:** Zandeline's bank name, account name, account no., branch code.
- **Cloudflare:** add `lustiqueco.co.za` (Free plan) so the zone exists (DNS migration in step 5).

**2. Worker config + secrets:**
- Create the audit bucket (one-time): `cd worker && npx wrangler r2 bucket create lustique-audit`.
- Add the route + EFT secret names to `wrangler.toml`:
  ```toml
  routes = [{ pattern = "lustiqueco.co.za/api/*", zone_name = "lustiqueco.co.za" }]
  # secrets (wrangler secret put): BREVO_API_KEY NOTIFY_EMAIL SUPABASE_URL SUPABASE_SERVICE_KEY
  #   SIGNING_SECRET TURNSTILE_SECRET EFT_BANK EFT_ACCOUNT_NAME EFT_ACCOUNT_NO EFT_BRANCH_CODE
  ```
- Set secrets (10): `wrangler secret put` for `BREVO_API_KEY`, `NOTIFY_EMAIL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SIGNING_SECRET` (random 32-byte hex), `TURNSTILE_SECRET`, `EFT_BANK`, `EFT_ACCOUNT_NAME`, `EFT_ACCOUNT_NO`, `EFT_BRANCH_CODE`. (Skip `YOCO_*` until S4-v2.) For local dev mirror these into `worker/.dev.vars` (git-ignored).
- Confirm `ALLOWED_ORIGIN = "https://lustiqueco.co.za"` in `[vars]`.

**3. Front-end config:**
- Replace the Turnstile placeholder `1x00000000000000000000AA` in `site/src/data/site.ts` with the real site key. Commit.

**4. Deploy:**
- Worker: `cd worker && npx wrangler deploy` (binds the `lustiqueco.co.za/api/*` route once the zone is active).
- Site: connect the GitHub repo to **Cloudflare Pages** (build `npm run build` in `site/`, output `dist/`); first build deploys to the Pages subdomain, then bind the apex + `www` custom domains.

**5. DNS cutover (🛑 Pieter):** point `lustiqueco.co.za` nameservers from GoDaddy → Cloudflare (registrar stays GoDaddy). Preserve the existing GoDaddy/Workspace **MX + SPF** records. Set SSL/TLS to **Full (strict)** once Pages is bound.

**6. Smoke test (live, end-to-end):**
1. Submit a real request on the live form → bride gets "request received"; Zandeline gets the confirm-link email.
2. Open the confirm link → confirm → bride gets the **invitation** email (verify it does NOT say "confirmed/secured"); Zandeline gets the **mark-paid** link email.
3. EFT a test deposit to the account; click Zandeline's mark-paid link → "Deposit recorded ✓"; bride gets **"your date is secured 🎉"**.
4. In Supabase, verify the row walked `requested → confirmed → deposit_paid` with `confirmed_at` + `deposit_paid_at` set, and `audit_log` has the matching events.
- Post-launch (deferred): Cloudflare WAF rate-limit `POST /api/booking/request` → 5/IP/hour; rotate the exposed Sanity Viewer token.

---

## Verification / Definition of Done

- `cd worker && npx vitest run` → all green (56 + ~12 new ≈ 68). Bundle typechecks (`wrangler deploy --dry-run`). `cd site && npm run build` → 26 pages.
- The bride's **confirm** email is a payment *invitation* (no "confirmed/secured"); the **mark-paid** step is the only thing that sends "your date is secured" and moves the booking to `deposit_paid`.
- Mark-paid GET is render-only; POST is guarded (`status=eq.confirmed`), single-use via the status guard, and a confirm token cannot be replayed at mark-paid (purpose mismatch → 400).
- Live smoke test walks `requested → confirmed → deposit_paid` with the three correct emails.

## Spec coverage / self-review
- **§5 state machine** — adds the `confirmed → deposit_paid` transition (spec lists it as Yoco-webhook-driven; here it's the EFT manual analog, which the spec sanctions as "out-of-band v1"). `deposit_paid_at` stamped. ✅
- **§10 emails** — Email #3 (confirmed→bride) is now correctly a payment invitation; a new deposit-secured email is the real confirmation, payment-gated per Pieter. ✅
- **§12 tokens** — mark-paid token is purpose-scoped + structurally distinct (4-part) so it can't be confused with confirm tokens; stateless single-use via the status guard. ✅
- **Type consistency** — `signActionToken`/`verifyActionToken`, `getBookingById`, `transitionBooking`, `renderMarkPaidPage`/`handleMarkPaid`, `loadConfirmedBooking` used consistently; `transitionRequestedBooking` preserved as a wrapper so S3 code + tests are untouched. ✅
- **Deploy** — runbook closes the three gaps the exploration found (no worker route, missing R2 bucket, EFT secrets absent from the checklist). ✅
