# Marketing Email System + Sign-off Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Zandeline compose and send branded promotional emails from the admin dashboard to the newsletter list or past-clients list via Brevo's Campaign API, and fix the transactional-email sign-off to match `BRAND.md`.

**Architecture:** A new HTML-builder module (`marketingEmail.ts`) reuses the existing `emailShell()` design system from `lib/email.ts`. A new `brevoCampaign.ts` module wraps Brevo's Campaign API (create + send) and contact-list upsert, kept separate from the existing transactional `sendEmail()` since campaigns and transactional sends are different Brevo APIs with different compliance behavior (campaigns auto-handle unsubscribe/suppression; transactional sends don't). A new admin route (`booking/marketing.ts`) wires the form, preview, and send flow together. The "past clients" Brevo list is populated by hooking into the three existing places a booking transitions to `settled`.

**Tech Stack:** Cloudflare Workers, TypeScript, Vitest, Brevo REST API (Campaign API `POST /v3/emailCampaigns` + `POST /v3/emailCampaigns/{id}/sendNow`, Contacts API `POST /v3/contacts`), Supabase PostgREST.

## Global Constraints

- Sign-off on all transactional/marketing emails: **"Blessings, The Lustique Cosmetology Team"** (BRAND.md, locked 1 June 2026 voice decisions).
- Marketing sends target only two audiences: the existing newsletter Brevo list, or a new past-clients Brevo list. Never raw enquiry leads (no consent mechanism exists for them yet — out of scope).
- Marketing sends use Brevo's **Campaign API**, never the transactional `sendEmail()` helper — this is what auto-attaches the required unsubscribe link and respects Brevo's suppression list.
- One flexible email preset (headline, body, optional highlight box, one CTA, optional hero image, optional promo-terms footnote) — no free-form rich text composer, no multiple fixed layouts.
- If a promo preset is referenced in a send, its `terms` string (from `shared/pricing`'s `PROMO_PRESETS`) is auto-appended as small print — never omitted.
- Every new externally-callable function takes an injectable `f: typeof fetch = fetch` param, matching the codebase-wide pattern for testability.
- No scheduling/recurring sends — every send is a manual, admin-triggered action.

---

## File Structure

- **Modify** `worker/src/lib/email.ts` — fix the sign-off line in `emailShell()`.
- **Create** `worker/src/lib/email.test.ts` — first test file for this module; covers the sign-off text.
- **Create** `worker/src/lib/brevoCampaign.ts` — `upsertBrevoContact()` (list upsert, used for past-clients sync) and `createAndSendCampaign()` (Campaign API create+send).
- **Create** `worker/src/lib/brevoCampaign.test.ts`
- **Modify** `worker/src/booking/db.ts` — add `listSettledBookingEmails()` (feeds the past-clients backfill).
- **Create** `worker/src/lib/marketingEmail.ts` — `marketingEmailHtml()`, the single flexible preset builder.
- **Create** `worker/src/lib/marketingEmail.test.ts`
- **Modify** `worker/src/booking/balance.ts` — call the past-clients sync when a booking settles via EFT.
- **Modify** `worker/src/booking/yoco.ts` — same, for the Yoco-paid settle path.
- **Modify** `worker/src/booking/admin-actions.ts` — same, for the manual "mark balance paid" admin action.
- **Create** `worker/src/booking/marketing.ts` — the admin route: `GET` (form), `POST` with `intent=preview`, `POST` with `intent=send`, and `POST /api/admin/marketing/sync-past-clients` (backfill).
- **Create** `worker/src/booking/marketing.test.ts`
- **Modify** `worker/src/booking/dashboard.ts` — add "Marketing" nav link.
- **Modify** `worker/src/index.ts` — register the two new routes.
- **Modify** `site/.env.local.example` / wrangler secrets doc comment — document the new `BREVO_PAST_CLIENTS_LIST_ID` secret (mirrors the existing `BREVO_NEWSLETTER_LIST_ID` comment in `newsletter.ts`).

---

### Task 1: Fix the transactional email sign-off

**Files:**
- Modify: `worker/src/lib/email.ts:128`
- Test: `worker/src/lib/email.test.ts` (new file)

**Interfaces:**
- Produces: no signature change — `emailShell()` keeps the same params, only its rendered output changes.

- [ ] **Step 1: Write the failing test**

Create `worker/src/lib/email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emailShell } from "./email";

describe("emailShell", () => {
  it("signs off with the BRAND.md-mandated line, not the old 'Lustique Co.' only", () => {
    const html = emailShell({ heading: "Test", body: "<p>body</p>", btnZone: "<a>go</a>" });
    expect(html).toContain("Blessings, The Lustique Cosmetology Team");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/lib/email.test.ts`
Expected: FAIL — `expect(received).toContain(expected)` — received does not contain "Blessings, The Lustique Cosmetology Team".

- [ ] **Step 3: Fix the sign-off line**

In `worker/src/lib/email.ts`, find this line inside `emailShell()`:

```ts
<p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#5C4332;">Lustique Co.</p>
```

Replace with:

```ts
<p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#5C4332;">Blessings,<br>The Lustique Cosmetology Team</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/lib/email.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full worker suite to confirm no snapshot/string-matching test broke**

Run: `cd worker && npx vitest run`
Expected: all existing tests still PASS (no test currently asserts the old "Lustique Co." sign-off text specifically — if one does, update its expectation to match the new sign-off).

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/email.ts worker/src/lib/email.test.ts
git commit -m "fix(email): sign off with BRAND.md-mandated line on all transactional emails"
```

---

### Task 2: Brevo Campaign + contact-upsert helper

**Files:**
- Create: `worker/src/lib/brevoCampaign.ts`
- Test: `worker/src/lib/brevoCampaign.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `upsertBrevoContact(env: { BREVO_API_KEY: string }, email: string, listId: number, f?: typeof fetch): Promise<void>`
  - `createAndSendCampaign(env: { BREVO_API_KEY: string }, opts: { subject: string; htmlContent: string; listId: number; senderEmail: string; senderName?: string }, f?: typeof fetch): Promise<{ id: number }>`
  - Both throw on any non-2xx response (except `upsertBrevoContact` treating `204` as success, matching Brevo's "already exists" response).

- [ ] **Step 1: Write the failing tests**

Create `worker/src/lib/brevoCampaign.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { upsertBrevoContact, createAndSendCampaign } from "./brevoCampaign";

const env = { BREVO_API_KEY: "brevo-key" };

describe("upsertBrevoContact", () => {
  it("POSTs to /v3/contacts with the email, listId, and updateEnabled", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 201 }));
    await upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    expect(init.headers["api-key"]).toBe("brevo-key");
    expect(JSON.parse(init.body as string)).toEqual({ email: "bride@example.com", listIds: [42], updateEnabled: true });
  });

  it("treats 204 (already exists) as success", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("throws on a non-2xx, non-204 response", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    await expect(upsertBrevoContact(env, "bride@example.com", 42, f as unknown as typeof fetch)).rejects.toThrow(/400/);
  });
});

