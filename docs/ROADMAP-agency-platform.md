# Lustique Agency Platform — Phased Roadmap

**Status:** Plan v1 — 2026-06-17 (Opus, planning lane) · awaiting Pieter's review
**Owner:** Pieter (decisions/sequencing) · Zandeline (business/ops sign-off) · Claude (build — Sonnet)
**Scope:** The "Pass 4 and beyond" layer — admin dashboard, artist portal, client/bride portal, internal comms, central calendar — on top of the live booking→payment core.
**Source docs:** [`PLAN.md`](../PLAN.md) · [`ARCHITECTURE.md`](../ARCHITECTURE.md) · [`BRAND.md`](../BRAND.md) · [`SECURITY.md`](../SECURITY.md) · booking-core spec [`docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md`](./superpowers/specs/2026-06-05-lustique-booking-core-design.md)
**How this was produced:** a 9-agent analysis fan-out (foundation inventory · auth/RLS · white-label · comms · calendar · 3 portals · adversarial risk critic), every claim grounded in the real repo. This doc is the synthesis.

---

## 0. TL;DR

The architecture is genuinely **Pass-4-ready** — the booking core was deliberately built with the seams the agency platform needs: a by-secret-name data layer, deny-all RLS with a service-role Worker that bypasses it, a named-but-unbuilt `booking_artists` allocation join, and an audit/R2 event spine. So this is **additive work on a trusted foundation (152 tests green), not a rewrite.**

The risk is **not** the architecture. It is **sequencing discipline and effort honesty.** The right shape:

| Phase | What | Effort (sequenced) | Depends on |
|---|---|---|---|
| **0** | Go-live sign-off (close the open baton) | 1–2 d | — (current ▶ NEXT) |
| **1** | Identity & RLS spine (Supabase Auth + `profiles` + `booking_artists` + read-only policies) | **4–6 d** | Phase 0 |
| **2** | Admin Dashboard — Zandeline's console | **6–8 d** | Phase 1 |
| **3** | Client/Bride Portal — "Your Wedding" mini-dashboard (magic-link) | **6–8 d** | Phase 1 (can overlap Phase 2) |
| **4** | Artist Portal + structured allocation + acknowledge loop | **5–7 d** + 1–2 d onboarding | Phases 1 + 2 |
| **5** | Internal comms — minimal agency→bride concierge thread | **3–4 d** | Phases 2 + 3 |
| **6** | White-label extraction (`@lz/booking-core`) | **3–5 d** | **A real second client** (trigger, not a date) |

**Honest total:** ~24–36 ideal Sonnet-paced TDD build-days for Phases 1–5 single-lane, **plus** ~3–4 days of real-human onboarding/change-management no code estimate captures. Trust the *sequenced* total, not the additive "brochure" sum (which double-counts auth).

**The four locked architecture calls:**
1. **Auth** — Supabase Auth, **passwordless email magic-link** for all three audiences. One spine: admin-by-role, artist-by-join, bride-by-verified-email. Worker stays the sole writer (service-role bypasses RLS); new policies are **read-only**.
2. **White-label** — **Hybrid, lazily.** Ship Lustique single-tenant-per-deploy now; extract a themeable `@lz/booking-core` only when a real client #2 lands. **Never** true multi-tenant (it collapses the POPIA story that *is* the product).
3. **Comms** — **Hybrid (Option D):** an in-app `messages` thread as the system of record, Brevo as the notification fan-out, rendered as a *calm concierge note, not a chat app.* Agency→bride first.
4. **Calendar** — **Native-on-Supabase first** (artists + availability + allocation in one DB Zandeline owns), with Google two-way sync deferred as an opt-in convenience. Manual allocation must be trusted before any automation.

---

