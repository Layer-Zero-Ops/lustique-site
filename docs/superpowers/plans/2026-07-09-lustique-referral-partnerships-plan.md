# Lustique Referral Partnerships — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** capture which vendor/venue partner sent a lead (via a `?ref=<slug>` link), store and surface it in the admin enquiry views, and ship a small "Vendors we recommend" page to give partners a reason to list Lustique back.

**Architecture:** one new nullable column on the existing `enquiries` table (`referral_source`), captured client-side from the URL into `sessionStorage` (survives the multi-step quote form, cleared with the tab) and sent through the existing `/api/enquiry` POST body — no new endpoints. The vendors page is a static data file + Astro page, mirroring the existing `team.ts`/`team.astro` pattern exactly.

**Tech Stack:** Astro (site), Cloudflare Worker (worker/), Supabase Postgres, Vitest.

## Global Constraints

- Never block a real enquiry over a malformed/missing referral field — it's tracking metadata, not a required field.
- Follow existing escaping conventions exactly: every value rendered into admin HTML goes through the local `esc()` helper already defined in each file (`enquiries.ts`, `index.ts`).
- No new npm dependencies.
- Match existing TypeScript patterns in each touched file (interface shape, `?? null` conventions, etc.) — don't introduce a different style.

---

### Task 1: Database migration — add `referral_source` to `enquiries`

**Files:**
- Create: `supabase/migrations/0025_enquiry_referral_source.sql`

**Interfaces:**
- Produces: an `enquiries.referral_source` nullable `text` column, consumed by Task 2 (write) and Task 3 (read/display).

- [ ] **Step 1: Write the migration**

```sql
-- 0025: track which vendor/venue partner referral link (?ref=<slug>) sent a lead,
-- so Zandeline can see which partnerships actually produce bookings.
alter table enquiries
  add column if not exists referral_source text;
```

- [ ] **Step 2: Apply the migration**

This project's migrations are applied manually against the shared Supabase project (per `SETUP.md` convention — no automated migration runner). Run the SQL above via the Supabase SQL editor or `mcp__<supabase>__apply_migration` against the project, then confirm:

```sql
select column_name from information_schema.columns where table_name = 'enquiries' and column_name = 'referral_source';
```

Expected: one row returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_enquiry_referral_source.sql
git commit -m "data(enquiries): add referral_source column for vendor/venue partner attribution"
```

---

### Task 2: Server — accept and persist `referral_source` on `/api/enquiry`

**Files:**
- Modify: `worker/src/booking/db.ts:557-584` (`EnquiryRow` interface + `persistEnquiry`)
- Modify: `worker/src/index.ts:123-135` (`Enquiry` interface), `worker/src/index.ts:667-678` (`persistEnquiry` call)
- Test: `worker/src/booking/db.test.ts`

**Interfaces:**
- Consumes: nothing new — extends the existing `EnquiryRow`/`persistEnquiry(env, row, f)` signature from `db.ts`.
- Produces: `EnquiryRow.referral_source?: string` — consumed by Task 1's column and read back by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `worker/src/booking/db.test.ts` (after the existing `import` line, add `persistEnquiry` to the import list; add this new `describe` block after `describe("insertBooking", ...)`):

```typescript
describe("persistEnquiry", () => {
  it("stores referral_source when provided", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "e1" }], 201));
    await persistEnquiry(env, { name: "Anri", email: "anri@x.com", phone: "0821234567", referral_source: "avianto" }, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.referral_source).toBe("avianto");
  });

  it("omits referral_source when not provided (never sends undefined as a literal string)", async () => {
    const f = vi.fn().mockResolvedValue(res([{ id: "e2" }], 201));
    await persistEnquiry(env, { name: "Anri", email: "anri@x.com", phone: "0821234567" }, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.referral_source).toBeUndefined();
  });
});
```

Update the top-of-file import to include `persistEnquiry`:

```typescript
import { insertBooking, updateBookingStatus, findPaymentByYocoId, keepWarm, countBookingsOnDate, getBookingByTokenHash, transitionRequestedBooking, getBookingById, transitionBooking, listBookingsDueForBalanceReminder, getBusinessSetting, setBusinessSetting, persistEnquiry } from "./db";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/booking/db.test.ts -t "persistEnquiry"`
Expected: FAIL — `referral_source` doesn't exist on the `EnquiryRow` type / isn't sent.

- [ ] **Step 3: Implement — extend `EnquiryRow`**

In `worker/src/booking/db.ts`, change:

```typescript
export interface EnquiryRow {
  name: string;
  email: string;
  phone: string;
  occasion?: string;
  event_date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: unknown;
  ip?: string;
}
```

to:

```typescript
export interface EnquiryRow {
  name: string;
  email: string;
  phone: string;
  occasion?: string;
  event_date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: unknown;
  ip?: string;
  /** Vendor/venue partner slug from a `?ref=<slug>` link, if the enquiry arrived via one. */
  referral_source?: string;
}
```

`persistEnquiry` itself needs no change — it already does `JSON.stringify(row)` with whatever shape `EnquiryRow` declares.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/booking/db.test.ts -t "persistEnquiry"`
Expected: PASS

