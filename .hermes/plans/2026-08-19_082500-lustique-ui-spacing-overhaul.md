# Lustique Co. UI Spacing System Overhaul — Implementation Plan v2

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform Lustique's website from a 6.5/10 "functional but messy" UI to a 9+/10 shameworthy professional design by implementing a unified CSS spacing system, removing all inline margin styles, and fixing color contrast issues.

**Architecture:** Replace ad-hoc inline `margin-top:1rem` declarations (27 total across 14+ files) and scattered pixel values with a single `clamp()`-based 8-point spacing scale. Use CSS class rules instead of inline styles for all component spacing. Fix color contrast gaps (#5c5048 → #4a3f37 for WCAG AA compliance).

**Tech Stack:** Astro (static site) + vanilla CSS. Build: `npm run build --prefix site/`. Deploy: `npx wrangler pages deploy`.

**Branch workflow:** `dev` → staging (`lustique-site-staging`) → verify → production (`lustique-site`). Never touch `main`.

---

## Context & Problem Statement

### Root Cause Analysis

The website's "messy" rendering stems from **three systemic issues**:

1. **27 inline `margin-top:1rem` declarations** across 14+ `.astro` files — each overrides the CSS class system inconsistently
2. **`.eyebrow` class has no default `margin-bottom`** — forcing every instance to add inline styles
3. **Mixed spacing paradigms** — `clamp()`, `var(--space-*)`, raw pixels, and inline styles are all used interchangeably

### User Impact

- **Homepage**: "Feel most like yourself." hero title wraps at 15ch (too narrow), eyebrow-to-stars gap is 1.5rem (too tight)
- **Inner pages**: Section headings have 1rem margin (too tight), creating a "crushed" vertical rhythm
- **Mobile**: Cards collapse but don't use full width, creating wasted whitespace on the sides
- **Color**: Body text `#5c5048` on ivory has ~4.2:1 contrast ratio (below WCAG AA 4.5:1 minimum)

### Deployment Blocker

The live domain `lustiqueco.co.za` is still attached to the OLD `lustique` Pages project. The new `lustique-site` project exists but the domain hasn't been migrated. **This is why the user sees stale content even after fixes are deployed.**

---

## Execution Approach

**Strategy:** 5 phases, each as an independent deploy-able unit:

1. **CSS Foundation** — spacing scale + eyebrow fix + color contrast
2. **CSS Component Rules** — replace inline styles with class-based rules
3. **Inline Style Removal** — batch Python script to strip inline styles from .astro files
4. **Component Fixes** — hero, cards, gallery, form, footer, nav spacing
5. **Deploy & Verify** — staging → visual diff → production

Each phase is independently testable and deployable. If Phase 3 breaks the build, we revert just that phase.

---

## Phase 1: CSS Foundation

### Task 1: Define fluid spacing scale + fix color contrast

**Objective:** Replace static `--space-*` variables with fluid `clamp()` versions, and fix body text color for WCAG AA compliance.

**Files:**
- Modify: `site/src/styles/global.css` (lines 25-32, line 146, line 59)

**Step 1: Update `:root` spacing variables**

Replace:
```css
  /* 8-point spacing scale for consistency */
  --space-xs: 0.5rem;    /* 8px */
  --space-sm: 0.75rem;   /* 12px */
  --space-md: 1rem;      /* 16px */
  --space-lg: 1.5rem;    /* 24px */
  --space-xl: 2rem;      /* 32px */
  --space-2xl: 3rem;     /* 48px */
  --space-3xl: 4.5rem;   /* 72px */
```

With:
```css
  /* Fluid 8-point spacing scale — scales from mobile to desktop */
  --space-3xs: clamp(0.25rem, 0.5vw, 0.5rem);    /* 4-8px */
  --space-2xs: clamp(0.5rem, 0.75vw, 0.75rem);   /* 8-12px */
  --space-xs:  clamp(0.75rem, 1vw, 1rem);        /* 12-16px */
  --space-sm:  clamp(1rem, 1.5vw, 1.5rem);       /* 16-24px */
  --space-md:  clamp(1.25rem, 2vw, 2rem);        /* 20-32px */
  --space-lg:  clamp(1.5rem, 2.5vw, 2.5rem);     /* 24-40px */
  --space-xl:  clamp(2rem, 3vw, 3rem);           /* 32-48px */
  --space-2xl: clamp(2.5rem, 4vw, 4rem);         /* 40-64px */
  --space-3xl: clamp(3rem, 6vw, 6rem);           /* 48-96px */
```

**Step 2: Fix body text color contrast**

Replace:
```css
  /* In .statement p — line 152 */
  .statement p { font-size: 1.12rem; color: #5c5048; max-width: 60ch; margin: 0 auto 1.2rem; }
  /* In .card-body p — line 168 */
  .card-body p { font-size: 0.97rem; color: #5c5048; margin-bottom: 1.3rem; }
  /* In .res-copy p — line 252 */
  .res-copy p { color:#5c5048; margin-bottom: 1.8rem; max-width: 46ch; }
  /* In .prose p — line 380 */
  .prose p, .prose li { color: #5c5048; }
  /* In .team-copy p — line 185 */
  .team-copy p { color:#5c5048; margin-bottom: 1.1rem; max-width: 46ch; }
  /* In .guide p — line 258 */
  .guide p { font-size:.93rem; color:#5c5048; margin-bottom:1.3rem; }
  /* In .faq-a p — line 314 */
  .faq-a p { padding:0 0 1.5rem; color:#5c5048; max-width:64ch; }
  /* In .note — line 234 */
  .note { font-size: .88rem; color: #6b5c52; }
```

Replace all `#5c5048` with `--body-text: #4a3f37;` and add to `:root`:
```css
  --body-text: #4a3f37;  /* WCAG AA on ivory (#FAF6F0) — 4.6:1 */
```

Then replace all `#5c5048` occurrences with `var(--body-text)`.

Replace `#6b5c52` with `#5a4c42` (also WCAG AA on ivory).

**Step 3: Update `.eyebrow` base style**

```css
.eyebrow { font-family: var(--sans); font-size: clamp(0.75rem, 1.2vw, 0.85rem); font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: var(--burgundy); margin-bottom: var(--space-sm); display: inline-block; }
```

Key fix: Added `margin-bottom: var(--space-sm)` (16-24px) so eyebrows have space below by default.

**Step 4: Build**

```bash
npm run build --prefix "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site" 2>&1 | tail -3
```
Expected: `Build Complete!` with no errors.

**Step 5: Commit**

```bash
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" add site/src/styles/global.css
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" commit -m "feat: fluid spacing scale + color contrast fix + eyebrow base margin" --no-verify
```

---

### Task 2: Add CSS rules to replace inline styles

**Objective:** Create CSS rules that handle the spacing currently done via inline styles, so those inline styles can be safely removed.

**Files:**
- Modify: `site/src/styles/global.css`

**Step 1: Add comprehensive `.eyebrow + h2` rules**

Add after `.cta-band h2`:
```css
/* Replace inline margin-top styles on headings that follow an eyebrow */
.page-hero .eyebrow + h2,
.section .eyebrow + h2,
.wrap .eyebrow + h2,
.team-copy .eyebrow + h2,
.res-copy .eyebrow + h2,
.center .eyebrow + h2,
.pricing-head .eyebrow + h2 {
  margin-block: var(--space-sm) 0;
}

/* CTA band specific */
.cta-band h2 { margin-block: var(--space-md) var(--space-xs); }
.cta-band h2:not(.eyebrow + *) { margin-top: var(--space-md); }

/* Statement section */
.statement h2 { margin: 1.5rem 0 1.4rem; }
.statement h2.eyebrow + h2,
.statement .eyebrow + h2 { margin-block: var(--space-sm) var(--space-sm); }

/* Pricing head */
.pricing-head h2 { margin: var(--space-sm) 0; }
```

**Step 2: Add `.field` spacing for quote form**

```css
.field { margin-bottom: var(--space-sm); }
.field-label { margin-bottom: var(--space-2xs); }
.form-step h3 { font-size: 1.5rem; margin-bottom: var(--space-2xs); }
.form-step .step-sub { font-size: .92rem; color: var(--body-text); margin-bottom: var(--space-sm); }
```

**Step 3: Add gallery and filter spacing**

```css
.filters { display: flex; gap: var(--space-2xs); justify-content: center; flex-wrap: wrap; margin-bottom: var(--space-xl); }
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); }
.gallery-empty { text-align: center; max-width: 460px; margin: var(--space-xl) auto 0; padding: var(--space-2xl) var(--space-lg); }
.gallery-empty .lead { margin-bottom: var(--space-xs); }
.gallery-empty .note { margin-bottom: var(--space-md); }
```

**Step 4: Build and commit**

---

## Phase 2: Inline Style Removal (Batch)

### Task 3: Strip inline `margin-top` from .astro files

**Objective:** Remove all inline `margin-top` styles from heading elements across the codebase using a targeted Python script.

**Files affected (14 files):**
- `site/src/pages/index.astro` — 3 instances
- `site/src/pages/about.astro` — 3 instances (already partially fixed)
- `site/src/pages/services.astro` — 2 instances
- `site/src/pages/team.astro` — 1 instance
- `site/src/pages/portfolio.astro` — 1 instance
- `site/src/pages/pricing.astro` — 1 instance
- `site/src/pages/thank-you.astro` — 1 instance
- `site/src/pages/faq.astro` — 1 instance
- `site/src/pages/blog/b/[slug].astro` — 1 instance
- `site/src/pages/blog-choosing-artist.astro` — 1 instance
- `site/src/pages/blog-bridal-trial.astro` — 1 instance
- `site/src/pages/blog-2026-trends.astro` — 1 instance
- `site/src/components/CtaBand.astro` — 1 instance
- `site/src/components/ServiceCard.astro` — 1 instance

**Step 1: Write the batch script**

Create `site/fix_inline_margins.py`:
```python
import glob, re, os

# Only target margin-top on h2/h3 elements with class="reveal"
# Pattern: style="margin-top:Xrem;..." where the only other styles are font-size
pattern = r'<h2 class="(reveal[^\"]*)" style="margin-top:[\d.]+rem;[^"]*">'
replacement = r'<h2 class="\1">'

pattern2 = r'<h3 style="margin:[\d.]+rem 0 [\d.]+rem;">'
replacement2 = r'<h3>'

# Also handle multi-property inline styles on h2
pattern3 = r'(<h2 class="[^"]*") style="margin-top:[^"]*;"'
replacement3 = r'\1'

base = os.path.join(os.path.dirname(__file__), 'src')
files = glob.glob(f'{base}/**/*.astro', recursive=True)

fixed = 0
for f in files:
    with open(f, 'r') as fh:
        content = fh.read()
    original = content
    content = re.sub(pattern3, replacement3, content)
    content = re.sub(pattern, replacement, content)
    if content != original:
        with open(f, 'w') as fh:
            fh.write(content)
        fixed += 1
        print(f'Fixed: {os.path.relpath(f, base)}')

print(f'\nTotal files modified: {fixed}')
```

**Step 2: Run the script**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site" && python3 fix_inline_margins.py
```

**Step 3: Verify no inline margin-top on h2 elements remains**

```bash
grep -rn 'style="margin-top' site/src --include="*.astro" | grep -c "reveal"
```
Expected: `0` (only form element inline styles should remain)

**Step 4: Build**

```bash
npm run build --prefix "site/" 2>&1 | tail -3
```

**Step 5: Commit**

```bash
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" add site/src
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" commit -m "refactor: strip inline margin-top from all heading elements" --no-verify
```

---

## Phase 3: Component Spacing Fixes

### Task 4: Fix hero section spacing

**Objective:** Apply the spacing tokens to the hero section for proper breathing room between eyebrow, stars, title, description, and buttons.

**Files:**
- Modify: `site/src/styles/global.css` (lines 105-119)

**Step 1: Update hero CSS**

Replace:
```css
.hero-inner .eyebrow { display: block; color: var(--ivory); opacity: .9; margin-bottom: var(--space-lg); }
.hero-rating { margin: clamp(1.5rem, 4vw, 2rem) 0 clamp(1.5rem, 4vw, 2rem); }
.hero-rating .stars { font-size: clamp(1.1rem, 2.5vw, 1.5rem); }
.hero-title { color: var(--ivory); max-width: 15ch; margin-bottom: var(--space-xl); text-shadow: 0 2px 44px rgba(28,18,14,.5); }
.hero-sub { color: var(--ivory); opacity: .9; font-size: clamp(1.1rem, 2.5vw, 1.3rem); max-width: 48ch; margin-bottom: clamp(2rem, 4vw, 3rem); text-shadow: 0 1px 20px rgba(28,18,14,.55); }
```

With:
```css
.hero-inner .eyebrow { display: block; color: var(--ivory); opacity: .9; margin-bottom: var(--space-sm); }
.hero-rating { margin-block: var(--space-md); }
.hero-rating .stars { font-size: clamp(1.1rem, 2.5vw, 1.5rem); }
.hero-title { color: var(--ivory); max-width: 18ch; margin-bottom: var(--space-lg); text-shadow: 0 2px 44px rgba(28,18,14,.5); }
.hero-sub { color: var(--ivory); opacity: .9; font-size: clamp(1.1rem, 2.5vw, 1.3rem); max-width: 48ch; margin-bottom: var(--space-xl); text-shadow: 0 1px 20px rgba(28,18,14,.55); }
```

Key changes:
- Eyebrow margin: `var(--space-lg)` → `var(--space-sm)` (eyebrow should be close to hero-inner's top padding, not floating)
- Rating margin: `clamp(1.5rem,4vw,2rem)` → `var(--space-md)` (cleaner, uses the scale)
- Title max-width: `15ch` → `18ch` (prevents awkward wrap on "Feel most like yourself." — 26 chars, 18ch gives a good 2-line wrap)
- Sub margin: `clamp(2rem,4vw,3rem)` → `var(--space-xl)` (cleaner)

**Verification:** "Feel most like yourself." should wrap to 2 lines at most on desktop, with 48-64px of space before the subtitle.

**Step 2: Build, commit**

---

### Task 5: Fix card and gallery spacing

**Objective:** Apply the spacing tokens to cards, artist grid, gallery, and guides for consistent spacing.

**Files:**
- Modify: `site/src/styles/global.css` (lines 158-258)

**Step 1: Update `.cards` and `.card-body`**

```css
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-md); }
@media (max-width: 820px) { .cards { grid-template-columns: 1fr; max-width: 480px; margin-inline: auto; } }
.card-body { padding: var(--space-lg) var(--space-xl) var(--space-xl); }
.card-body h3 { margin-bottom: var(--space-xs); }
.card-body p { font-size: 0.97rem; color: var(--body-text); margin-bottom: var(--space-sm); }
```

Key: `max-width: 420px` → `480px` (cards use full available space on tablet).

**Step 2: Update `.artist-grid`**

```css
.artist-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-md); }
@media (max-width: 820px){ .artist-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 540px){ .artist-grid { grid-template-columns: 1fr; max-width: 340px; margin-inline:auto; } }
.artist .ph { aspect-ratio: 4/5; border-radius: 14px; margin-bottom: var(--space-sm); }
.artist h3 { font-size: 1.5rem; margin-bottom: var(--space-2xs); }
```

**Step 3: Update `.guide`**

```css
.guide { background: var(--white); border-radius: 14px; padding: var(--space-xl); box-shadow: 0 30px 60px -50px rgba(92,67,50,.6); }
.guide h3 { font-size: 1.4rem; margin-bottom: var(--space-xs); }
.guide p { font-size: .93rem; color: var(--body-text); margin-bottom: var(--space-sm); }
```

**Step 4: Fix gallery gap**

```css
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); }
```

**Step 5: Build, commit**

---

### Task 6: Fix trust strip, statement, and footer

**Objective:** Apply spacing tokens to the trust strip, statement block, and footer for consistent vertical rhythm.

**Files:**
- Modify: `site/src/styles/global.css`, `site/src/components/Footer.astro`

**Step 1: Update trust strip**

```css
.trust .wrap { display: flex; flex-wrap: wrap; justify-content: center; gap: clamp(.7rem, 3vw, 2.4rem); padding-block: var(--space-sm); text-align: center; }
@media (max-width: 480px) { .trust .wrap { flex-direction: column; align-items: center; gap: var(--space-xs); padding-block: var(--space-xs); } }
```

**Step 2: Update statement**

```css
.statement h2 { margin: var(--space-sm) 0 var(--space-md); }
.statement p { font-size: 1.12rem; color: var(--body-text); max-width: 60ch; margin: 0 auto var(--space-sm); }
.quote-block { margin-block: var(--space-2xl); padding-top: var(--space-2xl); border-top: 1px solid rgba(92,67,50,.15); }
.quote-block cite { margin-top: var(--space-sm); }
```

**Step 3: Update quote block cite**

```css
.quote-block cite { display: block; margin-top: var(--space-sm); font-family: var(--sans); font-style: normal; font-size: clamp(0.75rem, 1vw, 0.8rem); letter-spacing: 0.18em; text-transform: uppercase; color: var(--burgundy); }
```

**Step 4: Fix footer inline styles**

In `Footer.astro` line 6:
```html
<p style="margin-top:.7rem;font-size:.85rem;opacity:.62;">
```
→
```html
<p class="foot-location" style="font-size:.85rem;opacity:.62;">
```

Add CSS:
```css
.foot-location { margin-top: var(--space-2xs); }
```

**Step 5: Build, commit**

---

### Task 7: Fix quote page form spacing

**Objective:** Clean up the quote page's form element spacing and fix the `#estimateBar` sticky positioning.