## 1. Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| AP-1 | **Bride portal access** | **Supabase Auth passwordless email magic-link**, authenticated by the email she gave at booking; the link is required to reach her mini-dashboard | Pieter, this session. No password, no "account" feeling — matches the quiet-luxury "never feels like logging into software" mandate. RLS falls out cleanly: `lower(bride_email) = lower(auth.email())`. Supersedes the analysis's capability-URL-only lean. |
| AP-2 | **Auth mechanism (all roles)** | Supabase Auth **magic-link/OTP** for admin, artists, brides | Zero password breach/reset surface (strongest POPIA posture for a Responsible Party); on-brand; trivial to onboard 9 known artists; brides match by verified email, no profile row needed. |
| AP-3 | **Who writes money/state** | The **Worker's service-role principal stays the sole writer** | `db.ts` uses the service key as `apikey`+`Bearer` and bypasses RLS by design. New RLS policies are **read-only** for the `authenticated` role → not one existing route or test changes. |
| AP-4 | **Role model** | A `profiles` table (`role` enum `admin\|artist`) + a `booking_artists` join; brides are **not** in `profiles` (matched by email) | Role logic lives in SQL where RLS reads it; portable as the studio template; onboarding the 9th artist is a row insert, not DDL. |
| AP-5 | **White-label posture** | **Hybrid (Option C), deferred.** Single-tenant-per-deploy now; extract `@lz/booking-core` + `brand.config` at client #2 | Client-owned Supabase per deploy is the selling point; the repo is already ~80% a clean template. Multi-tenant is **cut entirely** (POPIA collapse + cross-client PII bleed). |
| AP-6 | **Comms architecture** | **Hybrid (Option D):** `messages` table = system of record; email/WhatsApp = swappable delivery adapters; concierge UI, not chat | The honest constraint is *identity, not transport*. Ships a real agency→bride slice without inventing more auth, and is AXIS-readable. |
| AP-7 | **Calendar architecture** | **Native-on-Supabase first**, Google two-way sync deferred (opt-in), raw Google free/busy rejected as primary | Keeps capacity + allocation + artist financials in one DB Zandeline owns; no Workspace dependency on the hot path; portable to client #2. |
| AP-8 | **Bride artist selection** | Brides **never** pick artists; portal shows "confirmed closer to your day" until Lustique allocates | Carries forward the locked PLAN.md decision. |

**Decisions still needed from Pieter/Zandeline** — see §9. The biggest is the **go-live gate (Phase 0)** and the **staging strategy** for the live-DB auth migration.

---

## 2. The foundation we build on

The agency platform is not greenfield. It sits on a deliberately AXIS-shaped spine that already runs the money loop end to end. The load-bearing facts (verified against the real code):

