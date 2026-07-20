# Roadmap — Self-Optimizing Agent Layer (Clio v2)

**Status:** approved by Pieter (2026-07-17). Foundational branch: `feature/clio-learning`.
**Principle:** the system *learns from its own data, proposes changes with a why, and implements
them successfully* — but **never edits code or live bride content directly**. Every actuation
targets a **config document** (Sanity / Supabase config row) that the agent can also *revert*,
so a failed experiment can't break the live client site. High-stakes proposals sit behind a
**human approval rail** (Zandeline taps in Telegram).

\* "successfully" = measured uplift on a before/after cohort **or** auto-revert before the
  rollback timer fires. Not "I changed something."

## The loop (one cycle per nightly pass)
```
DATA (Supabase: enquiries, bookings, payments, clio_activity  +  GA4 events)
   │  nightly, inside scheduled()
   ▼
LEARN   → clio computes insights + PROPOSES a change (hypothesis + expected effect + rollback)
   ▼
PROPOSE  → writes clio_proposals (status: 'proposed') + notifies Zandeline in Telegram
   ▼  her tap (approve) = authorization
EXECUTE → applies change to a CONFIG doc (pricing rule / brand token / automation / SEO copy)
   ▼  change lives; GA4 measures the next cohort
MEASURE → clio reads new data, marks proposal won/lost, writes clio_learning (the playbook)
```

## 5 highest-leverage actions (build order)
1. **`clio_proposals` + `clio_learning` tables** — the memory + the rail. Without persisted
   learning, "learning from its own data" is a prompt that forgets every run.
2. **Nightly insight pass in `scheduled()`** — reuses the existing cron. Reads real conversion
   data (GA4 now wired, Supabase wired) and *proposes*, e.g. "Trial traffic converts 2% vs
   6% for Portfolio — propose swapping the hero line."
3. **Config-only actuation** — every knob Clio can turn is a Sanity/Supabase doc it can also
   revert. The "implement successfully" part, with a safety net.
4. **Causal, not correlational, claims** — forces before/after measurement + rollback timer.
   "Implemented" means *measured uplift or auto-reverted*.
5. **Transparent learning log Zandeline can read** — the anti-black-box. She sees every proposal,
   its why, and the verdict. Makes a self-optimizing agent acceptable to a non-technical owner.

## 2 moves we're NOT talking about (the real edge)
- **(A) Optimize the OFFER, not just the page.** Data shows which enquiry *sources* become
  bookings vs die. Clio can propose "Tash Studio referrals convert 40% better → dedicated
  referral landing + thank-you flow," or "Monday enquiries never book → propose Tue-only contact
  window." That's revenue logic no website vendor touches.
- **(B) Learning compounds ACROSS clients (template playbook).** Lustique is "client #1 and the
  reusable custom-build template." Anonymized patterns (seasonal dead-zones, pricing psychology
  that works in ZA bridal) write to a studio-level playbook that makes every *next* client's site
  start smarter. A moat no agency has.

## 3 changes that accompany the agent better (non-breaking, all additive)
1. **`GET /api/clio/learning`** — one call gives the agent the playbook + open bets, instead of
   rebuilding context from raw tables each run.
2. **`proposal` field schema** — each proposal carries `hypothesis`, `expected_effect`,
   `rollback`, `cohort_key`. Agent acts on structure, not prose; Zandeline approves on facts.
3. **Safe-change allowlist in config** — declares which docs/keys Clio may touch and which it
   *never* may (code, bride PII, live invoices). The rail is explicit, so it can't drift.

## Branch / deploy path
```
feature/clio-learning  →  dev  →  (PR, Pieter reviews staging)  →  main
```
Migrations 0027 + 0028 apply via Supabase SQL Editor (live /sql is IP-blocked from the agent).
The nightly pass is inert until proposals are approved — zero live behaviour change on merge.
See `docs/SQL-PACK-clio-and-realtime.md` for the SQL-apply convention.

## Out of scope (intentionally)
- Drag-drop page builder (not the goal; loses brand/SEO/ownership edge).
- Infinite app marketplace (Wix's store); we wire the 4–5 integrations Zandeline actually uses.
- Agent editing application code or bride-facing copy directly (rail forbids it).
