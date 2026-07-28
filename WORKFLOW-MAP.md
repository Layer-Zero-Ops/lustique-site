# Lustique — Workflow Map (6-Pillar Onboarding)

**Date:** 2026-07-27 · **Owner:** Aria (LZS agent) · **Standard:** `WORKFLOW-AUTOMATION-STANDARD.md` v1.0
**Preset applied:** Agency/Consulting (Lead → Discovery → Proposal → Contract → Delivery → Renewal), expressed for bridal as Inquiry → Quote → Invoice → Reminder → Review → Referral.
**Status:** Parallel build. Live site untouched. Swap only after all 6 pillars score PASS and Pieter confirms "better."

---

## The 7-stage chain, mapped to Lustique today

| Stage | What happens now | Pillar coverage |
|---|---|---|
| TRIGGER | Bride submits website enquiry form (Wave E) | P1 ✅ P3 ✅ (enquiry → notification) |
| CAPTURE | `enquiries` row + Brevo confirm email + admin notification | P2 ⚠️ (enquiry/booking are separate objects — drift risk) |
| PROCESS (AI) | Aria (Telegram) can answer from live data via aria-grounding | P4 🟡 (wired, not yet embedded in dashboard actions) |
| DELIVER | Quote/invoice emailed via Brevo; dashboard shows status | P2 ✅ P5 ✅ (audit_log) |
| CONFIRM | Bride accepts (dashboard status) / pays deposit (Yoco/EFT) | P3 ✅ (balance cron) |
| FOLLOW-UP | 14-day quote expiry, balance-due reminders (cron) | P3 ✅ but P6 ⚠️ (not framed as reclaimed time) |
| MEASURE | **NONE in UI** — KPIs exist only in Aria's SOUL + drift sweep | P1 ❌ P6 ❌ (no measurement surface) |

## Pillar scorecard (live build)

| # | Pillar | Score | Evidence |
|---|---|---|---|
| 1 | Full-journey coverage | 🟡 IN PROGRESS | Post-wedding now a real stage: review_requested_at/referral_captured_at + review-request action; auto-trigger cron pending |
| 2 | Connected, not point tools | 🟡 IN PROGRESS | Unified inbox merges sources; enquiries now carry a canonical `lifecycle` (0029) so enquiry→booking is one tracked lead. `leads` view not yet materialised |
| 3 | Trigger automation | ✅ PASS | Quote expiry, balance cron, notifications all event-driven |
| 4 | AI invisible engine | 🟡 IN PROGRESS | Dashboard 'Ask Aria' button writes a directive to agent_bridge; Aria reads it in Telegram. Hook live once Aria's reader is wired to the queue |
| 5 | Compliance by default | ✅ PASS | audit_log, RLS, JWT-gated admin, consent via Brevo |
| 6 | Outcome-framed | ✅ PASS | Dashboard opens on outcome hero ("this week the business ran itself") with admin reclaimed + coordination + **automation coverage %** + momentum |

**Verdict:** 4 pass, 0 partial, 2 in-progress, 0 fail. P1/P2/P4 in-progress (hooks live pending Aria reader + auto-trigger cron); P6 (outcome) now PASS via automation-coverage headline. Pre-enquiry marketing attribution still loose.

## Phase 1 contribution to the pillars
- **P1 (coverage):** Unified inbox + KPIs begin the MEASURE stage (was missing).
- **P2 (connected):** Unified inbox merges enquiry/booking/rejection into one timeline (reduces the 4-table fragmentation).
- **P6 (outcome):** KPI header surfaces booked/collected/at-risk — the first outcome-framed surface.

## Phase 5 contribution (Pillar 6 — outcome)
- **P6 (outcome):** `automationCoveragePct` added + surfaced in the hero ("Automated X%") and the "this week, the business ran itself" headline now triggers on high coverage + healthy coordination. Pillar 6 → **PASS**.
- **P4 (AI invisible):** New `aria-bridge.ts` + `handleAdminAriaTask` posts a `directive` to `agent_bridge` (desktop->aria) when Zandeline clicks "✦ Ask Aria" on a booking (3 tests). Aria's Telegram loop reads pending directives and acts invisibly — no manual email drafting. Hook is live the moment Aria's reader polls `agent_bridge`.
- **P1 (coverage):** Migration 0030 adds `review_requested_at`/`referral_captured_at`/`review_url` + notification types. `post-wedding.ts` decides the next post-wedding action (review → referral → complete) and composes on-brand copy (10 tests). Admin "Request Review" button on settled bookings emails the bride + stamps the column. Closes the journey gap from enquiry→payment to enquiry→payment→**review→referral**→past-client.
- **P2 (connected):** Migration 0029 adds `enquiries.lifecycle` (enum) + `matched_at`. `lead-lifecycle.ts` derives ONE canonical lifecycle per submission (new→contacted→quoted→booked→declined→archived), orphan-proofing the inbox. Enquiries without a booking still show as a tracked lead with a "⚠ no booking" flag instead of vanishing into 4 screens.
- **P6 (outcome):** Dashboard opens on an outcome hero — "This week, the business ran itself" — with admin-hours reclaimed (computed from real automation events in `notifications`), coordination score /100, and momentum label. KPI table demoted to secondary detail. Closes the pillar-6 FAIL.

## Remaining to reach "all 6 PASS" (parallel build, staging-only)
1. **Pillar 6 — outcome layer:** dashboard opens on "X hours of admin reclaimed this week" + coordination score, not tables.
2. **Pillar 1 — post-wedding:** review-request + referral capture in the flow (currently absent).
3. **Pillar 2 — true unification:** a `leads` object (or stable view) so enquiry→booking→contact is one entity, killing orphans.
4. **Pillar 4 — embed Aria:** dashboard action buttons trigger Aria tasks (e.g. "draft follow-up") invisibly.

## Enforcement note
Per `WORKFLOW-STANDARD-MANDATE.md`, this map is kept current, not a one-time sweep. Next review after Phase 2.