- **The Worker is the single stable API + event boundary.** Everything money-and-PII-touching is server-side; the browser sends `EstimateInput`, never a price.
- **Money truth is a shared package.** `@lustique/pricing` (`shared/pricing`) exports `computeEstimate`, `splitDeposit`, `grossUp`. The site estimator and the Worker import the *same* functions, so persisted `total_cents` is authoritative. **Any portal re-quote must route through this package** — never re-implement money.
- **The data layer is a deploy-time seam.** `worker/src/booking/db.ts` is the only door to Supabase — a thin PostgREST-over-`fetch` module keyed by the secret *names* `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. Client-ownership is a secret swap, not a code fork. New portal queries land here as exported functions. *(One leak to fix early: `confirm.ts`, `review.ts`, `invoice.ts` each inline their own `business_settings` fetch.)*
- **State is a guarded machine.** `transitionBooking(id, fromStatus, patch)` is an atomic compare-and-set that returns null if the row already moved → idempotent, race-safe. The reusable primitive for any new portal-driven action (cancel, reschedule, allocate).
- **The event spine already exists.** Every state change calls `writeAudit` → an immutable R2 object **and** an `audit_log` row. The dotted event vocabulary (`request.created`, `payment.deposit-paid`, `wave.invoice-created`, …) is exactly the boundary ARCHITECTURE.md promises AXIS will subscribe to. **But it is emission-only and pull-only** — no queue/webhook/Realtime/outbox. Because emission is centralized at one call site, adding fan-out is a single-point change, not a refactor.
- **Reusable primitives that need consolidating first:** `brevoEmail` is copy-pasted across 6 files; the Wave client (`lib/wave.ts`) is a clean optional adapter. Consolidating `brevoEmail` into one module is a prerequisite for a clean comms layer.

**Today's "auth" (the honest gap):** there is **no** identity system — no Supabase Auth, sessions, JWTs, or `auth.uid()`. Authorization today is three capability mechanisms: signed HMAC tokens (`token.ts` — single-use confirm + purpose-scoped action tokens for deposit/balance/invoice), one shared static `ADMIN_SECRET` (guards only the blocked-dates page), and the Yoco webhook signature. At the data layer, **all tables are RLS-enabled, deny-all**; the Worker's service key bypasses RLS, so every read/write is one trusted server principal with no per-user scoping. **This is precisely the Pass-4 deferral — and the one real blocker.**

### What exists vs. what's missing

| Built & reusable | Missing (this roadmap builds it) |
|---|---|
| `bookings` / `payments` / `audit_log` / `business_settings` / `blocked_dates` (indexes on `status`, `wedding_date`) | Supabase Auth + any `auth.uid()`/`auth.email()` |
| `GET/POST /api/booking/review` (approve+editable-total / decline → Wave + Yoco + Brevo) | Per-role RLS policies (currently deny-all) |
| `mark-paid` / `mark-balance-paid` guarded transitions; Yoco webhook; balance cron | `profiles` table + role model |
| Signed token toolkit (`token.ts`); branded invoice page (`invoice.ts`) | `booking_artists` allocation join + `pay_cents` (named in spec, **absent** from repo) |
| Audit + R2 event spine; `db.ts` service-role layer; `@lustique/pricing` | Per-artist availability / central calendar (only a global `blocked_dates` blocklist exists) |
| `global.css` brand tokens (ivory/champagne/mocha, Cormorant + Manrope) | Event **push** (queue/webhook/Realtime); an admin read-model/dashboard; a `messages` comms store |

---

## 3. Architecture decision — Auth, identity & RLS

**Recommendation:** Supabase Auth, **passwordless email magic-link/OTP for all three audiences**, with the Worker's service-role principal remaining the **sole writer** to money/state tables. Roles live in a `profiles` table; brides are matched by verified email (no profile row). Replace deny-all by adding **read-only** policies for the `authenticated` role — leaving every existing Worker write untouched, because `service_role` bypasses RLS.

### Identity per audience

| Audience | Mechanism | RLS scope |
|---|---|---|
| Zandeline / admin | Magic-link + `profiles.role = 'admin'` (retires the shared `ADMIN_SECRET`) | `current_role() = 'admin'` → sees all |
| 9 artists (equal sub-contractors) | Magic-link + `profiles.role = 'artist'`; long refresh sessions so they don't re-OTP daily | `exists(booking_artists where artist_id = auth.uid())` → only her allocations |
| Brides / clients | **Magic-link, matched by booking email** (decision AP-1) | `lower(bride_email) = lower(auth.email())` → only her own wedding(s) |

Wire Supabase Auth SMTP through **Brevo** so magic links inherit the SPF/DKIM/DMARC already mandated in SECURITY.md.

### Why magic-link (rejected alternatives)

- **Email + password** — rejected: breach/reset liability the brand and POPIA both want gone; reset flows feel "software-y" (wrong tone for brides).
- **Google Workspace OAuth** — *later* only: the 9 artists aren't guaranteed Workspace seats; couples the template to Google.
- **Postgres GRANT roles / raw JWT claim** — rejected: role changes need DDL not a row edit; harder to attach artist metadata; a `profiles` table + a `SECURITY DEFINER` helper is cleaner and more portable.

### RLS without breaking the Worker — the rules

1. **Never `FORCE ROW LEVEL SECURITY`** on booking tables.
2. **Never write a `service_role` policy.** The service key must keep bypassing RLS.
3. **Every new policy is `FOR SELECT`** (read-only). All writes stay in the Worker behind the state machine + audit trail.
4. **After every migration, run a policy test** asserting the service key still inserts/patches, an artist session sees *only* her allocations, and a bride session sees *only* her email's rows.

Policy sketches (full set in Appendix A):

```sql
create policy bookings_admin_read  on bookings for select to authenticated
  using (current_role() = 'admin');
create policy bookings_artist_read on bookings for select to authenticated
  using (exists (select 1 from booking_artists ba
                 where ba.booking_id = bookings.id and ba.artist_id = auth.uid()));
create policy bookings_bride_read  on bookings for select to authenticated
  using (lower(bride_email) = lower(auth.email()));