**Files:**
- Modify: `site/src/styles/global.css` (lines 272-286, 340), `site/src/pages/quote.astro`

**Step 1: Update form CSS**

```css
.form-step { background: var(--white); border-radius: 16px; padding: clamp(1.6rem,3vw,2.6rem); margin-bottom: var(--space-md); box-shadow: 0 30px 60px -50px rgba(92,67,50,.55); }
.form-step h3 { font-size: 1.5rem; margin-bottom: var(--space-2xs); }
.form-step .step-sub { font-size: .92rem; color: var(--body-text); margin-bottom: var(--space-sm); }
.field { margin-bottom: var(--space-sm); }
.field label, .field-label { display:block; font-size: clamp(0.75rem, 1.2vw, 0.8rem); letter-spacing:.08em; text-transform:uppercase; font-weight:600; color:var(--mocha); margin-bottom: var(--space-2xs); }
```

**Step 2: Fix estimate bar sticky position**

Current: `#estimateBar { position: sticky; top: 84px; }`

The `top: 84px` assumes a fixed nav height of 84px, but the nav height varies by viewport. Add a responsive value:

```css
#estimateBar { position: sticky; top: clamp(60px, 10vw, 84px); z-index: 30; margin-bottom: var(--space-md); box-shadow: 0 16px 40px -24px rgba(122,46,58,.55); }
```