- [ ] **Step 5: Wire the request body through** — `worker/src/index.ts`

Change the `Enquiry` interface (line ~123):

```typescript
interface Enquiry {
  name?: string;
  email?: string;
  phone?: string;
  occasion?: string;
  date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: Detail[]; // occasion-specific rows (party, hair, style…) built client-side
  hp_company?: string; // honeypot — bots fill it; humans never see it
  cfTurnstileToken?: string;
}
```

to:

```typescript
interface Enquiry {
  name?: string;
  email?: string;
  phone?: string;
  occasion?: string;
  date?: string;
  town?: string;
  estimate?: string;
  message?: string;
  details?: Detail[]; // occasion-specific rows (party, hair, style…) built client-side
  hp_company?: string; // honeypot — bots fill it; humans never see it
  cfTurnstileToken?: string;
  /** Vendor/venue partner slug from a `?ref=<slug>` link, captured client-side. */
  referralSource?: string;
}
```

Change the `persistEnquiry` call (around line 667):

```typescript
        const saved = await persistEnquiry(env, {
          name,
          email: body.email!.trim(),
          phone: (body.phone ?? "").trim(),
          occasion: body.occasion,
          event_date: body.date,
          town: body.town,
          estimate: body.estimate,
          message: body.message ? cap(body.message, 2000) : undefined,
          details: Array.isArray(body.details) ? body.details : undefined,
          ip: req.headers.get("cf-connecting-ip") ?? undefined,
        });
```

to:

```typescript
        const saved = await persistEnquiry(env, {
          name,
          email: body.email!.trim(),
          phone: (body.phone ?? "").trim(),
          occasion: body.occasion,
          event_date: body.date,
          town: body.town,
          estimate: body.estimate,
          message: body.message ? cap(body.message, 2000) : undefined,
          details: Array.isArray(body.details) ? body.details : undefined,
          ip: req.headers.get("cf-connecting-ip") ?? undefined,
          referral_source: body.referralSource ? cap(body.referralSource, 80) : undefined,
        });
```

(`cap(..., 80)` reuses the existing defensive-length-cap helper already in this file — a referral slug never needs to be long, and this is client-supplied text hitting the database.)

- [ ] **Step 6: Run the full worker test suite**

Run: `cd worker && npx vitest run`
Expected: PASS (443+ tests, no regressions)

- [ ] **Step 7: Commit**

```bash
git add worker/src/booking/db.ts worker/src/index.ts worker/src/booking/db.test.ts
git commit -m "feat(enquiry): accept and store a referral_source from vendor/venue partner links"
```

---

### Task 3: Admin — surface `referral_source` in the enquiry detail view