```

> **POPIA tripwire:** artists must **never** read `payments` or other artists' `pay_cents` — a too-broad `using` clause leaks every bride's contact details + peer pay to 9 sub-contractors. Scope columns tightly; default-deny and select only what each dashboard needs.

**Effort:** the auth spine is **Phase 1 (4–6 d)** — extracted once for all portals (see §5). The single biggest hidden cost is RLS + mandatory TDD: every policy needs a **positive and a negative** test.

---

## 4. Architecture decision — White-label vs. Lustique-specific

**Recommendation: Hybrid (Option C), lazily.** Keep shipping Lustique single-tenant-per-deploy exactly as it works today; **only after a real second client lands**, extract a thin `@lz/booking-core` package plus a config/branding seam. **Do not build true multi-tenant.**

### Why the fork is already half-won

The data layer reads its Supabase home **by secret name**, so "client owns their own Supabase" is a deploy-time choice. There is **zero `tenant_id`/`org_id` anywhere** (grep-verified), RLS is deny-all, and the Worker holds the service key. This is single-tenant-per-deploy by deliberate design — and it's correct.

| Option | Verdict | Reason |
|---|---|---|
| **A — Fork the repo per client** | rejected | N forks = N maintenance/security-patch surfaces; brand strings hardcoded → find-and-replace per fork; drift. |
| **B — True multi-tenant (shared DB, `tenant_id`)** | **rejected (harmful)** | Pools multiple brands' bride PII into one LZ-owned DB → clients stop being their own POPIA Responsible Party (**destroys the selling point**); cross-client bleed risk on every query; invents auth/tenant context that doesn't exist; huge rework for a buyer that doesn't exist. |
| **C — Shared `@lz/booking-core` + thin per-client deploys (config theming + flags, client-owned data)** | **chosen** | Keeps client-owned Supabase + per-deploy isolation (A's POPIA + blast-radius wins); security fixes land **once**; brand becomes config, not a fork; reachable incrementally. |

### What is what

- **Already reusable (keep):** `global.css` `:root` theme tokens; `site/src/data/site.ts`; the `business_settings` per-business KV table; the isolated `@lustique/pricing` workspace; the stable per-deploy Worker event boundary.
- **Stays Lustique-specific:** `shared/pricing/constants.ts` (bridal prices, R7/km travel, "cheapest look free" promo, staffing tiers) — this is **per-vertical**, not per-client; treat as a pluggable pricing module. Plus brand copy, the Christian sign-off, the team roster.
- **Becomes the studio template (extract at client #2):** (1) `@lz/booking-core` — state machine, token signing, Yoco webhook, audit/R2, balance cron, db-access (kills the N-fork patch tax); (2) `brand.config.ts` — the **80 hardcoded brand-string occurrences across 16 worker files** (the 6 Brevo templates + `index.ts`) behind one brand object; (3) a named theme-token contract; (4) feature flags (Wave on/off, AXIS on/off, payment rail).

**The trigger rule:** do the extraction **only when a real second client is signed.** The second client is the spec — it tells you what actually varies. Until then, ship Lustique and resist productizing against an imaginary buyer. **Effort: 3–5 d, and zero of them until client #2 exists.**

---

## 5. The phased roadmap

> Effort is in **ideal Sonnet-paced TDD build-days** (the build lane is Sonnet; Opus plans the one-way-door schema/enum/RLS calls). "Done" means *verified*, not *compiles* — the booking core's 152-test bar applies to every new surface.

### Phase 0 — Go-live sign-off *(close the open baton)* · 1–2 d

**The current ▶ NEXT.** Every Pass-4 portal is downstream of a booking loop proven in production; the live-domain smoke test (`smoke.test.ts`) is still **skipped** (network-gated). Building portals on an unverified live flow is a second floor before signing off the first.
**Ships:** live-domain end-to-end smoke verification (form → Worker → emails → review → approve → invoice → Yoco pay); confirm Wave/`ADMIN_SECRET` secrets are set or consciously empty; **decide the fate of the legacy `/api/enquiry` route** (public, **no Turnstile** — a live spam surface the booking route already fixed) and the legacy `/api/booking/confirm` EFT path.
**Depends on:** nothing — it's the current task.

### Phase 1 — Identity & RLS spine · 4–6 d

The unavoidable prerequisite, and the most under-estimated phase — because the admin and artist MVP estimates each silently bundle their own auth slice. **Extract it once.**
**Ships:** Supabase Auth enabled (config, af-south-1); migration `0005` adding `profiles` (role `admin|artist`) + the deferred `booking_artists` (`booking_id, artist_id, pay_cents, role_of_day, status, acknowledged_at`) + `artist_unavailability`; a `SECURITY DEFINER` role helper; **read-only** RLS policy families (admin-by-role, artist-by-join, bride-by-email); Brevo SMTP for magic links; a throwaway "signed in as admin/artist/bride" page as the forcing function that proves the magic-link + RLS round-trip.
**Hidden tax:** RLS + TDD — every policy needs a positive **and** a negative test. The Worker keeps writing as `service_role` and bypasses RLS, so **not one existing route or test changes.** Keep `booking_artists.pay_cents` in this migration even though the financials UI is deferred — so the schema isn't painted out.
**Depends on:** Phase 0 (don't migrate the live DB while go-live is unverified). **Decision needed:** staging/preview DB vs. tested production migration (§9).

### Phase 2 — Admin Dashboard (Zandeline's console) · 6–8 d

Highest leverage: **one power-user, lives in it daily.** It collapses the entire email-capability-URL workflow into a logged-in console, reusing every existing endpoint and table.
**Ships (sequence within the phase):** (a) read-only **pipeline board** (`requested → confirmed → deposit_paid → settled`, the `requested` column = what's waiting on her) + **booking detail drawer** (quote lines, payments, audit trail, Wave IDs) — pure value, low risk; (b) port **mutating actions** behind the admin session — the existing `/api/booking/review` approve-with-editable-total / decline verbatim, plus record-EFT-received via `mark-paid`/`mark-balance-paid`; (c) **month calendar** colored by per-date load (reuses `countBookingsOnDate`) + **blocked-dates** management re-homed off the shared `ADMIN_SECRET` onto the admin role.
**Reuses:** `bookings` (indexes present), `/api/booking/review`, the mark-paid transitions, `payments` + the signed invoice page, `db.ts` (read-only adds touch zero write paths).
**Brand:** quietly Lustique, not generic-SaaS — Cormorant/Manrope, ivory/champagne/mocha, restraint, `prefers-reduced-motion`; utilitarian where operational, warm where it speaks to her. Show what's waiting on her first.
**Note:** the MVP shows the *required* artist count + same-date load (from `party_size`); actual assignment is Phase 4.
**Depends on:** Phase 1.

### Phase 3 — Client/Bride Portal — "Your Wedding" mini-dashboard · 6–8 d

A calm, private "your wedding" page reached by a **Supabase Auth magic link tied to her booking email** (decision AP-1). The word "portal"/"login"/"account" never appears in UI copy.
**Ships:** a "send me my link" entry (email → magic link; email-enumeration-safe, Turnstile-gated) and a deep link in existing emails that bounces through one-tap re-auth if the session lapsed; then a single page covering — a 4-step **status timeline** (driven off `status` + `confirmed_at`/`deposit_paid_at`/`settled_at`, one calm next-step sentence each); a **payment ledger** (deposit/balance rows from `payments`) with the live status badge; a deep-link to the existing **signed invoice page**; a **pay-balance** button that *surfaces the already-minted Yoco `pay_url` / EFT details* (never a second money path); a **wedding-details** card (date, venue, `party_size` → staffing sentence); an **assigned-artist panel** that gracefully reads "confirmed closer to your day" until Phase 4; contextual links to the three existing prep guides.
**RLS:** `lower(bride_email) = lower(auth.email())` (read-only, from Phase 1). The existing render-only signed invoice link stays as the no-session fallback.
**Brand:** the most brand-scrutinized surface a paying bride sees — editorial scale, generous ivory whitespace, whisper-motion with a hard reduced-motion fallback, sign-off "Blessings, The Lustique Cosmetology Team." The 5-second test applies.
**Depends on:** Phase 1 (Supabase Auth + the bride-email read policy). **Can overlap Phase 2** with a second build lane — the bride read policy is independent of the admin/artist role machinery, and this is the cheapest *visible* win for paying customers.

> **Reconciliation note:** the analysis recommended a capability-URL-only bride MVP (no auth). Decision AP-1 overrides that: brides get a real, revocable, email-verified mini-dashboard via Supabase Auth magic-link. This unifies the auth model (one mechanism, three scopes) at the cost of making Phase 3 depend on Phase 1 rather than being fully auth-independent. The trade is deliberate and Pieter's call.

### Phase 4 — Artist Portal + structured allocation + acknowledge loop · 5–7 d (+1–2 d onboarding)

The only portal that needs the `booking_artists` spine + per-row RLS. **This is where allocation moves on-system for the first time** (today `party_size` is the only allocation data; Zandeline allocates entirely off-system). Build the **manual** loop first and earn trust before any calendar automation.
**Ships:** magic-link artist sign-in bound to a pre-seeded `profiles` row (keyed on the existing `team.ts` slug so portal identity can't drift from the public Team page); a personal **dashboard** (next wedding + action items + gracious empty state); **My Weddings** (only her allocations — date, venue, call time, party, **role-of-the-day** lead/second on *that* booking, never a rank); **booking detail** working sheet (bride first name + day-contact, venue, schedule, party composition from `estimate_input`/`quote_lines`, co-allocated artists, Zandeline's notes); **manage-my-availability** (`artist_unavailability`; "silence = available" to keep friction low); and the **allocation + acknowledge loop** — Zandeline assigns N artists (N from the staffing rule, only those free that date) from the admin console; each artist taps "I've got it" or "I have a clash."
**Reuses:** `db.ts`, the RLS substrate (deny-all → additive read-only), `team.ts` slugs as the join key, `party_size` + staffing rule, `estimate_input`/`quote_lines`, the audit net, Brevo.
**Brand/posture:** founder-and-friends, not employer-and-staff — "your weddings," "your availability," never "shifts"/"clock-in." No tiers in the UI.
**Risks:** RLS leakage is the headline — a booking-detail policy that forgets the `booking_artists` join leaks every bride's PII; ship **negative** policy tests first. **Onboarding 9 real sub-contractors** (magic-link, consent, the availability/acknowledge mental model) is 1–2 days of non-code project work that gates "done."
**Depends on:** Phase 1 (auth + `booking_artists` + RLS) **and** Phase 2 (allocation is authored from the admin console).

### Phase 5 — Internal comms (minimal, agency→bride first) · 3–4 d

Start minimal and **only after people are in portals.** The constraint is identity, not transport, and 80% of the backbone (R2 + `audit_log` + Brevo) already exists.
**Ships (slice 1):** a migration adding a `messages` table (FK `booking_id`, `direction`, `author`, `body`, `channel`, `read_at`, `redacted_at`; RLS deny-all, service-role writes); a Worker route to post a message → `writeAudit('message.sent')` → `brevoEmail` fan-out; the message surfaced **read-only in the bride portal (Phase 3)** and authored **from the admin console (Phase 2)**, rendered as a **calm concierge note, not chat bubbles.** State-change emails can be logged into the same thread as `author='system'` so the bride sees one continuous conversation.
**Explicitly later (separate increments):** bride inbound reply (per-booking reply-to + inbound webhook parsing, +3–4 d); artist↔bride threads (gated on Phase 4 roles, +2–3 d); WhatsApp adapter via a BSP (+4–6 d, carries Meta verification + a new POPIA operator agreement); AXIS draft/triage (human-in-the-loop). **First, prove a single thread is used.**
**Depends on:** Phases 2 + 3 (the first slice); Phase 4 (artist threads).

### Phase 6 — White-label extraction · 3–5 d · **triggered, not scheduled**

Do **not** schedule by date. Trigger **only when a real second client is signed.** Extract `@lz/booking-core` + `brand.config` + the theme-token contract + feature flags (see §4). Client #2's deploy is the forcing function that validates the seam. **Cut true multi-tenant entirely.**
**Depends on:** a signed second client + Lustique having proven the shape in production through Phases 1–4.

---

## 6. Central calendar & artist allocation (the Phase 4 detail)

**Native-on-Supabase first; Google two-way sync deferred; raw Google free/busy rejected as primary.** The repo is designed for this: ARCHITECTURE.md §4 + spec §11 name the staffing rule, and spec §6 pre-names the `booking_artists` join as where artist financials attach.

| Option | Verdict | Reason |
|---|---|---|
| **A — Google Calendar free/busy across 9** | later | Needs Workspace domain-wide delegation Lustique hasn't set up; gives no allocation/financials layer; correctness depends on 9 sub-contractors keeping personal calendars accurate; an external API on the critical confirm path; not portable to client #2. |
| **B — Native in-app calendar on Supabase** | **chosen** | One source of truth in the DB Zandeline owns; same PostgREST/service-role pattern; unlocks `booking_artists.pay_cents`; no Workspace dependency; Phase-A needs no end-user auth; deterministic + TDD-able. |
| **C — Hybrid: native truth + opt-in per-artist Google two-way sync** | later | Best of both eventually, but two-way sync (conflict resolution, echo loops, token refresh) is the hardest thing here and has nothing to sync until native exists. |

**Capacity math (pure, TDD):** `requiredArtists(party_size)` = `{≤4:1, 5–8:2, 9–12:3, 13+:4}`. **Keep this separate from pricing's `requestedArtists`** (a bride-requested extra artist = a *charge*, not an allocation) — conflating them mis-staffs or mis-charges. `freeArtistsOn(date)` = active artists − blackouts that day − distinct allocated artists for active bookings that day (mirrors `countBookingsOnDate`).

**Double-booking guard:** a partial unique index over active allocations + atomic compare-and-set inserts (same idea as `transitionBooking`). **Availability stays advisory** even after the auto-check — Zandeline's human confirm remains the final gate, because the auto-count is only as accurate as the blackouts entered.

**Phasing:** Phase 4 ships the native schema + manual allocation + central view + the advisory "X of N free on {date}" warning wired into `request.ts`/`review.ts`. Google sync is a separate later track gated on the Workspace setup + a real auth decision.

---

## 7. The three portals at a glance

| | **Admin (Zandeline)** | **Artist (×9)** | **Client (bride)** |
|---|---|---|---|
| **Audience** | 1 power-user, daily | 9 equal sub-contractors | 1 bride per booking, a few visits |
| **Auth** | magic-link + admin role | magic-link + artist role | magic-link + verified email (AP-1) |
| **MVP core** | pipeline board · review/approve inline · calendar load · blocked-dates · payment/Wave surfacing | my weddings · booking sheet · my availability · acknowledge loop | status timeline · payment history · invoice link · pay-balance · details + artist empty-state |
| **Sees** | everything | only her allocations (join-scoped) | only her own wedding(s) |
| **Later** | analytics · revenue · Google calendar · AXIS COO view | per-booking pay (`pay_cents`) · Google sync · bride-scoped comms · self-service bio | optional "all my bookings" · real artist names · two-way comms · doc upload · trial scheduling |
| **Reuse** | `/api/booking/review`, mark-paid, blocked-dates, payments/invoice/Wave | `db.ts`, `team.ts` slugs, `party_size`+rule, `estimate_input` | `token.ts`, `invoice.ts` pattern, `payments`, Yoco `pay_url`/EFT |
| **Effort (portal-only)** | 6–8 d | 5–7 d (+1–2 d onboarding) | 6–8 d |

> Full per-portal feature breakdowns, brand notes, and risk lists live in the analysis output; the phases in §5 carry the build sequence.

---

## 8. Effort reality-check & top risks

**Trust the sequenced total (~24–36 d for Phases 1–5 single-lane), not the additive brochure total.** Where naive sums lie:

- **Double-counted auth.** Admin (≈9.5 d brochure) and artist (≈7 d) *each* bundle ~1.5 d of auth; the standalone slice is separately 4–7 d. Extracting Phase 1 once drops the portals to portal-only code. **Build them independently and you pay for identity 2–3×.**
- **RLS + TDD is the quiet tax.** Every policy needs a positive *and* a negative test; this burden lives in Phase 1 and is why its lower bound is optimistic.
- **Brand polish ≠ CRUD.** Quiet-luxury UI (Cormorant/Manrope, palette, reduced-motion, mobile+desktop) runs ~1.3–1.5× a utilitarian build. The bride portal and admin shell are where this bites.
- **"Reuse" hides re-verification.** Porting money transitions (`mark-paid`, pay-balance) through a *session* entry point means re-testing money paths, not copy-paste.
- **Real-human onboarding is unbudgeted.** ~3–4 days of non-code change-management for the 9 artists — and Phase 4 isn't "done" until 9 people actually use it.

**Top risks:**
1. **Phase 0 unfinished** — the live smoke test is still skipped; starting Pass 4 first builds on an unproven production loop. *(#1 risk.)*
2. **Live-DB migration with no staging** — a bad RLS policy could over-expose PII or (if someone mistakes the service-role bypass) break the Worker. No preview DB is scoped yet.
3. **Magic-link is a new abuse surface** — link-request flooding, session theft — that the capability-URL model didn't have. Needs a security pass (TTL, single-use, rate-limit, session lifetime) before admin/artist go live.
4. **Token-secret rotation foot-gun** — rotating `SIGNING_SECRET` silently invalidates every outstanding 2-year invoice token + 90-day deposit/balance token. No rotation runbook exists.
5. **9-artist adoption** — if the portal feels like surveillance/extra admin, they revert off-system and Phase 4's value evaporates.
6. **White-label scope creep** under the "agency platform" framing, diverting effort from the one paying client.
7. **POPIA read-audit gap** — giving artists/admin a UI over bride PII without read-logging or fresh consent framing risks the Responsible-Party posture that is the product's core promise.

**Gaps nobody fully scoped (track these):** inbound email/reply-to + bounce handling at scale; magic-link session lifetime/refresh; **read-auditing** of bride PII once portals exist; a staging/preview Supabase; a secret-rotation runbook; artist offboarding / re-allocation lifecycle; whether Zandeline still gets emails *and* the console (dual-channel load); retiring/hardening the legacy `/api/enquiry` + EFT `/confirm` routes.

---

## 9. Decisions for Pieter / Zandeline

1. **Go-live gate** — is the live smoke test signed off and Lustique accepting real bookings **before** any Pass-4 work? Phase 0 must close first. *(Confirm Wave secrets + `ADMIN_SECRET` state too.)*
2. **Staging strategy** — a Supabase branch/preview DB to test the auth+RLS migration, or apply to production `af-south-1` with a tested rollback? *(One-way-door safety call.)*
3. **One lane or two** — capacity to run the bride portal (Phase 3) in **parallel** with the auth+admin track, or strictly sequential? Materially changes the calendar.
4. **Artist allocation policy** — rules for re-allocation after acknowledge, artist offboarding, and whether artists ever see per-booking `pay_cents`. Business policy, not engineering.
5. **White-label trigger** — is there a concrete second client in sight, or is the template aspirational? Decides whether Phase 6 is on any horizon. **Do not pre-build.**
6. **Legacy-route fate** — retire `/api/enquiry` (no Turnstile) + the legacy EFT `/confirm`, or keep them?
7. **AXIS boundary** — confirm AXIS stays a feature-flagged consumer of the Worker event boundary and is **out** of this portal sequence, so it doesn't pull sequencing.

---

## 10. Out of scope / explicitly cut

- **True multi-tenant / shared-DB white-label** — actively harmful (POPIA collapse, cross-client PII bleed). Cut entirely; only the Hybrid extraction (Phase 6) should ever exist.
- **Google Calendar free/busy in the first artist pass** — deferred to a separate stream after manual allocation is trusted.
- **Realtime / chat-bubble comms / WhatsApp / AXIS-triage** — later independent increments, not MVP.
- **Bride "all my bookings" multi-booking account** — a +1 d nice-to-have for the ~95% of brides with one wedding; build only if a real repeat-customer need appears. *(The single-booking magic-link mini-dashboard of AP-1 is the MVP.)*
- **AXIS orchestration brain** — a parallel studio concern behind the stable Worker boundary, not a Lustique roadmap phase.
- **Artist financial dashboards in v1** — keep `pay_cents` in the Phase-1 migration so it isn't painted out, but defer exposing financials until allocation is solid.
- **Drag-to-allocate calendar** — a read-only load-colored month *view* is the MVP; drag-drop is polish.

---

## Appendix A — Schema & RLS sketches (for the Phase 1 plan)

```sql
-- migration 0005_identity_and_allocation.sql