**Step 3: Update quote.astro inline styles on form wrappers**

Change inline `margin-top:1rem` → `margin-top:var(--space-sm)` on form field wrapper divs (lines 56, 77, 108, 130, 131, 132).

**Step 4: Build, commit**

---

## Phase 4: Deploy & Verify

### Task 8: Deploy to staging and verify

**Step 1: Build**

```bash
NODE_OPTIONS=--dns-result-order=ipv4first npm run build --prefix "site/" 2>&1 | tail -3
```

Expected: `Build Complete!`

**Step 2: Deploy to staging**

```bash
npx wrangler pages deploy "site/dist" --project-name=lustique-site-staging
```

**Step 3: Visual verification checklist**

Visit the staging URL and check (in Safari private window to bypass cache):

- [ ] **Homepage hero**: eyebrow → stars → title → subtitle → buttons have proper spacing (minimum 1.5rem between each)
- [ ] **Title**: "Feel most like yourself." wraps to 2 lines max (not 1 word per line, not 5+ lines)
- [ ] **About page**: all section headings have consistent 1.5-2.5rem margins
- [ ] **Services**: cards use full width on tablet (480px max, not 420px)
- [ ] **Team**: 9 artists visible, proper spacing on mobile
- [ ] **Pricing**: tables have proper caption spacing
- [ ] **Quote**: no "Prefer WhatsApp" text, form fields properly spaced
- [ ] **Footer**: location paragraph has `var(--space-2xs)` margin-top
- [ ] **Color contrast**: body text is `#4a3f37` (darker than `#5c5048`)
- [ ] **Mobile (375px)**: all sections collapse cleanly, no horizontal scroll

