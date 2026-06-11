# Lustique — Claude Guide

Device-wide rules: `~/.claude/CLAUDE.md` (Opus plans / Sonnet builds · lean context). Those rules apply here unchanged; this file adds only project-specific facts.

## What this project is
Bridal hair & makeup website + booking platform for **Lustique Co.** (Pretoria; founder Zandeline Kemp, 9 artists). This is Layer Zero Studios' client #1 and the reusable custom-build template.

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
- `STANDARDS.md` · `SECURITY.md` · `SETUP.md` · `TODO.md`
- `docs/superpowers/specs/2026-06-05-lustique-booking-core-design.md` — booking core spec
- `docs/superpowers/plans/2026-06-05-lustique-booking-s1-data-layer.md` — S1 build plan

## Project conventions
- TDD for all `shared/pricing` and booking logic (single source of money truth)
- `npm install` only in Pieter's terminal (sandbox blocks network installs)
- Project is in iCloud-synced `~/Documents` → Vite HMR uses polling (`astro.config.mjs`)
- Safari caches JS hard — use hard-refresh or private window for verification
- Accounts: client-owned (Cloudflare · Supabase · Workspace · Yoco · Brevo · Sanity); LZ invited as Administrator

## Studio Manager bridge
This project may post requests to the Studio Manager — see `_ops/BRIDGE-PROTOCOL.md`.

## In-flight context
See `SESSION_HANDOFF.md` for the current baton (▶ NEXT).
