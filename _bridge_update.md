## ⇄ Umbrella (project ↔ Studio Manager · see _ops/BRIDGE-PROTOCOL.md)

**⬆ To umbrella / Pieter — 2026-08-01 (Saturday cron sweep)**

### 🔴 FLAG: Kerry Bettencourt — NO FOLLOW-UP YET (10 days)
Newest enquiry (2026-07-28), wedding 2026-10-18. Still "new", notification unread. This is the warmest qualified lead in the pipeline. Needs Zandeline to follow up immediately.

### 🔴 FLAG: Lee-Ann Saunders (LUS-2026-89F517) — LOST
Confirm token expired 2026-07-23. Still "requested" at R5,790 for wedding 2026-10-24. No re-engagement action taken. Either close or re-engage — status quo is a zombie.

### 🟡 FLAG: 3 booking confirm tokens expire TOMORROW (2026-08-04)
- **Cathleen Benade** — R2,890 (not R2,890 — wait, total_cents=0, this one is incomplete), wedding 2027-11-13
- **Megan Brits** — R6,225, wedding 2026-11-07
- **Leigh Jones** — R7,776, wedding 2027-05-01

All three are still "requested" (bride hasn't confirmed). Tokens expire in 3 days. Zandeline should reach out now.

### 🟡 FLAG: Zero payments — still no revenue through the system
Payments table remains empty. Yoco test booking (LUS-2026-35DD00, R20, R5 deposit_net_cents) "accepted" since July 2 but never received a payment. The 403 error was never resolved.

### 🟡 FLAG: Site NOT deployed (22 days stale)
| Page | Status |
|------|--------|
| `lustiqueco.co.za` (home) | ✅ 200 |
| `/venues` | ❌ 404 |
| `/book` | ❌ 404 |
| `/vendors` | ✅ 200 (likely always existed or deployed via separate path) |
| `/pricing` | ✅ 200 |

The July 11 feature set (317-venue directory, quote-form travel/pricing fixes, bride service selection, referral-link capture) is still not live. The Node/Supabase DNS build blocker needs a production-environment fix attempt.

### 🟡 FLAG: Migration 0025 (referral_source column) — NOT APPLIED
The column exists on the table schema but all 20 enquiries show null for referral_source. The migration SQL (`supabase/migrations/0025_enquiry_referral_source.sql`) needs to be run via Supabase SQL editor.

### 🟡 FLAG: Arisha Pursad — duplicate enquiries, no event date
Two submissions 5 min apart on 2026-07-17. Both still "new". Needs cleanup.

### 🟡 FLAG: All 20 notifications are unread
This may be a system issue where notifications are never automatically marked as read, or Zandeline hasn't logged into the admin dashboard. Worth investigating which — if she's logging in and they're not clearing, that's a UX bug.

### 🟢 FYI: No new enquiries since July 28
Last new enquiry was Kerry Bettencourt on July 28. Nothing since July 31 sweep.

### 🟢 FYI: Enquiry count increased to 20 (was 18 on Jul 30)
The two Pieter Kemp test submissions (Jul 16) were already present in the Jul 30 data but the count was stated as 18 then. Either way, no material change.

### 🟢 FYI: Bookings unchanged
8 bookings total. Same statuses as July 31. Details with bride names:
| Ref | Bride | Status | Amount | Deposit | Wedding | Token |
|-----|-------|--------|--------|---------|---------|-------|
| LUS-2026-A94320 | Zandeline Kemp | requested | R8,965 | R0 | Jun 27 | Expired Jul 8 |
| LUS-2026-D21FA6 | Zandeline Kemp | accepted | R1,345 | R1,345 | Sep 24 | Expired Jul 9 |
| LUS-2026-FEEBB5 | Bianca Du Preez | invoice_expired | R21,229 | R0 | Jan 16, 2027 | Expired Jul 8 |
| LUS-2026-AE61AD | Cathleen Benade | requested | R0 | R0 | Nov 13, 2027 | 2026-08-04 ⏰ |
| LUS-2026-35DD00 | Test Bride (Yoco QA) | accepted | R20 | R5 | Mar 15, 2027 | Expired Jul 16 |
| LUS-2026-89F517 | Lee-Ann Saunders | requested | R5,790 | R0 | Oct 24, 2026 | Expired Jul 23 |
| LUS-2026-1B970F | Leigh Jones | requested | R7,776 | R0 | May 1, 2027 | 2026-08-04 ⏰ |
| LUS-2026-B66B04 | Megan Brits | requested | R6,225 | R0 | Nov 7, 2026 | 2026-08-04 ⏰ |

### ⬇ From umbrella: None (no pending directives)

---

### Agent observation — Lustique pulse, 2026-08-01 (Saturday, cron sweep)

No coaching observation (Saturday, not Monday).

**What most needs Zandeline/Pieter's attention (by urgency):**
1. 🔴 **Kerry Bettencourt** — 10 days without follow-up on the warmest lead ever. Wedding in ~78 days.
2. 🔴 **3 confirm tokens expiring Aug 4** — 3 brides about to drop out of the pipeline simultaneously.
3. 🔴 **Site deployment** — 22 days stale. The full feature set is sitting on `dev` not live.
4. 🟡 **Yoco 403** — System has never processed a real payment. R20 test booking from July 2 still unpaid.
5. 🟡 **Lee-Ann Saunders** — Expired confirm-token, decision needed: re-engage or close.
6. 🟡 **Bianca Du Preez** — R21,229 invoice_expired. Largest potential booking that was lost/timed out.