**Files:**
- Modify: `worker/src/booking/db.ts:609-628` (`EnquiryCrmRow`, `ENQUIRY_COLS`)
- Modify: `worker/src/booking/enquiries.ts` (detail view "Lead details" table)
- Test: `worker/src/booking/enquiries.test.ts` (if it doesn't exist yet, create it — check `find worker/src/booking -iname "enquiries.test.ts"` first)

**Interfaces:**
- Consumes: `EnquiryCrmRow` from Task 2's column (already in the DB after Task 1).
- Produces: nothing consumed downstream — this is a leaf (display-only) task.

- [ ] **Step 1: Write the failing test**

`worker/src/booking/enquiries.test.ts` already exists with a working `describe("handleAdminEnquiryDetail", ...)` block, a shared `ENQUIRY` fixture object, and an `authUserRes()`/`profileRes()` mock pair for the auth-gated handler pattern (read the file's top section before editing — the `getReq`/`shell`/`env` helpers are all already defined and must be reused, not redefined).

Add `referral_source: null` to the existing `ENQUIRY` fixture object (so every existing test in this file keeps passing against the now-wider `EnquiryCrmRow` type), then add two new tests inside the existing `describe("handleAdminEnquiryDetail", ...)` block, right after the `"renders enquiry detail with all fields"` test:

```typescript
  it("renders the referral source when present", async () => {
    const withReferral = { ...ENQUIRY, referral_source: "avianto" };
    const f = vi.fn().mockResolvedValueOnce(authUserRes()).mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([withReferral]));
    const r = await handleAdminEnquiryDetail(await getReq("/api/admin/enquiries/aaaa-1111"), env, shell, "aaaa-1111", f as unknown as typeof fetch);
    const body = await r.text();
    expect(body).toContain("Referral source");
    expect(body).toContain("avianto");
  });

  it("shows no referral row when absent", async () => {
    const f = vi.fn().mockResolvedValueOnce(authUserRes()).mockResolvedValueOnce(profileRes()).mockResolvedValueOnce(res([ENQUIRY]));
    const r = await handleAdminEnquiryDetail(await getReq("/api/admin/enquiries/aaaa-1111"), env, shell, "aaaa-1111", f as unknown as typeof fetch);
    const body = await r.text();
    expect(body).not.toContain("Referral source");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/booking/enquiries.test.ts`
Expected: FAIL — `referral_source` isn't on `EnquiryCrmRow` yet / not rendered.

- [ ] **Step 3: Implement — extend `EnquiryCrmRow` and `ENQUIRY_COLS`**

In `worker/src/booking/db.ts`, change:

```typescript
export interface EnquiryCrmRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  occasion: string | null;
  event_date: string | null;
  town: string | null;
  estimate: string | null;
  message: string | null;
  details: unknown;
  status: string;
  notes: string | null;
  contacted_at: string | null;
  booking_id: string | null;
}

const ENQUIRY_COLS =
  "id,created_at,name,email,phone,occasion,event_date,town,estimate,message,details,status,notes,contacted_at,booking_id";
```

to:

```typescript
export interface EnquiryCrmRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  occasion: string | null;
  event_date: string | null;
  town: string | null;
  estimate: string | null;
  message: string | null;
  details: unknown;
  status: string;
  notes: string | null;
  contacted_at: string | null;
  booking_id: string | null;
  referral_source: string | null;
}

const ENQUIRY_COLS =
  "id,created_at,name,email,phone,occasion,event_date,town,estimate,message,details,status,notes,contacted_at,booking_id,referral_source";
```

- [ ] **Step 4: Implement — render it in the detail view**

In `worker/src/booking/enquiries.ts`, find the "Lead details" table (the block containing `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Estimate</td>...`) and add a row directly after it, following the exact same conditional pattern already used for `e.town`/`e.estimate`:

```typescript
          ${e.estimate ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Estimate</td><td>${esc(e.estimate)}</td></tr>` : ""}
          ${e.referral_source ? `<tr><td style="color:#8a7d72;padding:3px 12px 3px 0;">Referral source</td><td>${esc(e.referral_source)}</td></tr>` : ""}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd worker && npx vitest run src/booking/enquiries.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full worker test suite**

Run: `cd worker && npx vitest run`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add worker/src/booking/db.ts worker/src/booking/enquiries.ts worker/src/booking/enquiries.test.ts
git commit -m "feat(admin): show referral source on the enquiry detail page"
```

---

### Task 4: Client — capture `?ref=` from the URL and send it with the enquiry

**Files:**
- Create: `site/src/scripts/referral.ts`
- Modify: `site/src/scripts/enquiry.ts` (import + use in `collect()`)
- Test: `site/src/scripts/referral.test.ts`

**Interfaces:**
- Produces: `captureReferralSource(search: string): void` (writes to `sessionStorage`), `readReferralSource(): string | undefined` (reads it back) — both consumed by `enquiry.ts`.
- Consumes: nothing (pure functions + `sessionStorage`, no dependency on other tasks' code).

- [ ] **Step 1: Write the failing test**

Create `site/src/scripts/referral.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { captureReferralSource, readReferralSource } from "./referral";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/scripts/referral.test.ts`
Expected: FAIL — `./referral` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `site/src/scripts/referral.ts`:

```typescript
/* ============================================================
   Referral attribution — capture which vendor/venue partner link
   (?ref=<slug>) sent this visitor, so it can ride along with
   whatever enquiry they eventually submit. Kept in sessionStorage:
   survives the multi-step quote form, cleared when the tab closes —
   no persistent cross-visit tracking is needed for this.
   ============================================================ */

const STORAGE_KEY = "lustique_referral_source";

/** Call on every page load. Only overwrites the stored value when the
 *  current URL actually carries new attribution — so a bride who lands
 *  via a partner link, then browses several pages before enquiring,
 *  keeps that original attribution rather than losing it on a page
 *  with no query string. */
export function captureReferralSource(search: string): void {
  const params = new URLSearchParams(search);
  const value = params.get("ref") || params.get("utm_source");
  if (!value) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, value.slice(0, 80));
  } catch {
    /* sessionStorage unavailable (private browsing edge cases) — attribution is best-effort only */
  }
}

