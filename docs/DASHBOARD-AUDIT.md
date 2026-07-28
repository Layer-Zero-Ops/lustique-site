# Lustique Dashboard Audit + 6-Pillar Onboarding Plan

**Date:** 2026-07-27 · **Author:** Aria (LZS agent) · **Status:** For Pieter sign-off
**Constraint:** No live-site contact. All build work happens on `feature/*` branches → `dev` (staging). Live `main` untouched until a proven-better swap is approved.

---

## 1. Audit method
Read the actual dashboard code (`worker/src/booking/dashboard.ts` 2,249 lines, `enquiries.ts`, `contacts.ts`). This is a code-grounded audit, not generic advice.

## 2. What exists today
| Area | Present | Notes |
|---|---|---|
| Inbox | ✅ | Active bookings list (ref, bride, date, town, party, total, status, clash flag) |
| Invoices/Quotes | ✅ | Tabs: Pending (14-day expiry countdown), Confirmed, Payments (Yoco/EFT) |
| Booking detail | ✅ | Full record, editable total, quote-revision history, grouped hair lengths |
| Rejections | ✅ | Declined bookings w/ reason |
| Calendar | ✅ | Month grid + blocked-date slots editor |
| Enquiries / Contacts / CRM | ✅ | Enquiry inbox w/ status filter; contacts w/ bulk import |
| Notifications | ✅ | Bell + JSON endpoint + mark-read |
| Templates / Website / Blog / Staffing | ✅ | Config surfaces |

**Verdict:** the bones are sound — it is an operational *list viewer*, not a *control panel*.

## 3. Critical gaps
### A. Zero business intelligence
No single KPI anywhere. Conversion %, revenue, pipeline, collection %, utilization %, at-risk — none computed or shown. Aria's North-Star metrics (conversion >60%, response <15min, collection 100%, utilization >80%, referral >30%) are measured nowhere in the UI.

### B. "Form submissions all over the place" (your exact pain)
Submissions land in **4+ separate tables** with no unified object or workflow state machine:
- `enquiries` (website form) — 11 orphans with no `booking_id` (caught by drift sweep)
- `bookings` (converted/created)
- `contacts` (manual CRM / bulk import)
- `rejections` (declined)
No archive/soft-delete exists — they accumulate forever. No bulk actions.

### C. No act-at-scale
No bulk archive/delete, no search beyond status, no inline status advance, no note thread, no reminder send, no client-360.

### D. Pull-only, no triage
Dashboard waits for Zandeline to go look. No "Needs attention" smart view aggregating expiry <48h, overdue balances, clashes, stale enquiries.

### E. Missing operational capabilities
Deposits/balances collection view + one-click remind · artist allocation board (`booking_artists` exists, unsurfaced) · Wave CSV export (Zandeline uses Wave) · mobile-responsive shell (she's mobile-first; current UI is desktop tables).

## 4. Phase 1 (quick, high-leverage — this branch)
Directly fixes B + D + starts A:
1. **Unified inbox** — single timeline of enquiries + bookings + contacts + rejections, status workflow (New→Contacted→Quoted→Booked→Done / Archived).
2. **Bulk archive/delete** — Zandeline can clean up. Adds `archived_at` + `deleted_at` (soft delete) to the lead object.
3. **"Needs attention" smart view** — expiry <48h, overdue balances, clashes, stale enquiries >7d, zero-totals.
4. **KPI header** — computed from existing tables: pipeline value, booked revenue, collection %, open enquiry count, at-risk count.

Out of scope Phase 1: client-360, artist board, Wave export, mobile CSS (Phase 2).

## 5. Build vs. reshape — the 6-pillar lens
This dashboard audit is the *practicability* layer. Separately, per Pieter's mandate, Lustique is being **onboarded onto the 6 pillars** as a parallel build. The dashboard's gaps map onto pillars:
- **Pillar 1 (full-journey):** current covers enquiry→booking→payment but gaps post-wedding (review/referral) and pre-enquiry (marketing attribution).
- **Pillar 2 (connected):** 4 tables, no unified lead → re-entry/drift risk (the 11 orphans).
- **Pillar 3 (trigger automation):** reminders/cron exist but no "when X then Y" surface in the dashboard.
- **Pillar 4 (AI invisible):** Aria is the invisible engine — must be wired to dashboard actions, not just chat.
- **Pillar 5 (compliance):** audit_log exists; consent/POPIA not surfaced in flow.
- **Pillar 6 (outcome):** dashboard shows features, not reclaimed time.

See `WORKFLOW-MAP.md` (Step 3 of onboarding) for the full pillar scorecard.

## 6. Execution rules
- All Phase 1 code on `feature/dashboard-phase1` → `dev` (staging). Never `main`.
- TDD for any money/pricing logic (shared convention).
- Drift sweep + tests must stay green.
- Swap to live only after: (a) all 6 pillars scored pass, (b) Pieter confirms "better," (c) staging review.