describe("createAndSendCampaign", () => {
  it("creates the campaign then sends it, returning the campaign id", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await createAndSendCampaign(
      env,
      { subject: "A summer offer", htmlContent: "<p>hi</p>", listId: 42, senderEmail: "info@lustiqueco.co.za" },
      f as unknown as typeof fetch,
    );

    expect(result).toEqual({ id: 7 });
    expect(f).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = f.mock.calls[0]!;
    expect(createUrl).toBe("https://api.brevo.com/v3/emailCampaigns");
    const createBody = JSON.parse(createInit.body as string);
    expect(createBody.subject).toBe("A summer offer");
    expect(createBody.recipients).toEqual({ listIds: [42] });
    const [sendUrl] = f.mock.calls[1]!;
    expect(sendUrl).toBe("https://api.brevo.com/v3/emailCampaigns/7/sendNow");
  });

  it("throws if campaign creation fails, without attempting to send", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(createAndSendCampaign(
      env, { subject: "x", htmlContent: "<p/>", listId: 1, senderEmail: "a@b.com" }, f as unknown as typeof fetch,
    )).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledOnce();
  });

  it("throws if send fails after successful creation", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 9 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("send failed", { status: 500 }));
    await expect(createAndSendCampaign(
      env, { subject: "x", htmlContent: "<p/>", listId: 1, senderEmail: "a@b.com" }, f as unknown as typeof fetch,
    )).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/brevoCampaign.test.ts`
Expected: FAIL — `Cannot find module './brevoCampaign'`.

- [ ] **Step 3: Implement**

Create `worker/src/lib/brevoCampaign.ts`:

```ts
/**
 * Brevo Campaign API (marketing sends) + contact-list upsert — kept separate from the
 * transactional sendEmail() in email.ts because they're different Brevo APIs with different
 * compliance behavior: campaigns auto-attach the required unsubscribe link and respect Brevo's
 * suppression list; the transactional API does neither. Never send bulk marketing mail through
 * sendEmail() — this module is the only correct path for that.
 */

export interface BrevoEnv {
  BREVO_API_KEY: string;
}

/** Add (or update) a contact on a Brevo list. 201 = created, 204 = already existed — both OK. */
export async function upsertBrevoContact(
  env: BrevoEnv,
  email: string,
  listId: number,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, listIds: [listId], updateEnabled: true }),
  });
  if (!r.ok && r.status !== 204) {
    throw new Error(`Brevo contact upsert ${r.status}: ${await r.text()}`);
  }
}

export interface CampaignOpts {
  subject: string;
  htmlContent: string;
  listId: number;
  senderEmail: string;
  senderName?: string;
}

