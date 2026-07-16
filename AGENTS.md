# Lustique — Agent Guide

## ⚠️ IDENTITY — who you're talking to (read first)

- **WhatsApp message = ZANDELINE KEMP**, founder/owner of Lustique Co. Never call her Pieter.
- **Desktop/CLI = PIETER KEMP**, Chairman (Layer Zero Studios). Technical depth OK here.

Device-wide rules: `~/.config/opencode/AGENTS.md` (GLM 5.2 plans / Minimax M3 builds · lean context). Those rules apply here unchanged; this file adds only project-specific facts.

## What this project is
Bridal hair & makeup website + booking platform for **Lustique Co.** (Pretoria; founder Zandeline Kemp, 9 artists). This is Layer Zero Studios' client #1 and the reusable custom-build template.

## Roadmap
- `PLAN.md` — business decisions, build sequence, locked choices (read this for the full roadmap)
- `SESSION_HANDOFF.md` — rolling baton (▶ NEXT = current task)
- Current state: ▶ NEXT = ENV-RETROFIT (dev branch + staging Worker + `lustique_staging` schema + test keys) → then TASK-D (Yoco Pay Now)

## Stack
- `site/` — Astro (npm workspace), deployed to Cloudflare Pages
- `worker/` — Cloudflare Worker: booking API (`/api/*`), daily balance cron, R2 audit log
- Supabase (client-owned): bookings/payments/audit_log schema + RLS
- Yoco API — payment links for deposits + balance
- Brevo — transactional email (6 email types across the booking flow)

## Key files (read in this order for full context)
- `PLAN.md` — business decisions, build sequence, locked choices
- `BRAND.md` — voice, visual identity, quiet-luxury mandate
- `PRICING.md` — pricing model + estimator spec
- `ARCHITECTURE.md` — system design
- `STANDARDS.md` · `SECURITY.md` · `SETUP.md`
- `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` — booking core spec

## 🔴 Deploy protection — enforced, zero exceptions

This project is live at `lustiqueco.co.za`. **A broken build on `main` takes the live site down for a real client.**

**Branch workflow (mandatory):**
```
feature/* → dev → (PR, Pieter reviews staging) → main
```
- `feature/*` branches off `dev` — where all work happens.
- Merging to `dev` auto-deploys to staging (CF Pages preview + `lustique-form-handler-staging`).
- `main` auto-deploys to production.
- **Never commit app code directly to `main`. No exceptions. Not even a one-liner.**
- A broken build on `dev` only breaks the preview URL — the live site is unaffected.
- Baton/docs-only commits (`SESSION_HANDOFF.md`, `*.md` docs) may go to `main` directly.

If a build breaks: fix it on the branch. Never merge a broken build to unblock yourself.

See `~/Layer-Zero-Studios/_ops/ENVIRONMENT-STANDARDS.md` §7 for the full protection model.

## Project conventions
- TDD for all `shared/pricing` and booking logic (single source of money truth)
- `npm install` only in Pieter's terminal (sandbox blocks network installs)
- Project is in iCloud-synced `~/Documents` → Vite HMR uses polling (`astro.config.mjs`)
- Safari caches JS hard — use hard-refresh or private window for verification
- Accounts: client-owned (Cloudflare · Supabase · Workspace · Yoco · Brevo · Sanity); LZ invited as Administrator

## Studio standards (non-negotiable)
- Security: `~/Layer-Zero-Studios/_ops/SECURITY-STANDARDS.md`
- Quality: `~/Layer-Zero-Studios/_ops/QUALITY-STANDARDS.md`
- Dev conventions: `~/Layer-Zero-Studios/_ops/DEV-STANDARDS.md`
- Go-live gate: `~/Layer-Zero-Studios/_ops/CLIENT-DELIVERY-CHECKLIST.md`

## In-flight context
See `SESSION_HANDOFF.md` for the current baton (▶ NEXT).