export function readReferralSource(): string | undefined {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/scripts/referral.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into the enquiry submission** — `site/src/scripts/enquiry.ts`

Add the import at the top of the file (alongside the existing imports):

```typescript
import { readReferralSource } from "./referral";
```

In the `collect()` function, find the returned object (the one with `name`, `email`, `phone`, ... `cfTurnstileToken`) and add one field:

```typescript
  const tsInput = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return {
    name: [val("fName"), val("lName")].filter(Boolean).join(" "),
    email: val("email"),
    phone: val("phone"),
    occasion: OCCASION[occasion] ?? occasion,
    date,
    estimate: (document.getElementById("estimateAmount")?.textContent ?? "").trim(),
    message: val("message"),
    details,
    hp_company: val("hp_company"), // honeypot — the Worker drops it if filled
    cfTurnstileToken: tsInput?.value ?? "",
    referralSource: readReferralSource(),
  };
```

- [ ] **Step 6: Capture on every quote-page load** — `site/src/pages/quote.astro`

Find the existing inline bootstrap `<script>` region near the top of the page body (the same area where Turnstile's script tag is loaded), and add a call to capture attribution as early as possible. Add this small inline script right after the Turnstile `<script is:inline src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` line:

```html
  <script>
    (function() {
      try {
        var p = new URLSearchParams(location.search);
        var v = p.get('ref') || p.get('utm_source');
        if (v) sessionStorage.setItem('lustique_referral_source', v.slice(0, 80));
      } catch (e) { /* best-effort only */ }
    })();
  </script>
```

(This is a plain inline duplicate of `captureReferralSource`'s logic rather than an import, because this needs to run at the top of the page before the bundled module script parses — matching the existing pattern already used for the magic-link hash-capture script in `BaseLayout.astro:47-49`. The `STORAGE_KEY` string `'lustique_referral_source'` must stay in sync with `referral.ts` — both are simple enough that a mismatch would be caught immediately by `referral.test.ts` failing, but note it as a single source of truth for a future refactor if it ever needs to change.)

- [ ] **Step 7: Run the site test suite**

Run: `cd site && npx vitest run`
Expected: PASS, no regressions

- [ ] **Step 8: Manual verification in the browser**

1. Start the dev server: use the `run` skill or `npm run dev --workspace site`.
2. Navigate to `http://localhost:4321/quote.html?ref=avianto`.
3. Open the browser console, run `sessionStorage.getItem('lustique_referral_source')` — expect `"avianto"`.
4. Fill out and submit a test enquiry (or inspect the network request body for `/api/enquiry` before it fires) — confirm `referralSource: "avianto"` is present in the POST payload.

- [ ] **Step 9: Commit**

```bash
git add site/src/scripts/referral.ts site/src/scripts/referral.test.ts site/src/scripts/enquiry.ts site/src/pages/quote.astro
git commit -m "feat(quote): capture ?ref= vendor/venue partner attribution and send it with the enquiry"
```

---

### Task 5: "Vendors we recommend" page

**Files:**
- Create: `site/src/data/vendors.ts`
- Create: `site/src/pages/vendors.astro`
- Modify: `site/src/components/Footer.astro` (nav link)

**Interfaces:**
- Consumes: nothing from earlier tasks — independent, static content page.
- Produces: nothing consumed downstream — leaf task.

- [ ] **Step 1: Create the data file** — `site/src/data/vendors.ts`

```typescript
// Curated list of venues/photographers/planners Lustique genuinely recommends —
// a small, hand-picked list (not the full 300+ venue directory used for travel
// pricing in sa-wedding-venues.json). Zandeline adds/edits entries here directly;
// no admin UI for v1 since this changes rarely and the list stays short.

export type VendorCategory = "Venue" | "Photographer" | "Planner" | "Other";

export type RecommendedVendor = {
  name: string;
  category: VendorCategory;
  note: string;  // one line — why Lustique recommends them
  url: string;   // their website or Instagram
};

export const RECOMMENDED_VENDORS: RecommendedVendor[] = [
  // Populate with Zandeline's actual real partners before publishing —
  // deliberately left empty here since inventing placeholder vendor names
  // would be fabricated business content on a live page.
];
```

- [ ] **Step 2: Create the page** — `site/src/pages/vendors.astro`

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { RECOMMENDED_VENDORS } from "../data/vendors";
const title = "Vendors We Recommend — Lustique Co.";
const desc = "Trusted wedding venues, photographers, and planners Lustique Co. is proud to work alongside in Pretoria and Gauteng.";
---
<BaseLayout slug="vendors.html" title={title} desc={desc}>
  <section class="page-hero">
    <span class="eyebrow">Our Network</span>
    <h1>Vendors we recommend.</h1>
    <p>Wonderful weddings are a team effort. These are vendors we've worked alongside and trust completely.</p>
  </section>
  <section class="section"><div class="wrap">
    {RECOMMENDED_VENDORS.length === 0 ? (
      <p style="color:#8a7d72;font-style:italic;">Coming soon.</p>
    ) : (
      <div style="display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
        {RECOMMENDED_VENDORS.map((v) => (
          <a href={v.url} target="_blank" rel="noopener" style="display:block;border:1px solid #e8d5b7;border-radius:12px;padding:1.2rem;text-decoration:none;color:inherit;">
            <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7060;">{v.category}</div>
            <h3 style="margin:.3rem 0;font-family:Georgia,serif;font-style:italic;">{v.name}</h3>
            <p style="margin:0;font-size:.9rem;color:#3a2e26;">{v.note}</p>
          </a>
        ))}
      </div>
    )}
  </div></section>
</BaseLayout>
```

- [ ] **Step 3: Add the footer link** — `site/src/components/Footer.astro`

Find this line:

```html
      <li><a href="about.html">About</a></li><li><a href="services.html">Services</a></li>
```

Add a new list item for vendors near the other content links (after `guides.html`):

```html
      <li><a href="guides.html">Free Guides</a></li><li><a href="vendors.html">Vendors We Recommend</a></li>
```

(Replace the existing standalone `<li><a href="guides.html">Free Guides</a></li>` line with the combined line above — check the exact current line first since Footer.astro's list items are written several-per-line.)

- [ ] **Step 4: Verify in the browser**

1. Start the dev server (`run` skill or `npm run dev --workspace site`).
2. Navigate to `http://localhost:4321/vendors.html` — confirm the page renders with the "Coming soon." placeholder (empty list is expected until Zandeline supplies real vendors).
3. Confirm the footer link appears on any page and navigates correctly.
4. Check the browser console for errors — expect none.

- [ ] **Step 5: Commit**

```bash
git add site/src/data/vendors.ts site/src/pages/vendors.astro site/src/components/Footer.astro
git commit -m "feat(site): add Vendors We Recommend page for reciprocal partner listings"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** Task 1–3 cover Part F1 (referral attribution: migration, server capture, admin display) from the growth-program spec. Task 4 covers the client-side capture half of F1. Task 5 covers Part F2 (vendors page). Nothing in Part F is left unaddressed.
- **Task 5's vendor list ships empty** — this is deliberate (see Task 5 Step 1's comment) and matches the ops playbook's Section 5 checklist, which is where the actual vendor outreach and list-population work lives (operational, not code). Don't fabricate vendor names to make the page look populated before publishing.
- **Task 3's test file existence is unknown** — the step explicitly tells the implementer to check first and adapt, since the auth-mocking pattern must match whatever this codebase already does elsewhere (don't invent a new one).
