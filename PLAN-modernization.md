# Lustique Modernization Plan — sign-off tracking

**Status:** Signed off by Pieter (2026-07-28). Branch workflow enforced: `feature/* → dev → (review staging) → main`.
**Live incident context:** Zandeline's test submission reached the thank-you page but was NOT persisted — the live Worker is an older build returning `ok:true` without running persist/email. Current `dev` code (persist-before-Turnstile fail-safe + tidy worker + soft-delete, migrations 0031/0032) fixes this. Deploy `dev → main` after migration 0032 is run.

## Locked decisions
- **Email:** Design for **Spacemail API from the start**. `messages` table is mailbox-agnostic; primary fetcher = Spacemail (IMAP/API). Gmail connection kept **read-only** for calendar/contacts during the Workspace→Spacemail overlap, NOT system of record.
- **Aria:** Zandeline's **business assistant** — dedicated in-dashboard chat UI on `agent_bridge`, real authority over business functions via a capability layer, and a written **runbook** (operating instructions per process).
- **Risk gating:** Anything **med-high risk is gated** (requires Zandeline's explicit approve). Low-risk (read, draft, archive, tidy) auto-executes; medium logs + notifies; high (external send, mark paid, refund, delete) requires approval before execution.
- **Production-grade:** dashboard must reflect a real shipped product, working end-to-end against live Supabase + Brevo + Yoco + email. No demo seams.

## Build sequence
- **P0 — Deploy current `dev` → `main`** (closes live incident). ~5 min. Risk: medium (live deploy) — approved as part of sequence. *Action: Pieter merges dev→main after migration 0032.*
- **P1 — Aria chat UI + capability layer + runbook.** Dashboard "✦ Aria" panel (chat thread on `agent_bridge`, approve-gated actions), capability registry with risk tiers, Aria operating-instructions doc. ~3–4 d. Risk: medium.
- **P2 — Real inbox (Spacemail).** `messages` table + Spacemail fetcher (scheduled sync, ~5–10 min poll), merged into unified timeline with Reply (Aria drafts → Zandeline approves → sends via Spacemail SMTP). ~4–6 d. Risk: medium-high (needs Spacemail creds + POPIA). *Blocked until Spacemail account created.*
- **P3 — Close loose ends.** Auto-trigger review/referral cron, Aria↔Telegram bridge live (poll `agent_bridge`), pre-enquiry marketing attribution. ~2–3 d. Risk: low-medium.
- **P4 — Production polish.** Tabbed shell (Inbox · Bookings · Enquiries · Reviews · Aria · Settings), mobile, real KPIs, scheduled weekly "tidy". ~2 d. Risk: low.

## Open items / dependencies
- Spacemail account creation (Pieter) → unblocks P2 fetcher.
- Spacemail IMAP/SMTP (or API) credentials → P2.
- Gmail OAuth read-only consent (transition window) → optional P2 overlap.
- Aria authority envelope confirmed: draft = auto, external send/mark-paid/refund/delete = gated. (Signed off.)

## Verification gate (all phases)
- `npm run test` (vitest) green on worker.
- `npx wrangler deploy --dry-run` exit 0 on worker.
- Site builds in CI/staging (Astro; `npm install` blocked in sandbox).
- No app-code commit to `main` except via Pieter's reviewed merge.