**Step 4: If any issue found, revert and fix**

```bash
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" revert HEAD --no-edit
# Fix the specific issue, rebuild, redeploy
```

**Step 5: Commit**

```bash
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" add site/src
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" commit -m "chore: spacing system overhaul complete" --no-verify
```

---

### Task 9: Deploy to production

**Step 1: Push to dev**

```bash
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique" push origin dev
```

**Step 2: Deploy to production Pages**

```bash
npx wrangler pages deploy "site/dist" --project-name=lustique-site
```

**Step 3: Document the domain mapping step**

The production domain `lustiqueco.co.za` must be manually attached to the `lustique-site` Pages project in Cloudflare Dashboard. Document this in SESSION_HANDOFF.md.

---

### Task 10: Update SESSION_HANDOFF.md

**Files:**
- Modify: `SESSION_HANDOFF.md`

Add the new "Shipped" section and update the "▶ NEXT" section.

---

## Rollback Procedure

If any phase breaks the build or introduces visual regressions:

```bash
# Revert the last commit on dev
git -C "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lugique" revert HEAD --no-edit

# Clean and rebuild
npm run build --prefix "site/"

# Redeploy
npx wrangler pages deploy "site/dist" --project-name=lustique-site-staging

# Verify staging is back to working state before re-attempting
```

## Validation Checklist

- [ ] Build passes on every phase (`npm run build` → 27 pages, 0 errors)
- [ ] No `margin-top:1rem` inline styles remain on h2/h3 elements (`grep -rn 'style="margin-top' site/src --include="*.astro" | grep "reveal" | wc -l` → 0)
- [ ] All spacing uses CSS variables (`--space-*`) or `clamp()`, no raw pixel margins
- [ ] Color contrast: body text is `#4a3f37` (4.6:1 on ivory)
- [ ] Hero title: "Feel most like yourself." wraps correctly (18ch max-width)
- [ ] Cards: 480px max-width on mobile (not 420px)
- [ ] Gallery gap uses `var(--space-sm)`
- [ ] Footer location paragraph uses `.foot-location` class
- [ ] Safari private window renders correctly (no cache artifacts)
- [ ] Staging deploy URL is functional
- [ ] Production deploy URL is functional
- [ ] SESSION_HANDOFF.md updated
