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
| 1 | Full-journey coverage | ⚠️ PARTIAL | Covers inquiry→payment; gaps post-wedding (review/referral) + pre-enquiry (marketing attribution) |
| 2 | Connected, not point tools | ⚠️ PARTIAL | 4 tables, no unified lead; 11 orphan enquiries prove re-entry/drift |
| 3 | Trigger automation | ✅ PASS | Quote expiry, balance cron, notifications all event-driven |
| 4 | AI invisible engine | 🟡 IN PROGRESS | Aria grounded + drift sweep live; not yet embedded in dashboard actions |
| 5 | Compliance by default | ✅ PASS | audit_log, RLS, JWT-gated admin, consent via Brevo |
| 6 | Outcome-framed | 🟡 IN PROGRESS | Dashboard opens on outcome hero (admin reclaimed + coordination score + momentum); KPI bar demoted to secondary. Narrative still being tuned |

**Verdict:** 3 pass, 1 in-progress, 2 partial, 0 fail (was 1 fail). Pillar 6 closed from FAIL → IN PROGRESS by Phase 2 outcome hero. Remaining partials (P1 post-wedding, P2 true unification, P4 Aria-embed) are the next gaps before "all 6 PASS".

## Phase 1 contribution to the pillars
- **P1 (coverage):** Unified inbox + KPIs begin the MEASURE stage (was missing).
- **P2 (connected):** Unified inbox merges enquiry/booking/rejection into one timeline (reduces the 4-table fragmentation).
- **P6 (outcome):** KPI header surfaces booked/collected/at-risk — the first outcome-framed surface.

## Phase 2 contribution (outcome layer)
- **P6 (outcome):** Dashboard opens on an outcome hero — "This week, the business ran itself" — with admin-hours reclaimed (computed from real automation events in `notifications`), coordination score /100, and momentum label. KPI table demoted to secondary detail. Closes the pillar-6 FAIL.

## Remaining to reach "all 6 PASS" (parallel build, staging-only)
1. **Pillar 6 — outcome layer:** dashboard opens on "X hours of admin reclaimed this week" + coordination score, not tables.
2. **Pillar 1 — post-wedding:** review-request + referral capture in the flow (currently absent).
3. **Pillar 2 — true unification:** a `leads` object (or stable view) so enquiry→booking→contact is one entity, killing orphans.
4. **Pillar 4 — embed Aria:** dashboard action buttons trigger Aria tasks (e.g. "draft follow-up") invisibly.

## Enforcement note
Per `WORKFLOW-STANDARD-MANDATE.md`, this map is kept current, not a one-time sweep. Next review after Phase 2.