/** Create a classic campaign targeting one list, then send it immediately. Returns the campaign id. */
export async function createAndSendCampaign(
  env: BrevoEnv,
  opts: CampaignOpts,
  f: typeof fetch = fetch,
): Promise<{ id: number }> {
  const createRes = await f("https://api.brevo.com/v3/emailCampaigns", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      name: `${opts.subject} — ${new Date().toISOString().slice(0, 10)}`,
      subject: opts.subject,
      sender: { name: opts.senderName ?? "Lustique Co.", email: opts.senderEmail },
      type: "classic",
      htmlContent: opts.htmlContent,
      recipients: { listIds: [opts.listId] },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Brevo campaign create ${createRes.status}: ${await createRes.text()}`);
  }
  const { id } = (await createRes.json()) as { id: number };

  const sendRes = await f(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, accept: "application/json" },
  });
  if (!sendRes.ok) {
    throw new Error(`Brevo campaign send ${sendRes.status}: ${await sendRes.text()}`);
  }
  return { id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/brevoCampaign.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/brevoCampaign.ts worker/src/lib/brevoCampaign.test.ts
git commit -m "feat(email): add Brevo Campaign API + contact-upsert helper"
```

---

### Task 3: `listSettledBookingEmails` — feeds the past-clients backfill

**Files:**
- Modify: `worker/src/booking/db.ts`
- Test: `worker/src/booking/db.test.ts` (create if it doesn't already exist — check first: `ls worker/src/booking/db.test.ts`)

**Interfaces:**
- Consumes: `DbEnv`, `rest()`, `headers()` (all already defined earlier in `db.ts`).
- Produces: `listSettledBookingEmails(env: DbEnv, f?: typeof fetch): Promise<Array<{ bride_email: string; bride_name: string }>>`

- [ ] **Step 1: Check whether `worker/src/booking/db.test.ts` already exists**

Run: `ls worker/src/booking/db.test.ts`

If it exists, read it first and add the new `describe` block to it in Step 2 rather than creating a new file. If it doesn't exist, create it fresh in Step 2.

- [ ] **Step 2: Write the failing test**

Add to (or create) `worker/src/booking/db.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listSettledBookingEmails } from "./db";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_KEY: "svc-key" };

describe("listSettledBookingEmails", () => {
  it("queries settled bookings and returns bride email + name", async () => {
    const rows = [
      { bride_email: "anke@example.com", bride_name: "Anke van der Berg" },
      { bride_email: "zanele@example.com", bride_name: "Zanele Nkosi" },
    ];
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await listSettledBookingEmails(env, f as unknown as typeof fetch);
    expect(result).toEqual(rows);
    const [url] = f.mock.calls[0]!;
    expect(url).toContain("bookings?status=eq.settled");
    expect(url).toContain("select=bride_email,bride_name");
  });

  it("throws on a non-2xx response", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("error", { status: 500 }));
    await expect(listSettledBookingEmails(env, f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd worker && npx vitest run src/booking/db.test.ts`
Expected: FAIL — `listSettledBookingEmails is not a function` (or `Cannot find module` if this is a new file — in that case, temporarily this is the whole file's only test and it will fail to import).

- [ ] **Step 4: Implement**

Add to `worker/src/booking/db.ts` (near the other `list*` functions, e.g. after `listBookingsDueForBalanceReminder`):

```ts
/** All settled bookings' bride contact info — feeds the past-clients Brevo list backfill. */
export async function listSettledBookingEmails(
  env: DbEnv,
  f: typeof fetch = fetch,
): Promise<Array<{ bride_email: string; bride_name: string }>> {
  const r = await f(rest(env, "bookings?status=eq.settled&select=bride_email,bride_name"), { headers: headers(env) });
  if (!r.ok) throw new Error(`listSettledBookingEmails ${r.status}`);
  return (await r.json()) as Array<{ bride_email: string; bride_name: string }>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd worker && npx vitest run src/booking/db.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add worker/src/booking/db.ts worker/src/booking/db.test.ts
git commit -m "feat(db): add listSettledBookingEmails for the past-clients Brevo sync"
```

---

### Task 4: `marketingEmailHtml` — the single flexible preset

**Files:**
- Create: `worker/src/lib/marketingEmail.ts`
- Test: `worker/src/lib/marketingEmail.test.ts`

**Interfaces:**
- Consumes: `esc`, `ep`, `emailBtn`, `emailNote`, `emailShell`, `emailTable` from `./email` (all already exist — see `worker/src/lib/email.ts`); `getPromoPreset` from `@lustique/pricing` (already exists — see `shared/pricing/src/promoPresets.ts`, returns `PromoPreset | undefined` with a `.terms: string` field).
- Produces: `marketingEmailHtml(input: MarketingEmailInput): string` and the exported `MarketingEmailInput` interface, both consumed by Task 6 (`booking/marketing.ts`).

- [ ] **Step 1: Write the failing tests**

Create `worker/src/lib/marketingEmail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { marketingEmailHtml } from "./marketingEmail";

describe("marketingEmailHtml", () => {
  it("renders headline, paragraphs, and CTA", () => {
    const html = marketingEmailHtml({
      headline: "Now booking 2027",
      paragraphs: ["We have a few dates left.", "Reach out before they're gone."],
      ctaLabel: "Get your quote",
      ctaHref: "https://lustiqueco.co.za/quote.html",
    });
    expect(html).toContain("Now booking 2027");
    expect(html).toContain("We have a few dates left.");
    expect(html).toContain("Reach out before they");
    expect(html).toContain("Get your quote");
    expect(html).toContain("https://lustiqueco.co.za/quote.html");
    expect(html).toContain("Blessings, The Lustique Cosmetology Team".replace(",", ",")); // sign-off inherited from emailShell
  });

  it("escapes admin-entered text (no raw HTML injection from form fields)", () => {
    const html = marketingEmailHtml({
      headline: "<script>alert(1)</script>",
      paragraphs: ["<img src=x onerror=alert(1)>"],
      ctaLabel: "Go",
      ctaHref: "https://example.com",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("includes the optional highlight box when given", () => {
    const html = marketingEmailHtml({
      headline: "Off-peak offer",
      paragraphs: ["Marry in winter and save."],
      highlight: { label: "Save", value: "R1,000" },
      ctaLabel: "See pricing",
      ctaHref: "https://lustiqueco.co.za/pricing.html",
    });
    expect(html).toContain("Save");
    expect(html).toContain("R1,000");
  });

  it("omits the highlight box when not given", () => {
    const html = marketingEmailHtml({
      headline: "Simple note",
      paragraphs: ["Just checking in."],
      ctaLabel: "Visit",
      ctaHref: "https://lustiqueco.co.za",
    });
    expect(html).not.toContain('style="margin:0;font-size:10px'); // no stray table markup
  });

  it("includes the hero image when given", () => {
    const html = marketingEmailHtml({
      headline: "New looks",
      paragraphs: ["Check out our latest work."],
      ctaLabel: "View",
      ctaHref: "https://lustiqueco.co.za/portfolio.html",
      heroImage: "https://lustiqueco.co.za/assets/promo.jpg",
    });
    expect(html).toContain("https://lustiqueco.co.za/assets/promo.jpg");
  });

  it("appends the referenced promo's terms as a footnote", () => {
    const html = marketingEmailHtml({
      headline: "Weekday wonders",
      paragraphs: ["Say I do on a weekday."],
      ctaLabel: "Book now",
      ctaHref: "https://lustiqueco.co.za/quote.html",
      promoId: "weekday-wonders",
    });
    expect(html).toContain("destination weddings");
    expect(html.toLowerCase()).toContain("terms:");
  });

  it("omits the terms footnote when no promoId is given", () => {
    const html = marketingEmailHtml({
      headline: "Just a note",
      paragraphs: ["Hello."],
      ctaLabel: "Visit",
      ctaHref: "https://lustiqueco.co.za",
    });
    expect(html.toLowerCase()).not.toContain("terms:");
  });

  it("silently omits the footnote if an unknown promoId is passed (never throws on bad input)", () => {
    expect(() => marketingEmailHtml({
      headline: "x", paragraphs: ["y"], ctaLabel: "z", ctaHref: "https://a.com", promoId: "does-not-exist",
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/lib/marketingEmail.test.ts`
Expected: FAIL — `Cannot find module './marketingEmail'`.

- [ ] **Step 3: Implement**

Create `worker/src/lib/marketingEmail.ts`:

```ts
import { esc, ep, emailBtn, emailNote, emailShell, emailTable } from "./email";
import { getPromoPreset } from "@lustique/pricing";

export interface MarketingEmailInput {
  headline: string;
  /** Plain text, one entry per paragraph — escaped internally, so pass raw admin-entered text. */
  paragraphs: string[];
  highlight?: { label: string; value: string };
  ctaLabel: string;
  ctaHref: string;
  /** Absolute image URL — marketing sends aren't build-time, so this can't be a local astro:assets import. */
  heroImage?: string;
  /** One of shared/pricing's PROMO_PRESETS ids — when given, its `terms` is appended as small print. */
  promoId?: string;
}

/**
 * The one flexible marketing preset (see docs/superpowers/specs/2026-07-03-lustique-marketing-email-design.md
 * §4): copy changes per send, layout and brand styling never do. Built from the same emailShell()
 * components every transactional email uses, so a promo send looks like it belongs to the same brand.
 */
export function marketingEmailHtml(input: MarketingEmailInput): string {
  const heroHtml = input.heroImage
    ? `<img src="${esc(input.heroImage)}" alt="" width="424" style="display:block;width:100%;max-width:424px;height:auto;border-radius:8px;margin:0 0 24px;" />`
    : "";
  const bodyHtml = input.paragraphs.map((p) => ep(esc(p))).join("");
  const highlightHtml = input.highlight
    ? emailTable([{ key: input.highlight.label, val: input.highlight.value, bold: true }])
    : "";
  const promo = input.promoId ? getPromoPreset(input.promoId) : undefined;
  const termsHtml = promo ? `<div style="margin-top:18px;">${emailNote(`Terms: ${esc(promo.terms)}`)}</div>` : "";

  return emailShell({
    heading: esc(input.headline),
    body: heroHtml + bodyHtml + highlightHtml,
    btnZone: emailBtn(input.ctaHref, input.ctaLabel) + termsHtml,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/lib/marketingEmail.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/marketingEmail.ts worker/src/lib/marketingEmail.test.ts
git commit -m "feat(email): add the single flexible marketing-email preset builder"
```

---

### Task 5: Wire the past-clients sync into the three `settled` transition points

**Files:**
- Modify: `worker/src/booking/balance.ts` (around line 131, the `handleMarkBalancePaid` function)
- Modify: `worker/src/booking/yoco.ts` (around line 282, inside the webhook handler's `isBalance` branch)
- Modify: `worker/src/booking/admin-actions.ts` (around line 397, `handleAdminMarkBalancePaid`)
- Test: extend `worker/src/booking/balance.test.ts`, `worker/src/booking/yoco.test.ts`, `worker/src/booking/admin-actions.test.ts` (all already exist)

**Interfaces:**
- Consumes: `upsertBrevoContact` from `../lib/brevoCampaign` (Task 2).
- Produces: no new exported function — this task only adds a fire-and-forget call at each of the three existing settle points, matching the existing Wave-accounting try/catch/audit pattern already used at each site.

Each site needs a new env field `BREVO_PAST_CLIENTS_LIST_ID?: string` — optional, so it degrades gracefully (skip the sync) if unset, matching how `WAVE_API_KEY` etc. are optional elsewhere.

- [ ] **Step 1: Write the failing test for `balance.ts`**

Open `worker/src/booking/balance.test.ts` and find the existing test block starting `describe("handleMarkBalancePaid (POST)"`. Add this test inside that `describe`:

```ts
it("syncs the bride to the past-clients Brevo list when BREVO_PAST_CLIENTS_LIST_ID is set", async () => {
  const t = await balanceToken();
  const f = vi.fn()
    .mockResolvedValueOnce(res([bookingRow()]))       // loadDepositPaidBooking's getBookingById-equivalent lookup
    .mockResolvedValueOnce(res([bookingRow({ status: "settled" })])) // transitionBooking
    .mockResolvedValueOnce(new Response(null, { status: 201 }))       // upsertBrevoContact
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))       // sendEmail (fully-paid email)
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));      // writeAudit's insertAudit POST
  const envWithList = { ...env, BREVO_PAST_CLIENTS_LIST_ID: "99" };
  const resp = await handleMarkBalancePaid(envWithList, postReq(t), f as unknown as typeof fetch);
  expect(resp.status).toBe(200);
  const brevoContactCall = f.mock.calls.find(([url]) => url === "https://api.brevo.com/v3/contacts");
  expect(brevoContactCall).toBeTruthy();
});
```

Note: read the existing tests just above this new one first (in the same file) to confirm the exact mock-call order `handleMarkBalancePaid` already expects (loadDepositPaidBooking's internal fetch, then `transitionBooking`, then Wave if configured, then `sendEmail`, then `writeAudit`'s `insertAudit`) — adjust the `mockResolvedValueOnce` sequence above to match if it differs, since Wave calls are skipped here (the test `env` has no `WAVE_API_KEY`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/booking/balance.test.ts`
Expected: FAIL — the new test's `brevoContactCall` assertion fails (`undefined` is not truthy) since nothing calls `/v3/contacts` yet.

- [ ] **Step 3: Implement in `balance.ts`**

In `worker/src/booking/balance.ts`, find the `BookingBalanceEnv` interface (or equivalent env type used by `handleMarkBalancePaid` — check the top of the file for its exact name) and add:

```ts
BREVO_PAST_CLIENTS_LIST_ID?: string;
```

Add the import at the top of the file:

```ts
import { upsertBrevoContact } from "../lib/brevoCampaign";
```

In `handleMarkBalancePaid`, right after the existing `try { await sendEmail(...) ... } catch { ... }` block for the "fully paid" email (around line 152), add:

```ts
  if (env.BREVO_PAST_CLIENTS_LIST_ID) {
    const listId = parseInt(env.BREVO_PAST_CLIENTS_LIST_ID, 10);
    if (listId) {
      upsertBrevoContact(env, b.bride_email, listId, fetchImpl).catch(() => {
        writeAudit(env, { bookingId: b.id, eventType: "marketing.past-client-sync-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
      });
    }
  }
```

This is fire-and-forget (not awaited before the response) since it's a nice-to-have sync, not something that should ever delay or fail the bride-facing balance confirmation.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/booking/balance.test.ts`
Expected: PASS

- [ ] **Step 5: Repeat the same pattern for `yoco.ts`**

Read `worker/src/booking/yoco.ts` around line 282–320 (the `isBalance` branch of the webhook handler) first, to see its exact env interface name and the existing `sendEmail`/`writeAudit` call shape there. Add:
- `BREVO_PAST_CLIENTS_LIST_ID?: string` to its env interface.
- The same `import { upsertBrevoContact } from "../lib/brevoCampaign";` (or reuse if `yoco.ts` already imports from `../lib/brevoCampaign` after Task 2 — it won't yet).
- Inside the `if (booking) { ... }` block, only when `kind === "balance"` (i.e. only on the settle path, not the deposit path), add the same fire-and-forget sync call as Step 3, using `booking.bride_email` and `booking.id` in place of `b.bride_email`/`b.id`.

Write the corresponding test in `worker/src/booking/yoco.test.ts` first (find the existing test for the balance-webhook success path, copy its mock setup, add `BREVO_PAST_CLIENTS_LIST_ID` to its env, add one more `mockResolvedValueOnce(new Response(null, { status: 201 }))` in the right sequence position, then assert a call to `https://api.brevo.com/v3/contacts` occurred) — following the same fail-then-pass TDD cycle as Steps 1–4.

- [ ] **Step 6: Run yoco tests to verify they pass**

Run: `cd worker && npx vitest run src/booking/yoco.test.ts`
Expected: PASS

- [ ] **Step 7: Repeat the same pattern for `admin-actions.ts`**

Read `worker/src/booking/admin-actions.ts` around line 397–420 (`handleAdminMarkBalancePaid`) first. Add the same env field, import, and fire-and-forget sync call after its existing `sendEmail`/`writeAudit` block. Write the corresponding test in `worker/src/booking/admin-actions.test.ts` following the same TDD cycle.

- [ ] **Step 8: Run admin-actions tests to verify they pass**

Run: `cd worker && npx vitest run src/booking/admin-actions.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full worker suite**

Run: `cd worker && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add worker/src/booking/balance.ts worker/src/booking/balance.test.ts \
        worker/src/booking/yoco.ts worker/src/booking/yoco.test.ts \
        worker/src/booking/admin-actions.ts worker/src/booking/admin-actions.test.ts
git commit -m "feat(email): sync settled bookings' brides to the past-clients Brevo list"
```

---

### Task 6: Admin route — `booking/marketing.ts`

**Files:**
- Create: `worker/src/booking/marketing.ts`
- Test: `worker/src/booking/marketing.test.ts`

**Interfaces:**
- Consumes:
  - `getAdminSession(req, env, f)` from `./auth` — returns `AdminUser | null` (see `worker/src/booking/auth.ts:103`).
  - `AuthEnv` interface from `./auth` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`).
  - `ShellFn` type from `./enquiries` (`(title: string, user: AdminUser, inner: string, currentPath?: string) => string`).
  - `writeAudit`, `AuditEnv` from `./audit`.
  - `listSettledBookingEmails` from `./db` (Task 3).
  - `upsertBrevoContact`, `createAndSendCampaign` from `../lib/brevoCampaign` (Task 2).
  - `marketingEmailHtml`, `MarketingEmailInput` from `../lib/marketingEmail` (Task 4).
  - `PROMO_PRESETS` from `@lustique/pricing`.
- Produces:
  - `handleAdminMarketing(req: Request, env: MarketingEnv, shell: ShellFn, f?: typeof fetch): Promise<Response>` — `GET` (form) and `POST` (with `intent=preview` or `intent=send`).
  - `handleAdminMarketingSyncPastClients(req: Request, env: MarketingEnv, f?: typeof fetch): Promise<Response>` — `POST` only, the backfill action.
  - `export interface MarketingEnv extends AuthEnv, AuditEnv { BREVO_API_KEY: string; BREVO_NEWSLETTER_LIST_ID?: string; BREVO_PAST_CLIENTS_LIST_ID?: string; NOTIFY_EMAIL: string; }`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/booking/marketing.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleAdminMarketing, handleAdminMarketingSyncPastClients } from "./marketing";
import { AUTH_COOKIE } from "./auth";

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: "test-secret",
  BREVO_API_KEY: "brevo-key",
  BREVO_NEWSLETTER_LIST_ID: "10",
  BREVO_PAST_CLIENTS_LIST_ID: "20",
  NOTIFY_EMAIL: "info@lustiqueco.co.za",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const shell = (title: string, _user: unknown, inner: string) => `<html><title>${title}</title>${inner}</html>`;

function authedGet(path = "https://x/api/admin/marketing") {
  return new Request(path, { headers: { Cookie: `${AUTH_COOKIE}=tok` } });
}
function authedPost(body: URLSearchParams, path = "https://x/api/admin/marketing") {
  return new Request(path, {
    method: "POST",
    headers: { Cookie: `${AUTH_COOKIE}=tok`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}
function authOkResponses() {
  return [
    new Response(JSON.stringify({ id: "u1", email: "zandeline@lustiqueco.co.za" }), { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify([{ role: "admin", full_name: "Zandeline" }]), { status: 200, headers: { "content-type": "application/json" } }),
  ] as const;
}

describe("handleAdminMarketing — GET", () => {
  it("redirects to login when there's no session", async () => {
    const f = vi.fn();
    const res = await handleAdminMarketing(new Request("https://x/api/admin/marketing"), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("renders the form with audience options and the promo dropdown", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const res = await handleAdminMarketing(authedGet(), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("Newsletter");
    expect(html).toContain("Past clients");
    expect(html).toContain("Weekday Wonders"); // a PROMO_PRESETS name, confirming the dropdown is populated
  });
});

describe("handleAdminMarketing — POST intent=preview", () => {
  it("re-renders the form with a rendered preview and a Send Now button, without calling Brevo", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const body = new URLSearchParams({
      intent: "preview", audience: "newsletter", subject: "Test subject",
      headline: "Test headline", bodyText: "Paragraph one.", ctaLabel: "Go", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html).toContain("Test headline");
    expect(html).toContain("Send Now");
    expect(f).toHaveBeenCalledTimes(2); // only the two auth calls — no Brevo call yet
  });
});

describe("handleAdminMarketing — POST intent=send", () => {
  it("builds the email, sends via Brevo Campaign API to the newsletter list, and audits", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 55 }), { status: 201, headers: { "content-type": "application/json" } })) // campaign create
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // campaign sendNow
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // writeAudit's insertAudit

    const body = new URLSearchParams({
      intent: "send", audience: "newsletter", subject: "Test subject",
      headline: "Test headline", bodyText: "Paragraph one.", ctaLabel: "Go", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("sent=1");
    const campaignCreateCall = f.mock.calls.find(([url]) => url === "https://api.brevo.com/v3/emailCampaigns");
    expect(campaignCreateCall).toBeTruthy();
    const [, createInit] = campaignCreateCall!;
    const createBody = JSON.parse(createInit.body as string);
    expect(createBody.recipients).toEqual({ listIds: [10] }); // BREVO_NEWSLETTER_LIST_ID from env
  });

  it("targets the past-clients list id when audience=past-clients", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 56 }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const body = new URLSearchParams({
      intent: "send", audience: "past-clients", subject: "Refer a friend",
      headline: "Bring your bestie", bodyText: "Refer a friend and you both save.", ctaLabel: "Refer now", ctaHref: "https://lustiqueco.co.za",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    const campaignCreateCall = f.mock.calls.find(([url]) => url === "https://api.brevo.com/v3/emailCampaigns");
    const [, createInit] = campaignCreateCall!;
    expect(JSON.parse(createInit.body as string).recipients).toEqual({ listIds: [20] });
  });

  it("surfaces a Brevo failure as a visible error, not a silent redirect", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response("Brevo down", { status: 500 }));
    const body = new URLSearchParams({
      intent: "send", audience: "newsletter", subject: "x", headline: "x", bodyText: "x", ctaLabel: "x", ctaHref: "https://a.com",
    });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(res.status).toBe(200); // re-renders the form with an error, doesn't redirect as if it succeeded
    expect(html.toLowerCase()).toContain("error");
  });

  it("rejects an empty required field with a 400-equivalent re-render, no Brevo call", async () => {
    const f = vi.fn().mockResolvedValueOnce(authOkResponses()[0]).mockResolvedValueOnce(authOkResponses()[1]);
    const body = new URLSearchParams({ intent: "send", audience: "newsletter", subject: "", headline: "", bodyText: "", ctaLabel: "", ctaHref: "" });
    const res = await handleAdminMarketing(authedPost(body), env, shell, f as unknown as typeof fetch);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("required");
    expect(f).toHaveBeenCalledTimes(2); // only auth — never reached Brevo
  });
});

describe("handleAdminMarketingSyncPastClients", () => {
  it("upserts every settled booking's bride email into the past-clients list", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(authOkResponses()[0])
      .mockResolvedValueOnce(authOkResponses()[1])
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { bride_email: "a@example.com", bride_name: "A" },
        { bride_email: "b@example.com", bride_name: "B" },
      ]), { status: 200, headers: { "content-type": "application/json" } })) // listSettledBookingEmails
      .mockResolvedValueOnce(new Response(null, { status: 201 })) // upsert a
      .mockResolvedValueOnce(new Response(null, { status: 201 })); // upsert b

    const req = new Request("https://x/api/admin/marketing/sync-past-clients", { method: "POST", headers: { Cookie: `${AUTH_COOKIE}=tok` } });
    const res = await handleAdminMarketingSyncPastClients(req, env, f as unknown as typeof fetch);
    expect(res.status).toBe(302);
    const contactCalls = f.mock.calls.filter(([url]) => url === "https://api.brevo.com/v3/contacts");
    expect(contactCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/booking/marketing.test.ts`
Expected: FAIL — `Cannot find module './marketing'`.

- [ ] **Step 3: Implement**

Create `worker/src/booking/marketing.ts`:

```ts
import { getAdminSession, type AuthEnv } from "./auth";
import type { ShellFn } from "./enquiries";
import { writeAudit, type AuditEnv } from "./audit";
import { listSettledBookingEmails, type DbEnv } from "./db";
import { upsertBrevoContact, createAndSendCampaign } from "../lib/brevoCampaign";
import { marketingEmailHtml } from "../lib/marketingEmail";
import { PROMO_PRESETS } from "@lustique/pricing";

export interface MarketingEnv extends AuthEnv, AuditEnv, DbEnv {
  BREVO_API_KEY: string;
  BREVO_NEWSLETTER_LIST_ID?: string;
  BREVO_PAST_CLIENTS_LIST_ID?: string;
  NOTIFY_EMAIL: string;
}

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));

const RETURN = "/api/admin/marketing";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

interface FormFields {
  audience: string;
  subject: string;
  headline: string;
  bodyText: string;
  ctaLabel: string;
  ctaHref: string;
  promoId: string;
  highlightLabel: string;
  highlightValue: string;
  heroImage: string;
}

function readFields(form: FormData): FormFields {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    audience: s("audience"), subject: s("subject"), headline: s("headline"), bodyText: s("bodyText"),
    ctaLabel: s("ctaLabel"), ctaHref: s("ctaHref"), promoId: s("promoId"),
    highlightLabel: s("highlightLabel"), highlightValue: s("highlightValue"), heroImage: s("heroImage"),
  };
}

function validate(fields: FormFields): string[] {
  const errors: string[] = [];
  if (!["newsletter", "past-clients"].includes(fields.audience)) errors.push("Choose an audience.");
  if (!fields.subject) errors.push("Subject is required.");
  if (!fields.headline) errors.push("Headline is required.");
  if (!fields.bodyText) errors.push("Body is required.");
  if (!fields.ctaLabel) errors.push("CTA label is required.");
  if (!fields.ctaHref) errors.push("CTA link is required.");
  return errors;
}

function buildHtml(fields: FormFields): string {
  return marketingEmailHtml({
    headline: fields.headline,
    paragraphs: fields.bodyText.split(/\n\n+/).filter((p) => p.trim()),
    ctaLabel: fields.ctaLabel,
    ctaHref: fields.ctaHref,
    highlight: fields.highlightLabel && fields.highlightValue ? { label: fields.highlightLabel, value: fields.highlightValue } : undefined,
    heroImage: fields.heroImage || undefined,
    promoId: fields.promoId || undefined,
  });
}

function formHtml(fields: Partial<FormFields>, opts: { errors?: string[]; previewHtml?: string; savedMsg?: string } = {}): string {
  const v = (k: keyof FormFields) => esc(fields[k] ?? "");
  const promoOptions = [`<option value="">— none —</option>`, ...PROMO_PRESETS.map((p) => `<option value="${esc(p.id)}" ${fields.promoId === p.id ? "selected" : ""}>${esc(p.name)}</option>`)].join("");
  const errorHtml = opts.errors?.length
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;border:1px solid #f5b5b5;color:#8a3a3a;font-size:.88rem;">Error: ${opts.errors.map(esc).join(" ")}</div>`
    : "";
  const savedHtml = opts.savedMsg
    ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ ${esc(opts.savedMsg)}</div>`
    : "";
  const previewHtml = opts.previewHtml
    ? `<h2 style="margin:1.6rem 0 .8rem;">Preview</h2><iframe srcdoc="${esc(opts.previewHtml)}" style="width:100%;height:600px;border:1.5px solid #ede7e0;border-radius:10px;"></iframe>
       <button type="submit" name="intent" value="send" style="margin-top:1rem;font:inherit;font-weight:700;padding:.6em 1.4em;background:#8a3a52;color:#fff;border:none;border-radius:6px;cursor:pointer;">Send Now</button>`
    : `<button type="submit" name="intent" value="preview" style="font:inherit;font-weight:700;padding:.6em 1.4em;background:#8a3a52;color:#fff;border:none;border-radius:6px;cursor:pointer;">Preview</button>`;

  return `
    ${savedHtml}${errorHtml}
    <form method="POST" action="${RETURN}">
      <h2 style="margin:0 0 .8rem;">Audience</h2>
      <label style="display:block;margin-bottom:.4rem;"><input type="radio" name="audience" value="newsletter" ${fields.audience === "past-clients" ? "" : "checked"} style="width:auto;"> Newsletter</label>
      <label style="display:block;margin-bottom:1.2rem;"><input type="radio" name="audience" value="past-clients" ${fields.audience === "past-clients" ? "checked" : ""} style="width:auto;"> Past clients</label>

      <h2 style="margin:1.6rem 0 .8rem;">Reference a promo (optional)</h2>
      <select name="promoId" style="width:100%;padding:.5em;margin-bottom:1.2rem;">${promoOptions}</select>

      <h2 style="margin:1.6rem 0 .8rem;">Email content</h2>
      <label style="display:block;margin-bottom:.3rem;">Subject line</label>
      <input type="text" name="subject" value="${v("subject")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Headline</label>
      <input type="text" name="headline" value="${v("headline")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Body (blank line between paragraphs)</label>
      <textarea name="bodyText" rows="6" style="width:100%;padding:.5em;margin-bottom:1rem;">${v("bodyText")}</textarea>
      <label style="display:block;margin-bottom:.3rem;">Highlight label (optional)</label>
      <input type="text" name="highlightLabel" value="${v("highlightLabel")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Highlight value (optional)</label>
      <input type="text" name="highlightValue" value="${v("highlightValue")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">Hero image URL (optional)</label>
      <input type="text" name="heroImage" value="${v("heroImage")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">CTA label</label>
      <input type="text" name="ctaLabel" value="${v("ctaLabel")}" style="width:100%;padding:.5em;margin-bottom:1rem;">
      <label style="display:block;margin-bottom:.3rem;">CTA link</label>
      <input type="text" name="ctaHref" value="${v("ctaHref")}" style="width:100%;padding:.5em;margin-bottom:1.4rem;">

      ${previewHtml}
    </form>

    <h2 style="margin:2.2rem 0 .8rem;">Past clients list</h2>
    <p style="color:#8a7d72;font-size:.85rem;margin:0 0 .8rem;">Backfill or refresh the past-clients Brevo list from every settled booking.</p>
    <form method="POST" action="${RETURN}/sync-past-clients">
      <button type="submit" style="font:inherit;font-weight:700;padding:.6em 1.4em;background:#fff;color:#8a3a52;border:1.5px solid #8a3a52;border-radius:6px;cursor:pointer;">Sync past clients to Brevo</button>
    </form>`;
}

export async function handleAdminMarketing(
  req: Request,
  env: MarketingEnv,
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const url = new URL(req.url);

  if (req.method === "POST") {
    const form = await req.formData();
    const fields = readFields(form);
    const intent = String(form.get("intent") ?? "");
    const errors = validate(fields);

    if (errors.length) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors }), url.pathname));
    }

    if (intent === "preview") {
      const previewHtml = buildHtml(fields);
      return htmlResponse(shell("Marketing", user, formHtml(fields, { previewHtml }), url.pathname));
    }

    // intent === "send"
    const listIdStr = fields.audience === "past-clients" ? env.BREVO_PAST_CLIENTS_LIST_ID : env.BREVO_NEWSLETTER_LIST_ID;
    const listId = parseInt(listIdStr ?? "0", 10);
    if (!listId) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors: ["That audience's Brevo list isn't configured yet."] }), url.pathname));
    }

    const html = buildHtml(fields);
    try {
      const { id } = await createAndSendCampaign(env, { subject: fields.subject, htmlContent: html, listId, senderEmail: env.NOTIFY_EMAIL }, f);
      await writeAudit(env, { bookingId: null, eventType: "marketing.campaign-sent", payload: { campaignId: id, audience: fields.audience, subject: fields.subject } }, f);
      return redirect(`${RETURN}?sent=1`);
    } catch (e) {
      return htmlResponse(shell("Marketing", user, formHtml(fields, { errors: [`Send failed: ${String(e)}`] }), url.pathname));
    }
  }

  const sentMsg = url.searchParams.get("sent") === "1" ? "Campaign sent." : "";
  return htmlResponse(shell("Marketing", user, formHtml({ audience: "newsletter" }, { savedMsg: sentMsg }), url.pathname));
}

export async function handleAdminMarketingSyncPastClients(
  req: Request,
  env: MarketingEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  const listId = parseInt(env.BREVO_PAST_CLIENTS_LIST_ID ?? "0", 10);
  if (!listId) return redirect(`${RETURN}?syncError=1`);

  const clients = await listSettledBookingEmails(env, f);
  await Promise.all(clients.map((c) => upsertBrevoContact(env, c.bride_email, listId, f).catch(() => {})));
  await writeAudit(env, { bookingId: null, eventType: "marketing.past-clients-synced", payload: { count: clients.length } }, f).catch(() => {});
  return redirect(`${RETURN}?synced=${clients.length}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/booking/marketing.test.ts`
Expected: PASS. If any test fails on exact HTML text matching, read the actual rendered HTML from the test failure output and adjust `formHtml()`'s wording (not the test) only if the test's expectation was itself wrong per this plan's field names — otherwise adjust `formHtml()` to match the plan's intended copy.

- [ ] **Step 5: Commit**

```bash
git add worker/src/booking/marketing.ts worker/src/booking/marketing.test.ts
git commit -m "feat(admin): add Marketing tab — compose and send promo campaigns via Brevo"
```

---

### Task 7: Register the routes and nav link

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/booking/dashboard.ts`
- Test: `worker/src/index.test.ts` (already exists — add routing smoke tests)

**Interfaces:**
- Consumes: `handleAdminMarketing`, `handleAdminMarketingSyncPastClients` from `./booking/marketing` (Task 6).

- [ ] **Step 1: Write the failing test**

Open `worker/src/index.test.ts`, find an existing test that checks a similar admin route is wired up (search for `"/api/admin/promos"` in that file to find the pattern), and add two analogous tests for `/api/admin/marketing` and `/api/admin/marketing/sync-past-clients` — following that exact existing test's shape (likely asserting a 302 redirect to login when unauthenticated, since that's the cheapest true assertion that doesn't require full auth mocking at this layer).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/index.test.ts`
Expected: FAIL — 404 or similar, since the route doesn't exist yet.

- [ ] **Step 3: Register the routes**

In `worker/src/index.ts`, find the existing block:

```ts
      // GET/POST /api/admin/promos — Zandeline's promo library + which one is currently running
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/promos") {
        const { handleAdminPromos } = await import("./booking/promos");
        return handleAdminPromos(req, env as Parameters<typeof handleAdminPromos>[1], adminShell);
      }
```

Add immediately after it:

```ts
      // GET/POST /api/admin/marketing — compose & send a promo campaign
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/marketing") {
        const { handleAdminMarketing } = await import("./booking/marketing");
        return handleAdminMarketing(req, env as Parameters<typeof handleAdminMarketing>[1], adminShell);
      }

      // POST /api/admin/marketing/sync-past-clients — backfill/refresh the past-clients Brevo list
      if (req.method === "POST" && url.pathname === "/api/admin/marketing/sync-past-clients") {
        const { handleAdminMarketingSyncPastClients } = await import("./booking/marketing");
        return handleAdminMarketingSyncPastClients(req, env as Parameters<typeof handleAdminMarketingSyncPastClients>[1]);
      }
```

- [ ] **Step 4: Add the nav link**

In `worker/src/booking/dashboard.ts`, find:

```ts
  const adminLinks = [
    navLink("/api/admin/dashboard",  "Inbox"),
    navLink("/api/admin/staffing",   "Staffing"),
    navLink("/api/admin/promos",     "Promotions"),
    navLink("/api/admin/templates",  "Templates"),
  ];
```

Replace with:

```ts
  const adminLinks = [
    navLink("/api/admin/dashboard",  "Inbox"),
    navLink("/api/admin/staffing",   "Staffing"),
    navLink("/api/admin/promos",     "Promotions"),
    navLink("/api/admin/marketing",  "Marketing"),
    navLink("/api/admin/templates",  "Templates"),
  ];
```

Find the matching `isActive` array a few lines below it:

```ts
    navGroup("Admin",    adminLinks,    adminLinks.some((_, i) =>
      isActive(["/api/admin/dashboard", "/api/admin/staffing", "/api/admin/promos", "/api/admin/templates"][i]!))),
```

Replace with:

```ts
    navGroup("Admin",    adminLinks,    adminLinks.some((_, i) =>
      isActive(["/api/admin/dashboard", "/api/admin/staffing", "/api/admin/promos", "/api/admin/marketing", "/api/admin/templates"][i]!))),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/index.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full worker + shared/pricing suites**

Run:
```bash
cd worker && npx vitest run
cd ../shared/pricing && npx vitest run
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.ts worker/src/booking/dashboard.ts
git commit -m "feat(admin): wire up the Marketing route and nav tab"
```

---

### Task 8: Document the new secret

**Files:**
- Modify: `worker/src/index.ts` (the secrets doc comment block near the top, next to the existing `BREVO_API_KEY`/`NOTIFY_EMAIL` comment)
- Modify: `worker/wrangler.toml` if it lists secret names as comments (check first: `grep -n "BREVO" worker/wrangler.toml`)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Check whether `wrangler.toml` documents secret names**

Run: `grep -n "BREVO" worker/wrangler.toml`

- [ ] **Step 2: Add the doc comment**

In `worker/src/index.ts`, find:

```ts
   Secrets (set via `wrangler secret put`, never committed):
     BREVO_API_KEY  — Brevo transactional-email key
     NOTIFY_EMAIL   — verified Brevo sender + where enquiries land (info@lustiqueco.co.za)
```

Replace with:

```ts
   Secrets (set via `wrangler secret put`, never committed):
     BREVO_API_KEY              — Brevo transactional-email key
     NOTIFY_EMAIL                — verified Brevo sender + where enquiries land (info@lustiqueco.co.za)
     BREVO_NEWSLETTER_LIST_ID    — numeric Brevo list ID for newsletter signups (see newsletter.ts)
     BREVO_PAST_CLIENTS_LIST_ID  — numeric Brevo list ID for settled bookings' brides (see marketing.ts) —
                                    optional; the past-clients audience and its sync are skipped if unset.
```

If Step 1 found matching lines in `wrangler.toml`, add an equivalent comment line there too, following that file's existing format exactly.

- [ ] **Step 3: Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "docs: document BREVO_PAST_CLIENTS_LIST_ID secret"
```

---

## Plan self-review notes

- **Spec coverage:** sign-off fix (Task 1), audience + Brevo Campaign API (Tasks 2, 5, 6), single flexible preset with auto-attached promo terms (Task 4), past-clients sync as an idempotent, re-runnable admin action rather than a one-shot migration (Task 6's `handleAdminMarketingSyncPastClients`), nav tab (Task 7), error surfaced visibly on Brevo failure (Task 6's `intent=send` error path) — all spec sections have a corresponding task.
- **Out-of-scope items from the spec** (enquiry-lead consent checkbox, `dashboard.ts`'s disconnected manual-quote travel tiers, scheduling/recurring sends) are deliberately not tasked here — they're separate follow-ups per the spec's own "Out of scope" section.
- **Type consistency check:** `MarketingEmailInput` (Task 4) is consumed with the same field names (`headline`, `paragraphs`, `highlight`, `ctaLabel`, `ctaHref`, `heroImage`, `promoId`) in Task 6's `buildHtml()` — verified consistent. `upsertBrevoContact`/`createAndSendCampaign` (Task 2) signatures match their usage in Tasks 5 and 6 exactly.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-lustique-marketing-email-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