create type app_role as enum ('admin','artist');

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         app_role not null default 'artist',
  artist_slug  text unique,           -- 1:1 with site/src/data/team.ts ids
  display_name text,
  phone        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table booking_artists (
  booking_id     uuid not null references bookings(id) on delete cascade,
  artist_id      uuid not null references profiles(id),
  role_of_day    text not null default 'artist',     -- 'lead' | 'artist' (per-booking, NOT a rank)
  pay_cents      int,                                 -- seam ships now; UI deferred
  status         text not null default 'assigned',    -- 'assigned' | 'accepted' | 'declined'
  acknowledged_at timestamptz,
  assigned_at    timestamptz not null default now(),
  primary key (booking_id, artist_id)
);

create table artist_unavailability (
  artist_id uuid not null references profiles(id) on delete cascade,
  date      date not null,
  reason    text,
  primary key (artist_id, date)
);

create table messages (                                -- Phase 5
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  direction   text not null,                            -- 'outbound' | 'inbound'
  author      text not null,                            -- 'agency' | 'bride' | 'artist' | 'system'
  body        text not null,
  channel     text not null default 'email',            -- 'email' | 'inapp' | 'whatsapp'
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  redacted_at timestamptz
);

alter table profiles, booking_artists, artist_unavailability, messages
  enable row level security;                            -- deny-all; service_role writes

-- non-recursive role lookup for RLS clauses
create or replace function current_role() returns app_role
  language sql security definer stable set search_path = public as
$$ select role from profiles where id = auth.uid() $$;
```

**RLS rules (recap):** all new policies are `for select to authenticated`; never `FORCE` RLS; never a `service_role` policy. Artists read only their own `booking_artists`/`artist_unavailability` and join-scoped `bookings`; they get **no** `payments` access. Brides read only `bride_email = auth.email()` rows. Admin reads all. Every migration ships with positive **and** negative policy tests proving the service key still writes and that an artist cannot read a booking she isn't on.

---

*Prepared by the planning (Opus) lane. Build is Sonnet's: the one-way-door calls (auth mechanism, role model, the `profiles`/`booking_artists` enums + keys, RLS shape, white-label posture) are settled here; the implementation is routine TDD on a trusted foundation. Per device standard — Opus plans, Sonnet builds.*
