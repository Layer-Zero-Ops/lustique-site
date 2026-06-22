# Sanity CMS Integration — Wave D1 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (- [ ]) syntax.

**Goal:** Wire Sanity v3 as the CMS for portfolio images, team bios, blog posts, service descriptions, and homepage testimonials, replacing all hard-coded content in Astro `.astro` files, so Zandeline can publish content changes without a developer.

> ## ⚠️ Build corrections (adversarial review — apply these; they OVERRIDE any conflicting inline text below)
> 1. **`astro-portabletext` version** — there is NO v2 (latest is 0.x). Use `"astro-portabletext": "^0.13.0"` in `site/package.json` AND in the Task 0c install command. The PortableText/link-mark component pattern in the plan is correct for 0.13 — confirm `PortableTextMarkComponentProps` / `{ node }` against the 0.13 source while building.
> 2. **`@sanity/image-url` pin + import path** — pin the Task 0c install to `@sanity/image-url@^1.0.0` (matching `package.json`) so npm cannot pull v2. v2 removed the `@sanity/image-url/lib/types/types` subpath that all 8 imports use; stay on v1 (or inline a `SanityImageObject` interface).
> 3. **Task 7 ordering = no data-loss window** — run `npx astro build` and verify `dist/blog/` contains the 3 expected HTML files BEFORE any `rm` of the old `blog-*.astro`. Delete only after the build passes. (The current order deletes first, then checks — unrecoverable without git if Sanity isn't seeded yet.)
> 4. **Add `site/src/queries/team.test.ts`** — it is the only new source file missing its co-located test (TDD constraint). Assert `TEAM_QUERY` contains `"teamMember"`, `slug.current`, `displayOrder`, and the `SanityTeamMember` shape; add it to the Task 3 test run command.
> 5. **`blog.astro` index eyebrow** — render each post's `category` field (Style / Trials / Pretoria / Guide), not a hard-coded "Guide".
> 6. **sitemap `lastmod`** — use each blog document's `_updatedAt` for its sitemap entry rather than the hard-coded `2026-06-21`.

**Architecture:** A standalone Sanity Studio lives at `lustique.sanity.studio` (hosted, not embedded in Astro). The Astro site fetches all content at **build time** via raw `@sanity/client` calls inside Astro frontmatter and `getStaticPaths`, remaining 100% static on CF Pages free tier. A Sanity webhook fires on every document publish and POSTs to a CF Pages deploy hook, triggering an Astro rebuild that picks up the new content.

**Tech Stack:**
- Sanity v3 (Studio in `studio/` directory, deployed to `sanity deploy`)
- `@sanity/client` v6 (raw SDK — no `@sanity/astro` integration)
- `@sanity/image-url` v1 (Sanity CDN image URL builder)
- `astro-portabletext` v2 (Portable Text renderer for Astro, no React)
- Astro v4.16 (static build, CF Pages free, `build.format: "file"`)
- Vitest (co-located test files, same runner as `worker/`)

---

## Status

☐ Not started · **Build SECOND in Wave D** (after D3 rate limiting, before D4 artist allocation, before D2 calendar).

---

## Global Constraints

These rules apply to every task below. **Do not deviate.**

1. **Test runner:** Vitest (`vitest run`). Test files co-located with source (`*.test.ts` next to the file under test). For `site/` there is no existing test setup — Task 1 installs Vitest and the first test proves the setup works.
2. **Security headers:** all Worker responses go through `withSec()` / `secHeaderMap()`. No Sanity-related Worker routes are added in D1 (the Cloudflare Worker is unchanged). This constraint is stated for completeness.
3. **Money rule:** `shared/pricing` and `@lustique/pricing` are **not touched**. `services.astro` may pull descriptive copy from Sanity but must never source price figures from Sanity — prices come only from `shared/pricing` TypeScript or from the existing hard-coded price strings (which are already mirrored in `shared/pricing`). The existing price strings in `services.astro` remain as-is in D1; they become CMS-editable only if a future plan explicitly unlocks that.
4. **Migration numbering:** D1 has **no Supabase migrations** — Sanity Content Lake is the data store. No files are added to `supabase/migrations/`. The highest existing migration is `0012_review_email.sql`; D4 will be `0013`.
5. **Naming and voice:** Sanity document type names use `camelCase` (`portfolioImage`, `teamMember`, `blogPost`, `service`, `testimonial`, `siteSettings`). All copy and comments follow the quiet-luxury Lustique brand voice — warm, assured, never salesy.
6. **File path discipline:** new site files under `site/src/lib/` (Sanity client wrapper), `site/src/queries/` (GROQ query constants), `site/src/pages/blog/` (dynamic blog route). Studio files under `studio/` at the repo root. No files under `worker/` are changed.
7. **`build.format: "file"`** stays as-is in `astro.config.mjs`. All generated pages emit as `.html` files (`blog/choosing-artist.html`, not `blog/choosing-artist/index.html`). Internal links in blog body that reference other pages use relative `.html` hrefs and must be preserved.
8. **`npm install` only in Pieter's terminal** (sandbox blocks network installs). Every task that adds a new package states the exact install command for Pieter to run before the Sonnet build step.
9. **CSP `img-src` must include `https://cdn.sanity.io`** — all Sanity CDN images are blocked in production without it. Task 1 updates `site/public/_headers`. See Global Constraint 9 detail in Task 1.

---

## Architecture Decisions

Every "Opus must answer" question is resolved here. Sonnet builds to these; do not re-litigate.

### A1 — Astro integration pattern: raw `@sanity/client`, not `@sanity/astro`

`@sanity/astro` requires SSR or visual-editing islands. This site is 100% static on CF Pages free. Use raw `@sanity/client` in a typed wrapper at `site/src/lib/sanity.ts`. Every Astro page that needs Sanity data imports from this wrapper and calls it inside the `---` frontmatter block. `getStaticPaths` for the blog route does the same.

**Pattern (all pages follow this):**
```ts
// site/src/lib/sanity.ts
import { createClient } from "@sanity/client";
export const sanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? "production",
  apiVersion: import.meta.env.SANITY_API_VERSION ?? "2026-06-21",
  useCdn: true,
  perspective: "published",
});
```

`import.meta.env.*` is Astro's env reading pattern; Vite injects it at build time from `.env`.

### A2 — Studio location: standalone hosted at `lustique.sanity.studio`

A `studio/` directory at the repo root contains `sanity.config.ts` + schema files. `npx sanity deploy` (run from `studio/`) publishes the Studio to `lustique.sanity.studio`. The Astro site has no `/studio` route. Zandeline bookmarks `lustique.sanity.studio` and logs in with her Sanity account.

### A3 — Dataset visibility: PUBLIC, no read token

All Lustique content is public. `sanity.config.ts` sets `token: undefined`. The build needs no read token. CF Pages build env vars are `SANITY_PROJECT_ID`, `SANITY_DATASET=production`, `SANITY_API_VERSION=2026-06-21`. No secret is required for read access.

### A4 — Image handling: Sanity CDN via `@sanity/image-url`

Images live in the Sanity asset store (CDN at `cdn.sanity.io`). `@sanity/image-url` generates responsive URLs. The existing `Photo.astro` component is **updated in Task 4** to accept either a legacy `src` string (for the existing site images that remain as `/assets/` files) or a `sanityImage` asset object (for Sanity-sourced images). This is backward-compatible — no existing page breaks.

**URL builder pattern:**
```ts
import imageUrlBuilder from "@sanity/image-url";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";
import { sanityClient } from "./sanity";
const builder = imageUrlBuilder(sanityClient);
export function urlFor(source: SanityImageSource) {
  return builder.image(source);
}
// Usage: urlFor(artist.photo).width(400).height(400).fit("crop").auto("format").url()
```

CF Images is **not** used in D1. It remains an optional Pass 2 upgrade (better ZA-region latency; requires CF Images binding + image proxy Worker route).

**CRITICAL — CSP `img-src`:** Because images are served from `cdn.sanity.io`, the Content-Security-Policy in `site/public/_headers` must include `https://cdn.sanity.io` in `img-src`. Without it every Sanity CDN image returns a CSP violation and is invisible in production. Task 1 applies this change.

### A5 — Rebuild on publish: Sanity webhook → CF Pages deploy hook

Sanity project settings → API → Webhooks → add webhook:
- URL: `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<hook-token>` (Pieter generates this in CF Pages dashboard)
- HTTP Method: POST
- Trigger: all document publishes (`create`, `update`, `delete` on all types)
- No secret needed (the hook URL itself is the credential; treat it as a secret — do not commit it)

### A6 — Blog migration: 3 hard-coded `.astro` pages → Sanity `blogPost` documents + dynamic route

**Step 1 (Pieter, one-time):** Create 3 `blogPost` documents in Sanity Studio by copy-pasting the existing article content. Slugs: `choosing-artist`, `bridal-trial`, `2026-trends`.

**Step 2 (Sonnet, Task 6):** Create `site/src/pages/blog/[slug].astro` with `getStaticPaths` fetching all `blogPost` slugs from Sanity. Update `blog.astro` index to list posts from Sanity.

**Step 3 (Sonnet, Task 6 — after seeding):** Delete the 3 old `.astro` files (`blog-2026-trends.astro`, `blog-bridal-trial.astro`, `blog-choosing-artist.astro`). **Deletion happens only after** (a) redirect rules are committed, (b) 3 Sanity `blogPost` documents exist with correct slugs.

**URL continuity:** Old URLs were top-level `blog-choosing-artist.html`. New URL is `blog/choosing-artist.html`. Pieter adds redirect rules to `site/public/_redirects` (CF Pages syntax):
```
/blog-choosing-artist.html  /blog/choosing-artist.html  301
/blog-bridal-trial.html     /blog/bridal-trial.html     301
/blog-2026-trends.html      /blog/2026-trends.html      301
```

**Step 4 (Sonnet, Task 8):** Update `sitemap.xml.ts` to emit canonical `/blog/<slug>` URLs (replacing the 3 old `blog-*.html` entries) and keep the existing redirect rules.

### A7 — Portable Text rendering: `astro-portabletext`, custom link component

`astro-portabletext` v2 renders Sanity Portable Text in `.astro` files without React. The `link` mark annotation **must** be handled by a real Astro component that reads `value.href` and `value.blank` — **not** the `marks: { link: "a" }` string shorthand, which drops `href`. The `blogPost` schema defines only a `link` annotation (no `internalLink`); the component handles both internal (relative `.html` hrefs) and external links via the `blank` boolean field.

**PortableText link component pattern:**
```astro
---
// site/src/components/PortableTextLink.astro
import type { PortableTextMarkComponentProps } from "astro-portabletext/types";
type LinkValue = { href: string; blank?: boolean };
type Props = PortableTextMarkComponentProps<LinkValue>;
const { node } = Astro.props;
const href = node.value?.href ?? "#";
const isBlank = node.value?.blank === true;
---
{isBlank
  ? <a href={href} target="_blank" rel="noopener noreferrer"><slot /></a>
  : <a href={href}><slot /></a>
}
```

### A8 — Zandeline's day-1 publishing flow (end-to-end)

1. Zandeline visits `lustique.sanity.studio` and logs in with her Sanity account (Pieter adds her as editor during one-time setup, Task 0).
2. To add a portfolio image: Studio → Portfolio Images → New → upload JPG, fill title + artist + category → Publish. Sanity fires webhook → CF Pages rebuild (~2 min) → new image live on `/portfolio.html`.
3. To write a blog post: Studio → Blog Posts → New → fill title, slug (auto-generated), excerpt, category, body (rich-text editor) → Publish. CF Pages rebuilds → new post live at `/blog/<slug>.html`.
4. To update a team bio: Studio → Team Members → select artist → edit bio field + upload photo → Publish → CF Pages rebuilds → `/team.html` shows updated bio + photo.
5. Zandeline never needs to open a terminal, run a build command, or contact LZ for routine content changes.

### A9 — Slug uniqueness and accent handling

Artist IDs in `site/src/data/team.ts` use no-accent slugs (`marone` for `Maroné`). Sanity `teamMember` documents include a `slug` field that is auto-generated from the `name` field with accents stripped. `blogPost` slug uniqueness is enforced via `validation: (rule) => rule.required().unique()`.

### A10 — `site/src/data/team.ts` backward compatibility

`team.ts` remains in place for the duration of D1 and is **not deleted**. The portfolio and team pages are updated to fetch from Sanity **instead of** `team.ts`, but `team.ts` stays as a fallback reference. After D1 is verified live, Pieter can delete `team.ts` in a follow-up cleanup commit.

### A11 — `SanityHomeSettings` query-shaped type (index.astro)

The GROQ projection for the homepage returns a **nested object** with a `settings` key and a `testimonials` key. The TypeScript type mirrors this shape exactly:

```ts
type SanityHomeSettingsQuery = {
  settings: { heroHeadline?: string; heroSubheadline?: string } | null;
  testimonials: SanityTestimonial[];
};
```

`index.astro` fetches with this type, then accesses `homeData?.settings?.heroHeadline` (not `homeData?.heroHeadline`). `astro check` must pass with this shape.

---

## File Structure

Every file created or modified, with its single responsibility.

### New files (Sanity Studio)
| Path | Responsibility |
|------|----------------|
| `studio/package.json` | Studio npm workspace, Sanity v3 deps |
| `studio/sanity.config.ts` | Studio config: projectId, dataset, name, icon, schema types |
| `studio/schemas/index.ts` | Re-exports all schema types |
| `studio/schemas/portfolioImage.ts` | Schema for gallery image documents |
| `studio/schemas/teamMember.ts` | Schema for artist/team-member documents |
| `studio/schemas/blogPost.ts` | Schema for blog article documents |
| `studio/schemas/service.ts` | Schema for service offering documents |
| `studio/schemas/testimonial.ts` | Schema for testimonial quote documents |
| `studio/schemas/siteSettings.ts` | Singleton schema for hero headline + testimonials selection |
| `studio/tsconfig.json` | TypeScript config for Studio workspace |
| `studio/.gitignore` | Ignore `node_modules`, `.sanity`, `dist` |
| `studio/.env.example` | Documents `SANITY_STUDIO_PROJECT_ID` env var for Studio dev |

### New files (site/)
| Path | Responsibility |
|------|----------------|
| `site/vitest.config.ts` | Vitest config for `site/` workspace |
| `site/src/lib/sanity.ts` | Typed Sanity client singleton + `urlFor` image builder |
| `site/src/lib/sanity.test.ts` | Vitest: proves client instantiates and returns correct config |
| `site/src/lib/imageUrl.ts` | Pure `resolvePhotoSrc` function (unit-testable URL logic) |
| `site/src/lib/imageUrl.test.ts` | Tests for `resolvePhotoSrc` |
| `site/src/queries/portfolio.ts` | GROQ query + TypeScript return type for portfolio images |
| `site/src/queries/portfolio.test.ts` | Tests for portfolio query shape |
| `site/src/queries/team.ts` | GROQ query + TypeScript return type for team members |
| `site/src/queries/blog.ts` | GROQ queries + types for blog index + single post |
| `site/src/queries/blog.test.ts` | Tests for blog query shapes |
| `site/src/queries/services.ts` | GROQ query + TypeScript return type for services |
| `site/src/queries/services.test.ts` | Tests for services query shape |
| `site/src/queries/home.ts` | GROQ query + nested query-shaped type for homepage data |
| `site/src/queries/home.test.ts` | Tests for home query shape including nested `.settings` |
| `site/src/pages/blog/[slug].astro` | Dynamic blog post page; `getStaticPaths` from Sanity |
| `site/src/components/PortableText.astro` | `astro-portabletext` wrapper wiring real link component |
| `site/src/components/PortableTextLink.astro` | Real link mark component reading `value.href` + `value.blank` |
| `site/public/_redirects` | 301 redirects from old `blog-*.html` URLs to new `blog/*.html` |

### Modified files (site/)
| Path | What changes |
|------|-------------|
| `site/package.json` | Add `@sanity/client`, `@sanity/image-url`, `astro-portabletext`, `vitest`, `@vitest/coverage-v8`; add `"test": "vitest run"` script |
| `site/.env.example` | Add `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_VERSION` |
| `site/public/_headers` | Add `https://cdn.sanity.io` to `img-src` in CSP |
| `site/src/pages/portfolio.astro` | Replace `ARTISTS`/`GALLERY` imports with Sanity fetch; `urlFor` imported in frontmatter and used in `.map()` |
| `site/src/pages/team.astro` | Replace `ARTISTS` import with Sanity fetch; use `Photo` component when photo present |
| `site/src/pages/blog.astro` | Replace hard-coded article cards with Sanity blog index query |
| `site/src/pages/services.astro` | Replace hard-coded service card descriptions with Sanity fetch; keep price strings unchanged |
| `site/src/pages/index.astro` | Replace hard-coded testimonials with Sanity query; use nested `homeData.settings.heroHeadline` |
| `site/src/components/Photo.astro` | Add optional `sanityImage` prop; `urlFor()` when provided, existing `src` path when not |
| `site/src/pages/sitemap.xml.ts` | Replace `blog-*.html` entries with dynamic `blog/<slug>.html` entries from Sanity; keep 301 redirect entries in `_redirects` |

### Deleted files (site/) — Task 7 only, after redirects + Sanity docs exist
| Path |
|------|
| `site/src/pages/blog-2026-trends.astro` |
| `site/src/pages/blog-bridal-trial.astro` |
| `site/src/pages/blog-choosing-artist.astro` |

---

## Task 0 — One-time setup (Pieter runs; Sonnet does not)

> This task is entirely manual. Sonnet cannot create a Sanity project or add npm packages. Complete this before running any build task.

**0a. Create the Sanity project (if not already done)**
- Visit `sanity.io/manage`, log in as LZ admin account, create new project: name `Lustique Co.`, plan Free.
- Note the **Project ID** (format: 8 alphanumeric chars, e.g. `abc12345`).
- Dataset: `production` (default).
- Add Zandeline's Gmail as an Editor in project settings → Members.

**0b. Record env vars**
- Create `site/.env` (not committed):
  ```
  SANITY_PROJECT_ID=<your-project-id>
  SANITY_DATASET=production
  SANITY_API_VERSION=2026-06-21
  ```

**0c. Install npm packages (run in Pieter's terminal, not Sonnet's)**
```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npm install @sanity/client @sanity/image-url astro-portabletext
npm install --save-dev vitest @vitest/coverage-v8

mkdir -p "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/studio"
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/studio"
npm init -y
npm install sanity @sanity/vision react react-dom
npm install --save-dev typescript
```

**0d. CF Pages build env vars**
In the CF Pages dashboard → Lustique project → Settings → Environment variables → Production:
- `SANITY_PROJECT_ID` = `<your-project-id>`
- `SANITY_DATASET` = `production`
- `SANITY_API_VERSION` = `2026-06-21`

**0e. CF Pages deploy hook**
CF Pages → Lustique project → Settings → Builds & deployments → Deploy hooks → Add: name `sanity-publish`, branch `main`. Copy the URL. Keep this URL private — do not commit it.

**0f. Sanity webhook**
Sanity project → API → Webhooks → Add webhook:
- Name: `CF Pages rebuild`
- URL: (paste the deploy hook URL from 0e)
- HTTP method: POST
- Trigger on: `create`, `update`, `delete` — all document types
- Save

---

### Task 1 — Vitest config + Sanity client wrapper + CSP fix

> Build FIRST. Establishes the test harness, the typed Sanity client, and the CSP fix that all other tasks depend on.

**Files:**
- Create `site/vitest.config.ts`
- Create `site/src/lib/sanity.ts`
- Create `site/src/lib/sanity.test.ts`
- Create `site/.env.example`
- Modify `site/package.json` (add `test` script)
- Modify `site/public/_headers` (add `https://cdn.sanity.io` to `img-src`)

**Interfaces:**

Produces:
```ts
// site/src/lib/sanity.ts
export const sanityClient: SanityClient;
export function urlFor(source: SanityImageSource): ImageUrlBuilder;
```

---

- [ ] **Step 1 — Write the failing test**

```ts
// site/src/lib/sanity.test.ts
import { describe, it, expect, vi } from "vitest";

// Stub import.meta.env before importing the module under test.
// Vitest runs in Node where import.meta.env is undefined; we stub it here.
vi.stubEnv("SANITY_PROJECT_ID", "testprojid");
vi.stubEnv("SANITY_DATASET", "production");
vi.stubEnv("SANITY_API_VERSION", "2026-06-21");

describe("sanity client wrapper", () => {
  it("creates a client with the injected project ID", async () => {
    const { sanityClient } = await import("./sanity");
    const config = sanityClient.config();
    expect(config.projectId).toBe("testprojid");
    expect(config.dataset).toBe("production");
    expect(config.apiVersion).toBe("2026-06-21");
    expect(config.useCdn).toBe(true);
  });

  it("urlFor returns a builder with a url() method", async () => {
    const { urlFor } = await import("./sanity");
    const builder = urlFor({ _type: "image", asset: { _ref: "image-abc123-200x200-jpg", _type: "reference" } });
    expect(typeof builder.url).toBe("function");
    const url = builder.width(200).url();
    expect(url).toContain("cdn.sanity.io");
    expect(url).toContain("testprojid");
  });
});
```

- [ ] **Step 2 — Run the test (expect FAIL — module does not exist yet)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/lib/sanity.test.ts
```

Expected: `Error: Cannot find module './sanity'` or similar.

- [ ] **Step 3 — Implement all files**

```ts
// site/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

```
# site/.env.example
SANITY_PROJECT_ID=
SANITY_DATASET=production
SANITY_API_VERSION=2026-06-21
```

```ts
// site/src/lib/sanity.ts
import { createClient } from "@sanity/client";
import imageUrlBuilder from "@sanity/image-url";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";

/**
 * Read-only Sanity client for build-time content fetches.
 * All three env vars must be set in site/.env (local) and CF Pages build env vars (production).
 * Dataset is public — no token required.
 */
export const sanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID as string,
  dataset: (import.meta.env.SANITY_DATASET as string) ?? "production",
  apiVersion: (import.meta.env.SANITY_API_VERSION as string) ?? "2026-06-21",
  useCdn: true,
  perspective: "published",
});

const _builder = imageUrlBuilder(sanityClient);

/**
 * Returns an image URL builder for a Sanity image reference.
 * Example: urlFor(artist.photo).width(400).height(400).fit("crop").auto("format").url()
 */
export function urlFor(source: SanityImageSource) {
  return _builder.image(source);
}
```

Update `site/package.json` to add the `test` script:

```json
{
  "name": "site",
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run"
  },
  "dependencies": {
    "astro": "^4.16.0",
    "@lustique/pricing": "*",
    "@sanity/client": "^6.0.0",
    "@sanity/image-url": "^1.0.0",
    "astro-portabletext": "^2.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0"
  }
}
```

Update `site/public/_headers` — add `https://cdn.sanity.io` to `img-src`:

Before:
```
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://lustiqueco.co.za; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com; connect-src 'self' https://photon.komoot.io https://router.project-osrm.org; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests
```

After (only the `img-src` directive changes):
```
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://lustiqueco.co.za https://cdn.sanity.io; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com; connect-src 'self' https://photon.komoot.io https://router.project-osrm.org; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests
```

Full file content after edit:
```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://lustiqueco.co.za https://cdn.sanity.io; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com; connect-src 'self' https://photon.komoot.io https://router.project-osrm.org; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests
```

- [ ] **Step 4 — Run tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/lib/sanity.test.ts
```

Expected: `2 tests passed`.

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/vitest.config.ts site/src/lib/sanity.ts site/src/lib/sanity.test.ts site/.env.example site/package.json site/public/_headers
git commit -m "feat(cms): add Vitest config + typed Sanity client wrapper + CSP img-src cdn.sanity.io (D1 Task 1)"
```

---

### Task 2 — Sanity Studio scaffold + all schemas

> Build SECOND. Creates the `studio/` workspace with all 6 content-type schemas. Sonnet writes the schema files; Pieter runs `sanity deploy` once, from `studio/`, to publish the Studio to `lustique.sanity.studio`.

**Files:**
- Create `studio/sanity.config.ts`
- Create `studio/schemas/index.ts`
- Create `studio/schemas/portfolioImage.ts`
- Create `studio/schemas/teamMember.ts`
- Create `studio/schemas/blogPost.ts`
- Create `studio/schemas/service.ts`
- Create `studio/schemas/testimonial.ts`
- Create `studio/schemas/siteSettings.ts`
- Create `studio/package.json`
- Create `studio/tsconfig.json`
- Create `studio/.gitignore`
- Create `studio/.env.example`

**Interfaces:**

Schema types produced (used by Sanity Studio only; Astro consumes via GROQ):
```ts
portfolioImage  // _type: "portfolioImage"
teamMember      // _type: "teamMember"
blogPost        // _type: "blogPost"
service         // _type: "service"
testimonial     // _type: "testimonial"
siteSettings    // _type: "siteSettings", __experimental_actions: ["update", "publish"]
```

> Note: schema files live in `studio/` and are NOT imported by `site/`. Sanity Studio is a separate Node process. There are no Vitest tests for schema files (they are Sanity runtime config). The deliverable for this task is that `npx sanity dev` starts without errors and `npx sanity deploy` succeeds.

---

- [ ] **Step 1 — Create `studio/package.json`**

```json
{
  "name": "lustique-studio",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "sanity dev",
    "build": "sanity build",
    "deploy": "sanity deploy",
    "start": "sanity start"
  },
  "dependencies": {
    "sanity": "^3.0.0",
    "@sanity/vision": "^3.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2 — Create `studio/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2017", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "jsx": "preserve",
    "jsxImportSource": "react"
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3 — Create `studio/.gitignore`**

```
node_modules/
.sanity/
dist/
```

- [ ] **Step 4 — Create `studio/.env.example`**

```
# Required for local Studio development.
# Set this to your Sanity project ID (found at sanity.io/manage).
# Do NOT commit the actual .env file.
SANITY_STUDIO_PROJECT_ID=
```

- [ ] **Step 5 — Create all schema files**

```ts
// studio/schemas/portfolioImage.ts
import { defineType, defineField } from "sanity";

/**
 * A single gallery image in the Lustique portfolio.
 * `artistId` is a plain string slug — maps to Artist.id in site/src/data/team.ts.
 * When artist identity is fully moved to Sanity (future wave), this becomes a reference.
 */
export const portfolioImage = defineType({
  name: "portfolioImage",
  title: "Portfolio Image",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      description: "A short internal title for this image (not shown on site)",
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: "image",
      title: "Image",
      type: "image",
      options: { hotspot: true },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "alt",
      title: "Alt text",
      type: "string",
      description: "Describe the image for screen readers and search engines",
      validation: (rule) =>
        rule
          .required()
          .max(200)
          .warning("Good alt text is under 200 characters."),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "string",
      options: {
        list: [
          { title: "Makeup", value: "makeup" },
          { title: "Hair", value: "hair" },
          { title: "Bridal Party", value: "party" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "artistId",
      title: "Artist",
      type: "string",
      description: "Artist's ID slug (no accents) — must match the id field in site data.",
      options: {
        list: [
          { title: "Zandeline", value: "zandeline" },
          { title: "Monique", value: "monique" },
          { title: "Marize", value: "marize" },
          { title: "Jana", value: "jana" },
          { title: "Janeke", value: "janeke" },
          { title: "Elria", value: "elria" },
          { title: "Maroné", value: "marone" },
          { title: "René", value: "rene" },
          { title: "Samantha", value: "samantha" },
        ],
        layout: "dropdown",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first in the gallery. Leave blank for natural order.",
    }),
  ],
  preview: {
    select: { title: "title", media: "image", subtitle: "artistId" },
    prepare({ title, media, subtitle }: { title: string; media: unknown; subtitle: string }) {
      return { title: title ?? "Untitled image", media, subtitle: `Artist: ${subtitle ?? "—"}` };
    },
  },
});
```

```ts
// studio/schemas/teamMember.ts
import { defineType, defineField } from "sanity";

/**
 * An artist on the Lustique team.
 * `slug` is auto-generated from `name` with accents stripped — this becomes
 * the join key used in portfolioImage.artistId and site filter buttons.
 */
export const teamMember = defineType({
  name: "teamMember",
  title: "Team Member",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      description: "Display name with accents (e.g. Maroné, René)",
      validation: (rule) => rule.required().max(80),
    }),
    defineField({
      name: "slug",
      title: "ID slug",
      type: "slug",
      description:
        "Auto-generated from name with accents stripped. Do not change after publishing.",
      options: {
        source: "name",
        maxLength: 96,
        slugify: (input: string) =>
          input
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "role",
      title: "Role",
      type: "string",
      options: {
        list: [
          { title: "Founder", value: "Founder" },
          { title: "Bridal Artist", value: "Bridal Artist" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 4,
      description: "A short, warm paragraph about this artist. 2–4 sentences.",
      validation: (rule) => rule.required().max(600),
    }),
    defineField({
      name: "photo",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      description: "Portrait photo. Landscape images are cropped to square.",
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first. Zandeline should be 1.",
      validation: (rule) => rule.required().integer().min(1),
    }),
  ],
  preview: {
    select: { title: "name", media: "photo", subtitle: "role" },
    prepare({ title, media, subtitle }: { title: string; media: unknown; subtitle: string }) {
      return { title: title ?? "Unnamed artist", media, subtitle: subtitle ?? "" };
    },
  },
});
```

```ts
// studio/schemas/blogPost.ts
import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * A blog / journal article.
 * `slug` must be unique — enforced by validation below.
 * `body` is Portable Text. The only annotation mark type is `link` (with href + blank fields).
 * There is no `internalLink` type — do not add it.
 */
export const blogPost = defineType({
  name: "blogPost",
  title: "Blog Post",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required().max(160),
    }),
    defineField({
      name: "slug",
      title: "Slug (URL)",
      type: "slug",
      description:
        "Auto-generated from title. Used in the URL: /blog/<slug>.html. Do not change after publishing.",
      options: {
        source: "title",
        maxLength: 96,
        slugify: (input: string) =>
          input
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
      },
      validation: (rule) => rule.required().unique(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 3,
      description: "Short summary shown on the blog index card. 1–2 sentences.",
      validation: (rule) => rule.required().max(300),
    }),
    defineField({
      name: "category",
      title: "Category (eyebrow label)",
      type: "string",
      options: {
        list: [
          { title: "Style", value: "Style" },
          { title: "Trials", value: "Trials" },
          { title: "Pretoria", value: "Pretoria" },
          { title: "Guide", value: "Guide" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "publishedAt",
      title: "Published at",
      type: "datetime",
      description: "Leave blank to use the document creation date.",
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [
        defineArrayMember({
          type: "block",
          styles: [
            { title: "Normal", value: "normal" },
            { title: "Heading 2", value: "h2" },
            { title: "Heading 3", value: "h3" },
          ],
          marks: {
            decorators: [
              { title: "Strong", value: "strong" },
              { title: "Emphasis", value: "em" },
            ],
            annotations: [
              defineArrayMember({
                type: "object",
                name: "link",
                title: "Link",
                fields: [
                  defineField({
                    name: "href",
                    type: "string",
                    title: "URL",
                    description:
                      "For internal pages use relative paths with .html extension, e.g. portfolio.html",
                    validation: (rule) => rule.required(),
                  }),
                  defineField({
                    name: "blank",
                    type: "boolean",
                    title: "Open in new tab",
                    initialValue: false,
                  }),
                ],
              }),
            ],
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "excerpt" },
    prepare({ title, subtitle }: { title: string; subtitle: string }) {
      return { title: title ?? "Untitled post", subtitle: subtitle ?? "" };
    },
  },
  orderings: [
    {
      title: "Published date, newest first",
      name: "publishedDesc",
      by: [{ field: "publishedAt", direction: "desc" as const }],
    },
  ],
});
```

```ts
// studio/schemas/service.ts
import { defineType, defineField } from "sanity";

/**
 * A service offered by Lustique Co.
 * `priceDisplay` is a display string (e.g. "from R850") — NOT a number.
 * Pricing logic lives in shared/pricing TypeScript; this field is copy only.
 * Category determines which section of services.astro the card appears in.
 */
export const service = defineType({
  name: "service",
  title: "Service",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Service name",
      type: "string",
      validation: (rule) => rule.required().max(100),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "string",
      options: {
        list: [
          { title: "Bridal (The Wedding Day)", value: "bridal" },
          { title: "Beyond Bridal (Special Occasions)", value: "beyond-bridal" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 3,
      description: "Short description shown on the service card. 1–3 sentences.",
      validation: (rule) => rule.required().max(400),
    }),
    defineField({
      name: "priceDisplay",
      title: "Price display string",
      type: "string",
      description:
        'Display text only — e.g. "from R850" or "R750". Never sourced from the pricing calculator.',
      validation: (rule) => rule.required().max(40),
    }),
    defineField({
      name: "image",
      title: "Card image",
      type: "image",
      options: { hotspot: true },
      description: "Image shown on the service card (bridal services only).",
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first within each category.",
      validation: (rule) => rule.required().integer().min(1),
    }),
    defineField({
      name: "indicative",
      title: "Indicative pricing?",
      type: "boolean",
      description: 'Show * and "indicative — to be confirmed" note below this card.',
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "priceDisplay", media: "image" },
    prepare({ title, subtitle, media }: { title: string; subtitle: string; media: unknown }) {
      return { title: title ?? "Unnamed service", subtitle: subtitle ?? "", media };
    },
  },
});
```

```ts
// studio/schemas/testimonial.ts
import { defineType, defineField } from "sanity";

/**
 * A testimonial quote from a Lustique bride.
 * Attribution is optional — defaults to "A Lustique Bride" on the site.
 * Only testimonials with featured=true appear in the homepage slider.
 */
export const testimonial = defineType({
  name: "testimonial",
  title: "Testimonial",
  type: "document",
  fields: [
    defineField({
      name: "quote",
      title: "Quote",
      type: "text",
      rows: 4,
      description: "The bride's words, verbatim.",
      validation: (rule) => rule.required().max(600),
    }),
    defineField({
      name: "attribution",
      title: "Attribution",
      type: "string",
      description: 'How to credit this review. Leave blank to show "A Lustique Bride".',
      validation: (rule) => rule.max(80),
    }),
    defineField({
      name: "rating",
      title: "Rating",
      type: "number",
      options: {
        list: [
          { title: "★★★★★ (5)", value: 5 },
          { title: "★★★★ (4)", value: 4 },
          { title: "★★★ (3)", value: 3 },
        ],
        layout: "radio",
      },
      initialValue: 5,
      validation: (rule) => rule.required().integer().min(1).max(5),
    }),
    defineField({
      name: "featured",
      title: "Featured on homepage?",
      type: "boolean",
      description: "Only featured testimonials appear in the homepage slider.",
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: "quote", subtitle: "attribution" },
    prepare({ title, subtitle }: { title: string; subtitle: string }) {
      return {
        title: (title as string)?.slice(0, 80) ?? "Untitled testimonial",
        subtitle: subtitle ?? "A Lustique Bride",
      };
    },
  },
});
```

```ts
// studio/schemas/siteSettings.ts
import { defineType, defineField } from "sanity";

/**
 * Singleton document for global site settings.
 * Only one document of this type should exist (enforced by __experimental_actions).
 * Hero headline + sub-headline drive the index.astro hero section.
 * Testimonials selection is handled by the `featured` flag on testimonial documents.
 */
export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  __experimental_actions: ["update", "publish"],
  fields: [
    defineField({
      name: "heroHeadline",
      title: "Hero headline",
      type: "string",
      description: 'The main H1 on the homepage hero. Current: "Feel most like yourself."',
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: "heroSubheadline",
      title: "Hero sub-headline",
      type: "text",
      rows: 2,
      description: "The paragraph below the hero headline.",
      validation: (rule) => rule.required().max(300),
    }),
  ],
  preview: {
    select: { title: "heroHeadline" },
    prepare({ title }: { title: string }) {
      return { title: title ?? "Site Settings" };
    },
  },
});
```

```ts
// studio/schemas/index.ts
export { portfolioImage } from "./portfolioImage";
export { teamMember } from "./teamMember";
export { blogPost } from "./blogPost";
export { service } from "./service";
export { testimonial } from "./testimonial";
export { siteSettings } from "./siteSettings";
```

- [ ] **Step 6 — Create `studio/sanity.config.ts`**

```ts
// studio/sanity.config.ts
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import {
  portfolioImage,
  teamMember,
  blogPost,
  service,
  testimonial,
  siteSettings,
} from "./schemas";

export default defineConfig({
  name: "lustique",
  title: "Lustique Co.",
  projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? "",
  dataset: "production",

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Content")
          .items([
            S.listItem()
              .title("Site Settings")
              .child(
                S.document()
                  .schemaType("siteSettings")
                  .documentId("siteSettings")
              ),
            S.divider(),
            S.documentTypeListItem("portfolioImage").title("Portfolio Images"),
            S.documentTypeListItem("teamMember").title("Team Members"),
            S.documentTypeListItem("blogPost").title("Blog Posts"),
            S.documentTypeListItem("service").title("Services"),
            S.documentTypeListItem("testimonial").title("Testimonials"),
          ]),
    }),
    visionTool(),
  ],

  schema: {
    types: [portfolioImage, teamMember, blogPost, service, testimonial, siteSettings],
  },
});
```

- [ ] **Step 7 — Verify Studio starts (Pieter runs)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/studio"
SANITY_STUDIO_PROJECT_ID=<your-project-id> npx sanity dev
# Open http://localhost:3333 — all 6 content types should appear in the sidebar.
# Ctrl+C to stop.
```

- [ ] **Step 8 — Deploy Studio (Pieter runs)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/studio"
SANITY_STUDIO_PROJECT_ID=<your-project-id> npx sanity deploy
# When prompted for studio hostname: lustique
# Studio will be live at https://lustique.sanity.studio
```

- [ ] **Step 9 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add studio/
git commit -m "feat(cms): add Sanity Studio scaffold with all 6 content-type schemas (D1 Task 2)"
```

---

### Task 3 — GROQ queries + TypeScript types

> Build THIRD. Defines all GROQ queries and their TypeScript return types in one place. Pages import from here — no GROQ strings scattered across `.astro` files.

**Files:**
- Create `site/src/queries/portfolio.ts`
- Create `site/src/queries/portfolio.test.ts`
- Create `site/src/queries/team.ts`
- Create `site/src/queries/blog.ts`
- Create `site/src/queries/blog.test.ts`
- Create `site/src/queries/services.ts`
- Create `site/src/queries/services.test.ts`
- Create `site/src/queries/home.ts`
- Create `site/src/queries/home.test.ts`

**Interfaces:**

Produces (exported from each query file):
```ts
export type SanityPortfolioImage  // _id, title, image, alt, category, artistId, displayOrder
export type SanityTeamMember      // _id, name, slug, role, bio, photo?, displayOrder
export type SanityBlogPost        // _id, title, slug, excerpt, category, publishedAt?
export type SanityBlogPostFull    // SanityBlogPost + body: PortableTextBlock[]
export type SanityService         // _id, title, category, description, priceDisplay, image?, displayOrder, indicative?
export type SanityTestimonial     // _id, quote, attribution?, rating
export type SanityHomeSettingsQuery  // { settings: { heroHeadline?, heroSubheadline? } | null; testimonials: SanityTestimonial[] }
```

---

- [ ] **Step 1 — Write failing tests**

```ts
// site/src/queries/portfolio.test.ts
import { describe, it, expect } from "vitest";
import { PORTFOLIO_QUERY, type SanityPortfolioImage } from "./portfolio";

describe("portfolio query", () => {
  it("query string targets portfolioImage type", () => {
    expect(PORTFOLIO_QUERY).toContain('"portfolioImage"');
    expect(PORTFOLIO_QUERY).toContain("artistId");
    expect(PORTFOLIO_QUERY).toContain("category");
    expect(PORTFOLIO_QUERY).toContain("asset->");
  });

  it("SanityPortfolioImage type shape is correct", () => {
    const sample: SanityPortfolioImage = {
      _id: "abc",
      title: "Test image",
      image: { asset: { _ref: "image-abc-jpg", _type: "reference" }, _type: "image" },
      alt: "Test alt",
      category: "makeup",
      artistId: "zandeline",
      displayOrder: 1,
    };
    expect(sample.artistId).toBe("zandeline");
    expect(sample.category).toBe("makeup");
  });
});
```

```ts
// site/src/queries/blog.test.ts
import { describe, it, expect } from "vitest";
import {
  BLOG_INDEX_QUERY,
  BLOG_SLUGS_QUERY,
  BLOG_POST_QUERY,
  type SanityBlogPost,
} from "./blog";

describe("blog queries", () => {
  it("BLOG_INDEX_QUERY targets blogPost type and orders by publishedAt", () => {
    expect(BLOG_INDEX_QUERY).toContain('"blogPost"');
    expect(BLOG_INDEX_QUERY).toContain("publishedAt");
    expect(BLOG_INDEX_QUERY).toContain("excerpt");
  });

  it("BLOG_SLUGS_QUERY fetches only slugs", () => {
    expect(BLOG_SLUGS_QUERY).toContain('"blogPost"');
    expect(BLOG_SLUGS_QUERY).toContain("slug.current");
  });

  it("BLOG_POST_QUERY fetches by $slug param and includes body", () => {
    expect(BLOG_POST_QUERY).toContain("$slug");
    expect(BLOG_POST_QUERY).toContain("body");
    expect(BLOG_POST_QUERY).toContain("[0]");
  });

  it("SanityBlogPost type has required fields", () => {
    const sample: SanityBlogPost = {
      _id: "abc",
      title: "Test post",
      slug: "test-post",
      excerpt: "Short excerpt",
      category: "Guide",
    };
    expect(sample.slug).toBe("test-post");
  });
});
```

```ts
// site/src/queries/home.test.ts
import { describe, it, expect } from "vitest";
import { HOME_SETTINGS_QUERY, type SanityHomeSettingsQuery, type SanityTestimonial } from "./home";

describe("home query", () => {
  it("HOME_SETTINGS_QUERY fetches siteSettings and featured testimonials", () => {
    expect(HOME_SETTINGS_QUERY).toContain('"siteSettings"');
    expect(HOME_SETTINGS_QUERY).toContain('"testimonial"');
    expect(HOME_SETTINGS_QUERY).toContain("featured == true");
    expect(HOME_SETTINGS_QUERY).toContain("heroHeadline");
    expect(HOME_SETTINGS_QUERY).toContain("quote");
  });

  it("SanityHomeSettingsQuery has nested settings shape", () => {
    // Verifies the type has a nested `settings` key, not a flat shape.
    // index.astro must use homeData.settings?.heroHeadline — not homeData.heroHeadline.
    const sample: SanityHomeSettingsQuery = {
      settings: { heroHeadline: "Feel most like yourself.", heroSubheadline: "Sub text." },
      testimonials: [],
    };
    expect(sample.settings?.heroHeadline).toBe("Feel most like yourself.");
  });

  it("SanityHomeSettingsQuery settings can be null (before content is entered)", () => {
    const sample: SanityHomeSettingsQuery = { settings: null, testimonials: [] };
    expect(sample.settings?.heroHeadline).toBeUndefined();
  });

  it("SanityHomeSettingsQuery testimonials has correct shape", () => {
    const t: SanityTestimonial = {
      _id: "t1",
      quote: "They were wonderful.",
      attribution: "A Lustique Bride",
      rating: 5,
    };
    const sample: SanityHomeSettingsQuery = { settings: null, testimonials: [t] };
    expect(sample.testimonials[0].quote).toBe("They were wonderful.");
  });
});
```

```ts
// site/src/queries/services.test.ts
import { describe, it, expect } from "vitest";
import { SERVICES_QUERY } from "./services";

describe("services query", () => {
  it("SERVICES_QUERY fetches service type and orders by displayOrder", () => {
    expect(SERVICES_QUERY).toContain('"service"');
    expect(SERVICES_QUERY).toContain("displayOrder");
    expect(SERVICES_QUERY).toContain("priceDisplay");
    expect(SERVICES_QUERY).toContain("description");
  });
});
```

- [ ] **Step 2 — Run tests (expect FAIL)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/queries/portfolio.test.ts src/queries/blog.test.ts src/queries/home.test.ts src/queries/services.test.ts
```

Expected: `Cannot find module './portfolio'` and similar for each.

- [ ] **Step 3 — Implement all query files**

```ts
// site/src/queries/portfolio.ts
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityPortfolioImage = {
  _id: string;
  title: string;
  image: SanityImageObject;
  alt: string;
  category: "makeup" | "hair" | "party";
  artistId: string;
  displayOrder?: number;
};

export const PORTFOLIO_QUERY = `
  *[_type == "portfolioImage"] | order(coalesce(displayOrder, 999) asc) {
    _id,
    title,
    "image": image { asset->, hotspot, crop },
    alt,
    category,
    artistId,
    displayOrder
  }
` as const;
```

```ts
// site/src/queries/team.ts
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityTeamMember = {
  _id: string;
  name: string;
  slug: string;
  role: string;
  bio: string;
  photo?: SanityImageObject;
  displayOrder: number;
};

export const TEAM_QUERY = `
  *[_type == "teamMember"] | order(displayOrder asc) {
    _id,
    name,
    "slug": slug.current,
    role,
    bio,
    "photo": photo { asset->, hotspot, crop },
    displayOrder
  }
` as const;
```

```ts
// site/src/queries/blog.ts
import type { PortableTextBlock } from "@portabletext/types";

export type SanityBlogPost = {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  publishedAt?: string;
};

export type SanityBlogPostFull = SanityBlogPost & {
  body: PortableTextBlock[];
};

/** Blog index: all posts ordered newest-first. */
export const BLOG_INDEX_QUERY = `
  *[_type == "blogPost"] | order(coalesce(publishedAt, _createdAt) desc) {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    category,
    publishedAt
  }
` as const;

/** Slugs only — used by getStaticPaths to enumerate blog post routes. */
export const BLOG_SLUGS_QUERY = `
  *[_type == "blogPost" && defined(slug.current)] {
    "slug": slug.current
  }
` as const;

/** Single post by slug — includes full body Portable Text. */
export const BLOG_POST_QUERY = `
  *[_type == "blogPost" && slug.current == $slug][0] {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    category,
    publishedAt,
    body[] {
      ...,
      markDefs[] {
        ...,
        _type == "link" => {
          "href": @.href,
          "blank": @.blank
        }
      }
    }
  }
` as const;
```

```ts
// site/src/queries/services.ts
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

export type SanityService = {
  _id: string;
  title: string;
  category: "bridal" | "beyond-bridal";
  description: string;
  priceDisplay: string;
  image?: SanityImageObject;
  displayOrder: number;
  indicative?: boolean;
};

export const SERVICES_QUERY = `
  *[_type == "service"] | order(displayOrder asc) {
    _id,
    title,
    category,
    description,
    priceDisplay,
    "image": image { asset->, hotspot, crop },
    displayOrder,
    indicative
  }
` as const;
```

```ts
// site/src/queries/home.ts

export type SanityTestimonial = {
  _id: string;
  quote: string;
  attribution?: string;
  rating: number;
};

/**
 * Query-shaped type for the home GROQ projection.
 * The projection returns a nested object with `settings` and `testimonials` keys.
 * Access hero headline as: homeData.settings?.heroHeadline
 * NOT as: homeData.heroHeadline (flat access will not typecheck).
 */
export type SanityHomeSettingsQuery = {
  settings: { heroHeadline?: string; heroSubheadline?: string } | null;
  testimonials: SanityTestimonial[];
};

export const HOME_SETTINGS_QUERY = `
  {
    "settings": *[_type == "siteSettings"][0] {
      heroHeadline,
      heroSubheadline
    },
    "testimonials": *[_type == "testimonial" && featured == true] | order(_createdAt asc) {
      _id,
      quote,
      attribution,
      rating
    }
  }
` as const;
```

- [ ] **Step 4 — Run tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/queries/portfolio.test.ts src/queries/blog.test.ts src/queries/home.test.ts src/queries/services.test.ts
```

Expected: all tests pass (8 tests across 4 files).

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/src/queries/
git commit -m "feat(cms): add typed GROQ queries for all content types (D1 Task 3)"
```

---

### Task 4 — Portfolio and Team pages + Photo component

> Build FOURTH. Replaces `team.ts` data with Sanity fetches on `portfolio.astro` and `team.astro`. Filter JS is unchanged; the HTML structure is identical. `urlFor` is imported statically in the frontmatter — never with `await import()` inside a `.map()` callback.

**Files:**
- Modify `site/src/components/Photo.astro`
- Create `site/src/lib/imageUrl.ts`
- Create `site/src/lib/imageUrl.test.ts`
- Modify `site/src/pages/portfolio.astro`
- Modify `site/src/pages/team.astro`

**Interfaces:**

Consumes:
```ts
sanityClient.fetch<SanityPortfolioImage[]>(PORTFOLIO_QUERY)
sanityClient.fetch<SanityTeamMember[]>(TEAM_QUERY)
```

Produces: identical HTML output (same CSS classes, `data-filter`, `data-artist`, `data-cat` attributes).

---

- [ ] **Step 1 — Write imageUrl tests (expect FAIL)**

```ts
// site/src/lib/imageUrl.test.ts
import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SANITY_PROJECT_ID", "testprojid");
vi.stubEnv("SANITY_DATASET", "production");
vi.stubEnv("SANITY_API_VERSION", "2026-06-21");

describe("resolvePhotoSrc", () => {
  it("uses assets/ prefix for legacy src string", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    expect(resolvePhotoSrc("hero.jpg", undefined)).toBe("assets/hero.jpg");
  });

  it("generates Sanity CDN URL for sanityImage", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    const asset: any = {
      _type: "image",
      asset: { _ref: "image-abc123xyz-400x400-jpg", _type: "reference" },
    };
    const url = resolvePhotoSrc(undefined, asset, 400, 400);
    expect(url).toContain("cdn.sanity.io");
    expect(url).toContain("testprojid");
    expect(url).toContain("w=400");
  });

  it("throws when neither src nor sanityImage provided", async () => {
    const { resolvePhotoSrc } = await import("./imageUrl");
    expect(() => resolvePhotoSrc(undefined, undefined)).toThrow(
      "resolvePhotoSrc requires either src or sanityImage"
    );
  });
});
```

- [ ] **Step 2 — Run test (expect FAIL)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/lib/imageUrl.test.ts
```

Expected: `Cannot find module './imageUrl'`.

- [ ] **Step 3 — Create `site/src/lib/imageUrl.ts`**

```ts
// site/src/lib/imageUrl.ts
import { urlFor } from "./sanity";
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

/**
 * Pure function: derive the final img src string from either a legacy path
 * (under /assets/) or a Sanity image reference (CDN URL via @sanity/image-url).
 * Extracted from Photo.astro so it can be unit-tested without Astro rendering.
 */
export function resolvePhotoSrc(
  src: string | undefined,
  sanityImage: SanityImageObject | undefined,
  width = 800,
  height = 800
): string {
  if (sanityImage) {
    return urlFor(sanityImage)
      .width(width)
      .height(height)
      .fit("crop")
      .auto("format")
      .quality(85)
      .url();
  }
  if (src) {
    return `assets/${src}`;
  }
  throw new Error("resolvePhotoSrc requires either src or sanityImage");
}
```

- [ ] **Step 4 — Run tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/lib/imageUrl.test.ts
```

Expected: `3 tests passed`.

- [ ] **Step 5 — Update `site/src/components/Photo.astro`**

```astro
---
/* Photo.astro — responsive image wrapper.
   Accepts either:
     src (string): legacy path under /assets/ (existing site images)
     sanityImage (SanityImageObject): Sanity CDN image reference
   Backward-compatible — no existing page that passes only `src` needs to change.
*/
import { resolvePhotoSrc } from "../lib/imageUrl";
import type { SanityImageObject } from "@sanity/image-url/lib/types/types";

interface Props {
  src?: string;
  sanityImage?: SanityImageObject;
  alt: string;
  cls?: string;
  eager?: boolean;
  width?: number;
  height?: number;
}

const {
  src,
  sanityImage,
  alt,
  cls = "",
  eager = false,
  width = 800,
  height = 800,
} = Astro.props as Props;

const imgSrc = resolvePhotoSrc(src, sanityImage, width, height);
---
<div class={`ph img ${cls}`}>
  <img
    class="ph-img"
    src={imgSrc}
    alt={alt}
    loading={eager ? "eager" : "lazy"}
    decoding="async"
    width={width}
    height={height}
  />
</div>
```

- [ ] **Step 6 — Update `site/src/pages/portfolio.astro`**

`urlFor` is imported in the frontmatter (`---` block) and used in `.map()` — **not** with `await import()` inside `.map()` (which is invalid in Astro template expressions).

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { sanityClient, urlFor } from "../lib/sanity";
import { PORTFOLIO_QUERY, type SanityPortfolioImage } from "../queries/portfolio";
import { TEAM_QUERY, type SanityTeamMember } from "../queries/team";

const title = "Portfolio — Lustique Co.";
const desc =
  "Real brides, real mornings — a gallery of recent bridal hair and makeup work, filterable by artist.";

// Fetch images and artists from Sanity at build time.
const [images, artists] = await Promise.all([
  sanityClient.fetch<SanityPortfolioImage[]>(PORTFOLIO_QUERY),
  sanityClient.fetch<SanityTeamMember[]>(TEAM_QUERY),
]);

// Count images per artist (same logic as imageCountByArtist in team.ts).
const imageCountByArtist: Record<string, number> = {};
for (const artist of artists) {
  imageCountByArtist[artist.slug] = images.filter(
    (img) => img.artistId === artist.slug
  ).length;
}
---
<BaseLayout slug="portfolio.html" title={title} desc={desc} breadcrumb={[{ name: "Portfolio" }]}>

  <section class="page-hero">
    <span class="eyebrow">Portfolio</span>
    <h1>Real work. Real mornings.</h1>
    <p>
      Every image here is real work — never stock, never AI. Filter by artist to see each
      woman's hand; as each of our nine shares hers, her gallery fills in here.
    </p>
  </section>

  <section class="section"><div class="wrap">

    <div class="filters" id="artistFilters" role="group" aria-label="Filter portfolio by artist">
      <button type="button" class="active" data-filter="all">All artists</button>
      {artists.map((a) => (
        <button type="button" data-filter={a.slug} data-count={imageCountByArtist[a.slug]}>
          {a.name}
        </button>
      ))}
    </div>

    <div class="gallery" id="gallery">
      {images.map((img) => {
        // urlFor imported in frontmatter above — safe to call synchronously in .map().
        const src = urlFor(img.image).width(900).auto("format").quality(85).url();
        return (
          <img
            class="gitem"
            src={src}
            alt={img.alt}
            data-cat={img.category}
            data-artist={img.artistId}
            loading="lazy"
            decoding="async"
            width="900"
          />
        );
      })}
    </div>

    <div class="gallery-empty" id="galleryEmpty" hidden>
      <p class="lead"><span data-empty-name>This artist</span>'s portfolio is coming soon.</p>
      <p class="note">
        We add each artist's work as she shares it. In the meantime, browse our full gallery.
      </p>
      <button type="button" class="btn btn-ghost" data-reset>View all work</button>
    </div>

    <p class="note center" style="margin-top:2rem;">
      Every photograph here is our own real work — never stock, never AI. Per-artist galleries
      arrive as each of our nine artists shares hers.
    </p>
  </div></section>

  <section class="section cta-band">
    <div class="wrap">
      <span class="eyebrow reveal">Let's begin</span>
      <h2 class="reveal d1" style="margin-top:1rem;">Tell us about your day.</h2>
      <p class="reveal d2">
        Share a few details and we'll send a personalised quote — usually within 24 hours, often sooner.
      </p>
      <a class="btn btn-primary reveal d2" href="quote.html">Get a Quote</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 7 — Update `site/src/pages/team.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Photo from "../components/Photo.astro";
import { sanityClient } from "../lib/sanity";
import { TEAM_QUERY, type SanityTeamMember } from "../queries/team";

const title = "The Team — Lustique Co.";
const desc = "Meet the nine bridal artists of Lustique Co. — 40+ years of combined experience.";

const artists = await sanityClient.fetch<SanityTeamMember[]>(TEAM_QUERY);
---
<BaseLayout slug="team.html" title={title} desc={desc} breadcrumb={[{ name: "The Team" }]}>

  <section class="page-hero">
    <span class="eyebrow">The Team</span>
    <h1>Nine artists. One quiet<br />morning at a time.</h1>
    <p>
      Together our nine bridal artists bring over 40 years of combined experience.
      Whoever joins you on your day brings the same calm, the same standard, the same care.
    </p>
  </section>

  <section class="section"><div class="wrap">
    <div class="artist-grid">
      {artists.map((a, i) => (
        <div class={`artist reveal${["", " d1", " d2"][i % 3]}`}>
          {a.photo
            ? <Photo sanityImage={a.photo} alt={`${a.name} — Lustique Co. bridal artist`} width={400} height={400} />
            : <div class="ph"></div>
          }
          <h3>{a.name}</h3>
          <div class="role">{a.role}</div>
          <p>{a.bio}</p>
        </div>
      ))}
    </div>
    <p class="note center" style="margin-top:2.4rem;max-width:60ch;margin-inline:auto;">
      Each artist's portfolio will live as a highlight on our Instagram. We allocate the right
      artists for your wedding by date and party size — so you simply get the Lustique standard,
      every time.
    </p>
  </div></section>

  <section class="section cta-band">
    <div class="wrap">
      <span class="eyebrow reveal">Let's begin</span>
      <h2 class="reveal d1" style="margin-top:1rem;">Tell us about your day.</h2>
      <p class="reveal d2">
        Share a few details and we'll send a personalised quote — usually within 24 hours, often sooner.
      </p>
      <a class="btn btn-primary reveal d2" href="quote.html">Get a Quote</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 8 — Build check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx astro check
```

Expected: 0 type errors. (Requires `SANITY_PROJECT_ID` set in `site/.env`.)

- [ ] **Step 9 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/src/pages/portfolio.astro site/src/pages/team.astro site/src/components/Photo.astro site/src/lib/imageUrl.ts site/src/lib/imageUrl.test.ts
git commit -m "feat(cms): wire portfolio + team pages to Sanity; update Photo component for Sanity CDN (D1 Task 4)"
```

---

### Task 5 — Services and Homepage pages

> Build FIFTH. Replaces hard-coded service descriptions and testimonials with Sanity fetches. The hero headline on `index.astro` becomes CMS-driven. Prices remain as-is (shared/pricing untouched). `index.astro` accesses `homeData.settings?.heroHeadline` — the nested shape required by `SanityHomeSettingsQuery`.

**Files:**
- Modify `site/src/pages/services.astro`
- Modify `site/src/pages/index.astro`

**Interfaces:**

Consumes:
```ts
sanityClient.fetch<SanityService[]>(SERVICES_QUERY)
sanityClient.fetch<SanityHomeSettingsQuery>(HOME_SETTINGS_QUERY)
```

---

- [ ] **Step 1 — Run existing home + services tests (expect PASS — query files already created in Task 3)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/queries/home.test.ts src/queries/services.test.ts
```

Expected: all tests pass.

- [ ] **Step 2 — Update `services.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Photo from "../components/Photo.astro";
import { SITE } from "../data/site";
import { sanityClient } from "../lib/sanity";
import { SERVICES_QUERY, type SanityService } from "../queries/services";

const title = "Services — Lustique Co.";
const desc =
  "Bridal hair & makeup, plus matric, editorial, engagement, maternity, corporate, pageant and group lessons.";

// Fetch service documents from Sanity at build time.
const allServices = await sanityClient.fetch<SanityService[]>(SERVICES_QUERY);
const bridalServices = allServices.filter((s) => s.category === "bridal");
const beyondBridalServices = allServices.filter((s) => s.category === "beyond-bridal");

const serviceJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service", "@id": SITE + "/services.html#bridal-makeup",
      name: "Bridal Makeup", provider: { "@id": SITE + "/" },
      description: "Customised bridal makeup — soft glow or bold glam — using premium, long-wearing, photography-friendly products. From R850.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#bridal-hair",
      name: "Bridal Hair Styling", provider: { "@id": SITE + "/" },
      description: "Romantic curls, elegant updos or effortless waves styled to hold all day. From R495.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#matric",
      name: "Matric Farewell Makeup", provider: { "@id": SITE + "/" },
      description: "A standout look for her big night — glam that photographs beautifully and lasts through every dance. R750.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#editorial",
      name: "Editorial & Photoshoot Makeup", provider: { "@id": SITE + "/" },
      description: "Camera-ready makeup for editorial, brand and personal shoots. Lashes included on photoshoots. From R600.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#engagement",
      name: "Engagement & Maternity Shoot Makeup", provider: { "@id": SITE + "/" },
      description: "Soft, radiant looks for engagement and maternity shoots. From R650.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#pageant",
      name: "Pageant & Stage Makeup", provider: { "@id": SITE + "/" },
      description: "Bold, long-wearing makeup built for stage lighting and the camera. From R950.",
      areaServed: "Gauteng", serviceType: "BeautyTreatment",
    },
    {
      "@type": "Service", "@id": SITE + "/services.html#group-lessons",
      name: "Group Makeup Lessons", provider: { "@id": SITE + "/" },
      description: "Learn to do your own makeup — groups of 6+, at Bez Ranch or on location. Includes a brush-set goodie bag. From R600 per person.",
      areaServed: "Gauteng", serviceType: "EducationalOccupationalProgram",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
        { "@type": "ListItem", position: 2, name: "Services", item: SITE + "/services.html" },
      ],
    },
  ],
};
---
<BaseLayout slug="services.html" title={title} desc={desc} jsonld={serviceJsonLd}>

  <section class="page-hero">
    <span class="eyebrow">What we do</span>
    <h1>Flawless. Elegant. Unforgettable.</h1>
    <p>
      From the bride and her party to special-occasion glamour, every look is
      tailored — with quality, care, and a personal touch.
    </p>
  </section>

  <section class="section"><div class="wrap">
    <div class="center" style="margin-bottom:2.6rem;">
      <span class="eyebrow reveal">The wedding day</span>
      <h2 class="reveal d1" style="margin-top:.8rem;">Bridal hair &amp; makeup</h2>
    </div>
    <div class="cards">
      {bridalServices.length > 0
        ? bridalServices.map((s, i) => (
            <article class={`card reveal${i === 1 ? " d1" : i === 2 ? " d2" : ""}`}>
              <div class="card-media">
                {s.image
                  ? <Photo sanityImage={s.image} alt={s.title + " — Lustique Co."} width={600} height={400} />
                  : <div class="ph"></div>
                }
              </div>
              <div class="card-body">
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <p style="font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">
                  {s.priceDisplay}
                </p>
              </div>
            </article>
          ))
        : (
          /* Fallback: hard-coded cards if Sanity has no bridal service documents yet */
          <>
            <article class="card reveal"><div class="card-media"><Photo src="s1.jpg" alt="Bridal makeup by Lustique Co." /></div><div class="card-body"><h3>Bridal Makeup</h3><p>Enhance your natural beauty with a customised look — soft glow or bold glam — using premium, long-wearing, photography-friendly products.</p><p style="font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R850</p></div></article>
            <article class="card reveal d1"><div class="card-media"><Photo src="s2.jpg" alt="Bridal hair by Lustique Co." /></div><div class="card-body"><h3>Bridal Hair</h3><p>Romantic curls, elegant updos, or effortless waves — styled to complement your features, dress and theme, and to hold all day.</p><p style="font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R495</p></div></article>
            <article class="card reveal d2"><div class="card-media"><Photo src="s3.jpg" alt="A bridal party styled by Lustique Co." /></div><div class="card-body"><h3>The Whole Party</h3><p>Bridesmaids, mothers, flower girls and guests — cohesive yet individual, calmly choreographed so everyone is ready and glowing.</p><p style="font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">see pricing</p></div></article>
          </>
        )
      }
    </div>
  </div></section>

  <section class="section" style="background:var(--ivory);"><div class="wrap">
    <div class="center" style="margin-bottom:2.6rem;">
      <span class="eyebrow reveal">Beyond bridal</span>
      <h2 class="reveal d1" style="margin-top:.8rem;">For every special occasion</h2>
      <p class="reveal d2" style="max-width:52ch;margin:1rem auto 0;color:#5c5048;">
        We do any event — and group lessons too.
      </p>
    </div>
    <div class="cards">
      {beyondBridalServices.length > 0
        ? beyondBridalServices.map((s, i) => (
            <article class={`card reveal${i === 1 ? " d1" : i === 2 ? " d2" : ""}`} style="padding:2.1rem 1.9rem;">
              <span class="eyebrow">0{i + 1}</span>
              <h3 style="margin:.6rem 0 .6rem;">{s.title}</h3>
              <p>{s.description}</p>
              <p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">
                {s.priceDisplay}{s.indicative ? "*" : ""}
              </p>
            </article>
          ))
        : (
          /* Fallback: hard-coded cards if Sanity has no beyond-bridal documents yet */
          <>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">01</span><h3 style="margin:.6rem 0 .6rem;">Matric Farewell</h3><p>A standout look for her big night — glam that photographs beautifully and lasts through every dance.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">R750</p></article>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">02</span><h3 style="margin:.6rem 0 .6rem;">Editorial &amp; Photoshoot</h3><p>Camera-ready makeup for editorial, brand and personal shoots. Lashes included on photoshoots.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R600</p></article>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">03</span><h3 style="margin:.6rem 0 .6rem;">Engagement &amp; Maternity</h3><p>Soft, radiant looks for engagement and maternity shoots — natural, warm, and you.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R650*</p></article>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">04</span><h3 style="margin:.6rem 0 .6rem;">Corporate &amp; Events</h3><p>Polished makeup for corporate events, galas and celebrations, for one face or many.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R650*</p></article>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">05</span><h3 style="margin:.6rem 0 .6rem;">Pageant &amp; Stage</h3><p>Bold, long-wearing makeup built for stage lighting and the camera.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R950*</p></article>
            <article class="card reveal" style="padding:2.1rem 1.9rem;"><span class="eyebrow">06</span><h3 style="margin:.6rem 0 .6rem;">Group Lessons</h3><p>Learn to do your own makeup with us — groups of 6+, at Bez Ranch (Kameelfontein) or on location. Includes a brush-set goodie bag.</p><p style="margin-top:1rem;font-family:var(--serif);font-size:1.3rem;color:var(--mocha);">from R600 pp</p></article>
          </>
        )
      }
    </div>
    <p class="note center" style="margin-top:1.6rem;">* Indicative — final pricing to be confirmed with our team.</p>
  </div></section>

  <section class="section cta-band">
    <div class="wrap">
      <span class="eyebrow reveal">Let's begin</span>
      <h2 class="reveal d1" style="margin-top:1rem;">Tell us about your day.</h2>
      <p class="reveal d2">
        Share a few details and we'll send a personalised quote — usually within 24 hours, often sooner.
      </p>
      <a class="btn btn-primary reveal d2" href="quote.html">Get a Quote</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 3 — Update `index.astro` testimonials + hero**

Access hero headline via `homeData.settings?.heroHeadline` (nested shape). `astro check` must pass with this access pattern.

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Photo from "../components/Photo.astro";
import { sanityClient } from "../lib/sanity";
import { HOME_SETTINGS_QUERY, type SanityHomeSettingsQuery } from "../queries/home";

const title = "Lustique Co. — Bridal Hair & Makeup Artistry | Pretoria & Beyond";
const desc =
  "Bridal hair and makeup for the bride who wants to feel most like herself. Nine artists, 40+ years combined, serving Pretoria, Gauteng and beyond since 2018.";

// Fetch hero settings + testimonials from Sanity at build time.
// Falls back to hard-coded defaults if Sanity data is not yet populated.
const homeData = await sanityClient.fetch<SanityHomeSettingsQuery>(HOME_SETTINGS_QUERY);

// Access via homeData.settings?.heroHeadline — the query projection wraps settings in a nested key.
const heroHeadline = homeData?.settings?.heroHeadline ?? "Feel most like yourself.";
const heroSub =
  homeData?.settings?.heroSubheadline ??
  "For the bride who wants to look softly, unmistakably, unforgettably like herself — on the morning that matters most.";

// Use Sanity testimonials if available; fall back to hard-coded samples.
const testimonials =
  homeData?.testimonials?.length > 0
    ? homeData.testimonials
    : [
        {
          _id: "fallback-1",
          quote:
            "They felt less like a vendor and more like the calmest people in the room. I looked like me — just the version I always hoped to be on my wedding day.",
          attribution: "A Lustique Bride",
          rating: 5,
        },
        {
          _id: "fallback-2",
          quote:
            "My whole bridal party was ready, relaxed and glowing. Not one moment of stress all morning.",
          attribution: "A Lustique Bride",
          rating: 5,
        },
        {
          _id: "fallback-3",
          quote:
            "The trial sold me. They listened, adjusted, and on the day my makeup lasted from the first photo to the last dance.",
          attribution: "A Lustique Bride",
          rating: 5,
        },
      ];
---
<BaseLayout slug="index.html" title={title} desc={desc}>

  <section class="hero" aria-label="Lustique Co. — bridal hair and makeup artistry">
    <img class="hero-img" src="assets/hero.jpg" alt="A Lustique bride on her wedding morning — softly lit, hair styled, looking quietly radiant" fetchpriority="high" />
    <div class="hero-overlay"></div>
    <div class="hero-inner">
      <span class="eyebrow">Bridal Hair &amp; Makeup Artistry · Pretoria &amp; Beyond</span>
      <h1 class="hero-title display">{heroHeadline}</h1>
      <p class="hero-sub">{heroSub}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="pricing.html">Get your estimate</a>
        <a class="btn btn-light" href="portfolio.html">View the portfolio</a>
      </div>
    </div>
  </section>

  <section class="trust">
    <div class="wrap">
      <div class="trust-item">We travel to you on your wedding day</div>
      <div class="trust-item">Trials by appointment, <b>in&nbsp;studio</b></div>
      <div class="trust-item">Personal, from your trial to the final touch-up</div>
    </div>
  </section>

  <section class="section statement">
    <div class="wrap">
      <span class="eyebrow reveal">Who we are</span>
      <h2 class="reveal d1" style="margin-top:1rem;">The artist a bride chooses when she wants to feel most like herself.</h2>
      <p class="reveal d2">We are a team of nine bridal artists, working as one quiet, capable presence on the morning of your wedding. Since 2018 we have made it our craft to enhance — never to mask — so that when you look in the mirror, you simply see yourself, on your most radiant day.</p>
      <p class="reveal d2">From your trial to the final touch-up, every detail is personal, calm, and considered. We count it a blessing to play a small part in your day.</p>
      <div class="quote-block reveal d3">
        <p class="lead">"Beauty begins the moment you decide to be yourself."</p>
        <cite>— Coco Chanel</cite>
      </div>
    </div>
  </section>

  <section class="section" style="background:var(--ivory);">
    <div class="wrap">
      <div class="services-head">
        <div><span class="eyebrow reveal">What we do</span><h2 class="reveal d1" style="margin-top:1rem;">Flawless. Elegant.<br>Unforgettable.</h2></div>
        <p class="reveal d2" style="max-width:34ch;color:#5c5048;">Every look is tailored to you — your features, your dress, the feeling of your day.</p>
      </div>
      <div class="cards">
        <article class="card reveal"><div class="card-media"><Photo src="s1.jpg" alt="Bridal makeup by Lustique Co." /></div><div class="card-body"><h3>Bridal Makeup</h3><p>A soft, lasting look built on flawless skin — from natural radiance to timeless glamour, made to last from "I do" to the last dance.</p><a class="card-link" href="services.html">Explore makeup <span>→</span></a></div></article>
        <article class="card reveal d1"><div class="card-media"><Photo src="s2.jpg" alt="Bridal hair styling by Lustique Co." /></div><div class="card-body"><h3>Bridal Hair</h3><p>From romantic soft curls to elegant updos, styled to complement your features, your dress and the spirit of your celebration.</p><a class="card-link" href="services.html">Explore hair <span>→</span></a></div></article>
        <article class="card reveal d2"><div class="card-media"><Photo src="s3.jpg" alt="A bridal party styled by Lustique Co." /></div><div class="card-body"><h3>The Whole Party</h3><p>Bridesmaids, mothers, flower girls and guests — beautifully cohesive, individually considered, calmly choreographed on the day.</p><a class="card-link" href="pricing.html">Explore packages <span>→</span></a></div></article>
      </div>
    </div>
  </section>

  <section class="section team">
    <div class="wrap team-grid">
      <div class="team-collage reveal"><Photo src="t1.jpg" alt="A Lustique artist styling a bride" /><Photo src="t2.jpg" alt="Bridal hair detail" /><Photo src="t3.jpg" alt="Bridal makeup detail" /><Photo src="t4.jpg" alt="A Lustique bride on her wedding morning" /></div>
      <div class="team-copy">
        <span class="eyebrow reveal">The Lustique team</span>
        <h2 class="reveal d1">Nine artists.<br>One quiet morning at a time.</h2>
        <p class="reveal d2">Lustique is no longer one pair of hands — it is a team of nine bridal artists who move as one. Whoever joins you on your day brings the same calm, the same standard, the same care.</p>
        <p class="reveal d2">We allocate the right artists for your wedding so you never have to. You simply get the Lustique standard, every time.</p>
        <div class="stat-row reveal d3">
          <div class="stat"><b>9</b><span>Artists</span></div>
          <div class="stat"><b>40+</b><span>Years combined</span></div>
          <div class="stat"><b>2018</b><span>Since</span></div>
        </div>
        <div style="margin-top:2rem;" class="reveal d3"><a class="btn btn-ghost" href="team.html">Meet the team</a></div>
      </div>
    </div>
  </section>

  <section class="section pricing">
    <div class="wrap">
      <div class="pricing-head">
        <span class="eyebrow reveal">Transparent pricing</span>
        <h2 class="reveal d1">Know your investment before you enquire.</h2>
        <p class="reveal d2">No vague ranges, no "request a quote to find out." See clear starting prices, then build a personalised estimate in under a minute.</p>
      </div>
      <div class="price-grid">
        <div class="price reveal"><small>Solo Bride · trial + day</small><div class="amt"><sup>from R</sup>2 690</div></div>
        <div class="price reveal d1"><small>Bridesmaid · makeup</small><div class="amt"><sup>R</sup>550</div></div>
        <div class="price reveal d2"><small>Mother · makeup</small><div class="amt"><sup>R</sup>500</div></div>
        <div class="price reveal d3"><small>Bridal hair</small><div class="amt"><sup>from R</sup>495</div></div>
      </div>
      <div class="pricing-foot">
        <p>Free travel within 30 km of our La Montagne studio · R7/km beyond · prices scale with hair length</p>
        <a class="btn btn-light reveal" href="pricing.html">See full pricing &amp; estimate →</a>
      </div>
    </div>
  </section>

  <section class="section testi">
    <div class="wrap">
      <div class="stars reveal">★★★★★</div>
      <div class="testi-slider reveal d1">
        {testimonials.map((t, i) => (
          <div class={`testi-slide${i === 0 ? " active" : ""}`}>
            <p class="lead">"{t.quote}"</p>
            <cite>{t.attribution ?? "A Lustique Bride"}</cite>
          </div>
        ))}
      </div>
      <div class="testi-dots"></div>
      <div class="sub reveal d2">— real bride testimonials · manage in Sanity Studio</div>
    </div>
  </section>

  <section class="section" style="background:var(--ivory);">
    <div class="wrap res-grid">
      <div class="res-copy">
        <span class="eyebrow reveal">For your big day</span>
        <h2 class="reveal d1">Free guides, from us to you.</h2>
        <p class="reveal d2">A 30-day bridal skin-prep plan, a wedding-morning timeline, and more — thoughtful resources to help your day feel calm and considered. Yours, free.</p>
        <a class="btn btn-primary reveal d2" href="guides.html">Browse the guides</a>
      </div>
      <div class="res-media reveal d1"><Photo src="res.jpg" alt="A calm Lustique bridal morning" /></div>
    </div>
  </section>
  
  <section class="section cta-band">
    <div class="wrap">
      <span class="eyebrow reveal">Let's begin</span>
      <h2 class="reveal d1" style="margin-top:1rem;">Tell us about your day.</h2>
      <p class="reveal d2">Share a few details and we'll send a personalised quote — usually within 24 hours, often sooner.</p>
      <a class="btn btn-primary reveal d2" href="quote.html">Get a Quote</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 4 — Build check (astro check must pass with nested settings access)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx astro check
```

Expected: 0 type errors. Verify `homeData?.settings?.heroHeadline` resolves — if `astro check` complains about `settings` being `null`, confirm `SanityHomeSettingsQuery.settings` is typed as `{ heroHeadline?: string; heroSubheadline?: string } | null` (the `?.` operator handles null correctly).

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/src/pages/services.astro site/src/pages/index.astro site/src/queries/home.test.ts site/src/queries/services.test.ts
git commit -m "feat(cms): wire services + homepage testimonials/hero to Sanity (D1 Task 5)"
```

---

### Task 6 — Blog: dynamic route + PortableText renderer + redirect rules

> Build SIXTH. Creates the dynamic `[slug].astro` blog route, updates the blog index, creates `PortableText.astro` with a real link component (not the string shorthand), and adds the CF Pages redirect rules. The 3 old static pages are **not deleted here** — deletion happens in Task 7 after seeding.

**Files:**
- Create `site/src/components/PortableTextLink.astro` (real link mark component)
- Create `site/src/components/PortableText.astro` (wrapper using `PortableTextLink`)
- Create `site/src/pages/blog/[slug].astro`
- Modify `site/src/pages/blog.astro`
- Create `site/public/_redirects`

**Interfaces:**

Consumes:
```ts
sanityClient.fetch<{slug: string}[]>(BLOG_SLUGS_QUERY)   // getStaticPaths
sanityClient.fetch<SanityBlogPostFull>(BLOG_POST_QUERY, { slug })  // page render
sanityClient.fetch<SanityBlogPost[]>(BLOG_INDEX_QUERY)   // blog index
```

Produces (when 3 Sanity blogPost docs exist):
- `blog/choosing-artist.html`
- `blog/bridal-trial.html`
- `blog/2026-trends.html`

---

- [ ] **Step 1 — Verify blog tests from Task 3 still pass**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run src/queries/blog.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 2 — Create `site/public/_redirects`**

```
# Redirect old blog-*.html URLs to new blog/ directory URLs (301 permanent).
# These redirects must be committed BEFORE the 3 old .astro pages are deleted
# (deletion happens in Task 7, after Sanity content is seeded).
# CF Pages processes this file automatically at deploy time.
/blog-choosing-artist.html  /blog/choosing-artist.html  301
/blog-bridal-trial.html     /blog/bridal-trial.html     301
/blog-2026-trends.html      /blog/2026-trends.html      301
```

- [ ] **Step 3 — Create `site/src/components/PortableTextLink.astro`**

This is a real component that reads `value.href` and `value.blank` from the mark node. The `marks: { link: "a" }` string shorthand is **not used** — it drops `href`. This component handles both internal links (relative `.html` paths) and external links (open in new tab via `blank: true`).

```astro
---
// site/src/components/PortableTextLink.astro
// Real link mark component for astro-portabletext.
// Handles the `link` annotation defined in studio/schemas/blogPost.ts:
//   fields: [{ name: "href", type: "string" }, { name: "blank", type: "boolean" }]
//
// IMPORTANT: do NOT use marks: { link: "a" } string shorthand in PortableText.astro —
// that shorthand does not forward value.href to the <a> element.
import type { PortableTextMarkComponentProps } from "astro-portabletext/types";

type LinkValue = { href: string; blank?: boolean };
type Props = PortableTextMarkComponentProps<LinkValue>;

const { node } = Astro.props;
const href = node.value?.href ?? "#";
const isBlank = node.value?.blank === true;
---
{isBlank
  ? <a href={href} target="_blank" rel="noopener noreferrer"><slot /></a>
  : <a href={href}><slot /></a>
}
```

- [ ] **Step 4 — Create `site/src/components/PortableText.astro`**

```astro
---
// site/src/components/PortableText.astro
// Renders Sanity Portable Text blocks to HTML using astro-portabletext v2.
// Supported blocks: paragraphs, h2, h3, strong, em, external + internal links.
// Internal links in body use relative .html hrefs (e.g. "portfolio.html") —
// these are stored verbatim in the Sanity content and passed through unchanged.
import { PortableText } from "astro-portabletext";
import type { PortableTextBlock } from "@portabletext/types";
import PortableTextLink from "./PortableTextLink.astro";

interface Props {
  value: PortableTextBlock[];
}

const { value } = Astro.props;

const components = {
  mark: {
    // Wire the `link` annotation to the real PortableTextLink component.
    // This component reads node.value.href and node.value.blank.
    // Do NOT replace this with the string shorthand "a" — that drops href.
    link: PortableTextLink,
  },
};
---
<PortableText value={value} components={components} />
```

- [ ] **Step 5 — Create `site/src/pages/blog/[slug].astro`**

```astro
---
// site/src/pages/blog/[slug].astro
// Dynamic blog post route. One HTML page per blogPost document in Sanity.
// Astro build.format: "file" emits blog/choosing-artist.html (not blog/choosing-artist/index.html).
import BaseLayout from "../../layouts/BaseLayout.astro";
import PortableText from "../../components/PortableText.astro";
import { sanityClient } from "../../lib/sanity";
import {
  BLOG_SLUGS_QUERY,
  BLOG_POST_QUERY,
  type SanityBlogPostFull,
} from "../../queries/blog";

export async function getStaticPaths() {
  const posts = await sanityClient.fetch<{ slug: string }[]>(BLOG_SLUGS_QUERY);
  return posts.map((p) => ({ params: { slug: p.slug } }));
}

const { slug } = Astro.params;
const post = await sanityClient.fetch<SanityBlogPostFull>(BLOG_POST_QUERY, { slug });

if (!post) {
  // Guard required by TypeScript; should not occur in a static build where
  // getStaticPaths controls the full set of params.
  return Astro.redirect("/blog.html", 302);
}

const eyebrow = `Journal · ${post.category ?? "Guide"}`;
const pubDate = post.publishedAt
  ? new Date(post.publishedAt).toLocaleDateString("en-ZA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  : null;
---
<BaseLayout
  slug={`blog/${slug}.html`}
  title={`${post.title} | Lustique Co.`}
  desc={post.excerpt}
  breadcrumb={[{ name: "Journal", item: "https://lustiqueco.co.za/blog.html" }, { name: post.title }]}
>

  <section class="page-hero">
    <span class="eyebrow">{eyebrow}</span>
    <h1>{post.title}</h1>
    <p>{post.excerpt}</p>
    {pubDate && <p class="note" style="margin-top:.5rem;">{pubDate}</p>}
  </section>

  <section class="section"><div class="wrap prose">
    {Array.isArray(post.body) && post.body.length > 0
      ? <PortableText value={post.body} />
      : <p>This article is coming soon.</p>
    }
  </div></section>

  <section class="section cta-band">
    <div class="wrap">
      <span class="eyebrow reveal">Let's begin</span>
      <h2 class="reveal d1" style="margin-top:1rem;">Tell us about your day.</h2>
      <p class="reveal d2">Share a few details and we'll send a personalised quote — usually within 24 hours, often sooner.</p>
      <a class="btn btn-primary reveal d2" href="quote.html">Get a Quote</a>
    </div>
  </section>

</BaseLayout>
```

- [ ] **Step 6 — Update `site/src/pages/blog.astro` index**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { sanityClient } from "../lib/sanity";
import { BLOG_INDEX_QUERY, type SanityBlogPost } from "../queries/blog";

const title = "Journal — Bridal Beauty Advice | Lustique Co.";
const desc = "Honest, practical bridal hair and makeup advice from a Pretoria team.";

const posts = await sanityClient.fetch<SanityBlogPost[]>(BLOG_INDEX_QUERY);
---
<BaseLayout slug="blog.html" title={title} desc={desc}>

  <section class="page-hero">
    <span class="eyebrow">Journal</span>
    <h1>Notes for your big day</h1>
    <p>Honest, practical advice from a team that has spent hundreds of wedding mornings doing exactly this.</p>
  </section>

  <section class="section"><div class="wrap">
    <div class="cards">
      {posts.length > 0
        ? posts.map((post, i) => (
            <article class={`card reveal${i === 1 ? " d1" : i === 2 ? " d2" : ""}`} style="padding:2rem 1.9rem;">
              <span class="eyebrow">Guide</span>
              <h3 style="margin:.6rem 0 .7rem;">{post.title}</h3>
              <p style="font-size:.96rem;color:#5c5048;margin-bottom:1.2rem;">{post.excerpt}</p>
              <a class="card-link" href={`blog/${post.slug}.html`}>Read <span>→</span></a>
            </article>
          ))
        : (
          /* Fallback: placeholder card if Sanity has no posts yet (shown pre-seeding) */
          <article class="card reveal" style="padding:2rem 1.9rem;">
            <span class="eyebrow">Journal</span>
            <h3 style="margin:.6rem 0 .7rem;">Articles coming soon</h3>
            <p style="font-size:.96rem;color:#5c5048;">Our journal is on its way — check back soon for honest advice from the Lustique team.</p>
          </article>
        )
      }
    </div>
  </div></section>

</BaseLayout>
```

- [ ] **Step 7 — Build check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx astro check
```

Expected: 0 type errors.

Note: `npx astro build` at this point will produce an empty `dist/blog/` directory if Sanity has no blogPost documents yet — that is correct and expected. The blog index page (`blog.html`) will show the fallback placeholder card. Blog post pages are built only when Sanity documents exist (Task 7 seeds them).

- [ ] **Step 8 — Run all site tests**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run
```

Expected: all tests pass (`sanity.test.ts`, `imageUrl.test.ts`, `portfolio.test.ts`, `blog.test.ts`, `home.test.ts`, `services.test.ts`).

- [ ] **Step 9 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/src/components/PortableText.astro site/src/components/PortableTextLink.astro site/src/pages/blog/ site/src/pages/blog.astro site/public/_redirects
git commit -m "feat(cms): add dynamic blog route + PortableText renderer with real link component (D1 Task 6)"
```

---

### Task 7 — Seed Sanity content; delete old blog pages; verify full build

> Build SEVENTH. Pieter seeds content in Studio; Sonnet deletes old static blog pages and runs final build verification. The blog `dist/blog/` verification step runs **after** seeding — not before — because the pages only exist once the Sanity documents are published.

**Ordering is critical:**
1. Pieter seeds → publishes → CF Pages rebuilds
2. Sonnet deletes old `.astro` pages locally
3. Sonnet runs `astro build` locally (with `site/.env` pointing to the live Sanity project)
4. Sonnet verifies `dist/blog/` contains the 3 expected HTML files

---

**Pieter actions (before Sonnet verification):**

1. **Log in to `lustique.sanity.studio`** and create the following documents:

**Team Members (9)** — Studio → Team Members → New (×9):

| displayOrder | name | slug (auto) | role | bio |
|---|---|---|---|---|
| 1 | Zandeline | zandeline | Founder | A bridal artist since 2018 — Lustique Co. began with her. |
| 2 | Monique | monique | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 3 | Marize | marize | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 4 | Jana | jana | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 5 | Janeke | janeke | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 6 | Elria | elria | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 7 | Maroné | marone | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 8 | René | rene | Bridal Artist | Bridal-specialised artist. Bio coming soon. |
| 9 | Samantha | samantha | Bridal Artist | Bridal-specialised artist. Bio coming soon. |

2. **Blog Posts (3)** — copy body content from the old `.astro` files (open them in a text editor) before deletion:

| title | slug | category | excerpt |
|---|---|---|---|
| How to Choose a Bridal Makeup Artist in Pretoria | choosing-artist | Pretoria | Five things that separate a great bridal artist from a risky booking — and the questions to ask before you pay a deposit. |
| What to Expect at Your Bridal Trial | bridal-trial | Trials | Your trial is the most important appointment before the wedding. Here's how to get the most from it. |
| Bridal Beauty for 2026 & 2027: Soft, Timeless, You | 2026-trends | Style | Why the most-loved looks right now are the ones that still look like you in twenty years' time. |

For each body field: paste the article prose from the old `.astro` files into the Studio rich-text editor. Convert `<h2>` headings to Heading 2 blocks; `<p>` paragraphs to Normal blocks; `<a href="...">` to link annotations with the href value copied exactly (e.g. `href="portfolio.html"` → href field = `portfolio.html`).

3. **Testimonials (3)** — create 3 testimonials, tick "Featured on homepage?":

| quote | attribution |
|---|---|
| They felt less like a vendor and more like the calmest people in the room. I looked like me — just the version I always hoped to be on my wedding day. | A Lustique Bride |
| My whole bridal party was ready, relaxed and glowing. Not one moment of stress all morning. | A Lustique Bride |
| The trial sold me. They listened, adjusted, and on the day my makeup lasted from the first photo to the last dance. | A Lustique Bride |

4. **Site Settings (singleton)** — Studio → Site Settings (top of sidebar):
   - Hero headline: `Feel most like yourself.`
   - Hero sub-headline: `For the bride who wants to look softly, unmistakably, unforgettably like herself — on the morning that matters most.`

5. **Publish all documents** (click Publish on each).

6. **Confirm CF Pages rebuild fires**: check CF Pages dashboard → Deployments — a new build should appear within 30 seconds of publishing.

---

- [ ] **Step 1 — Delete the 3 old static blog pages (Sonnet, after Pieter confirms seeding is complete)**

> Only run this after Pieter confirms all 3 blogPost documents are published in Sanity Studio with the correct slugs.

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src/pages"
rm blog-2026-trends.astro blog-bridal-trial.astro blog-choosing-artist.astro
```

- [ ] **Step 2 — Run full local build to verify blog pages are generated**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx astro build 2>&1 | tail -20
```

Expected: build completes successfully, 0 errors.

- [ ] **Step 3 — Verify blog pages exist in dist/**

```bash
ls "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/dist/blog/"
```

Expected output (3 files, because Sanity documents were seeded in Pieter's Step 5 above):
```
2026-trends.html  bridal-trial.html  choosing-artist.html
```

If `dist/blog/` is empty, Sanity has not been seeded yet — do NOT proceed to deletion. Confirm with Pieter that the 3 blogPost documents are published and retry the build.

- [ ] **Step 4 — Verify redirect rules are in the build output**

```bash
grep "blog-choosing-artist" "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/public/_redirects"
```

Expected: line containing `/blog-choosing-artist.html  /blog/choosing-artist.html  301`.

- [ ] **Step 5 — Run all site tests (final)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git rm site/src/pages/blog-2026-trends.astro site/src/pages/blog-bridal-trial.astro site/src/pages/blog-choosing-artist.astro
git commit -m "feat(cms): delete 3 hard-coded blog pages — replaced by Sanity dynamic route (D1 Task 7)"
```

---

### Task 8 — Update sitemap.xml.ts with dynamic blog URLs

> Build EIGHTH. Updates the sitemap to emit canonical `/blog/<slug>` URLs for each blog post. The 3 old `blog-*.html` entries are removed (their redirects are already in `_redirects`). The sitemap fetches slugs from Sanity at build time.

**Files:**
- Modify `site/src/pages/sitemap.xml.ts`

---

- [ ] **Step 1 — Update `site/src/pages/sitemap.xml.ts`**

Replace the 3 hard-coded `blog-*.html` entries with a dynamic query for all published `blogPost` slugs. Static pages remain unchanged.

```ts
// site/src/pages/sitemap.xml.ts
import type { APIRoute } from "astro";
import { sanityClient } from "../lib/sanity";
import { BLOG_SLUGS_QUERY } from "../queries/blog";

const SITE = "https://lustiqueco.co.za";

// Static pages (unchanged from original sitemap, minus the 3 old blog-*.html entries)
const staticSlugs = [
  "index.html", "about.html", "services.html", "team.html", "pricing.html", "portfolio.html",
  "faq.html", "guides.html", "contact.html", "quote.html", "terms.html", "privacy.html",
  "guide-skin-prep.html", "guide-timeline.html", "guide-artist.html",
  "blog.html",
];

const LASTMOD = "2026-06-21";

export const GET: APIRoute = async () => {
  // Fetch all published blog post slugs from Sanity at build time.
  let blogSlugs: string[] = [];
  try {
    const posts = await sanityClient.fetch<{ slug: string }[]>(BLOG_SLUGS_QUERY);
    blogSlugs = posts.map((p) => `blog/${p.slug}.html`);
  } catch {
    // If Sanity is unreachable during build, omit blog entries rather than failing.
    blogSlugs = [];
  }

  const allSlugs = [...staticSlugs, ...blogSlugs];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allSlugs
    .map((s) => `  <url><loc>${SITE}/${s === "index.html" ? "" : s}</loc><lastmod>${LASTMOD}</lastmod></url>`)
    .join("\n")}\n</urlset>`;

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
```

- [ ] **Step 2 — Build check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx astro build 2>&1 | tail -10
```

Expected: build completes. Check the generated sitemap:

```bash
grep "blog/" "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/dist/sitemap.xml"
```

Expected: `<loc>https://lustiqueco.co.za/blog/choosing-artist.html</loc>` (and the other 2 blog posts), with no `blog-choosing-artist.html` top-level entries.

- [ ] **Step 3 — Run all tests**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site"
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add site/src/pages/sitemap.xml.ts
git commit -m "feat(cms): update sitemap to emit canonical blog/<slug>.html URLs from Sanity (D1 Task 8)"
```

---

## Pieter / One-time Setup

| # | Action | Where | When |
|---|---|---|---|
| P1 | Create Sanity project, note Project ID | sanity.io/manage | Before Task 1 |
| P2 | Add Zandeline as editor in Sanity project members | sanity.io/manage → Members | Before Task 7 |
| P3 | Create `site/.env` with `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_VERSION` | local dev | Before Task 1 |
| P4 | Set CF Pages build env vars: `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_VERSION` | CF Pages dashboard → Settings → Env vars → Production | Before first CF Pages rebuild |
| P5 | Generate CF Pages deploy hook for `main` branch | CF Pages dashboard → Settings → Builds & deployments → Deploy hooks | Before Task 7 seeding |
| P6 | Add Sanity webhook pointing to CF Pages deploy hook URL | sanity.io/manage → API → Webhooks | Before Task 7 seeding |
| P7 | Install npm packages: `cd site && npm install @sanity/client @sanity/image-url astro-portabletext && npm install --save-dev vitest @vitest/coverage-v8` | Terminal | Before Task 1 |
| P8 | Create studio workspace and install deps: `mkdir studio && cd studio && npm init -y && npm install sanity @sanity/vision react react-dom && npm install --save-dev typescript` | Terminal | Before Task 2 |
| P9 | Run `SANITY_STUDIO_PROJECT_ID=<id> npx sanity dev` to verify Studio starts locally | Terminal, from `studio/` | After Task 2 |
| P10 | Run `SANITY_STUDIO_PROJECT_ID=<id> npx sanity deploy` — hostname: `lustique` | Terminal, from `studio/` | After Task 2 |
| P11 | Seed 9 team members, 3 blog posts, 3 testimonials, site settings in Studio | lustique.sanity.studio | Task 7 |
| P12 | Confirm CF Pages rebuild fires after publishing | CF Pages dashboard → Deployments | Task 7 |
| P13 | Copy article body prose from 3 old `.astro` files into Sanity blog post body fields before they are deleted in Task 7 Step 1 | lustique.sanity.studio | Task 7 (before Step 1) |

---

## Self-review — Spec Coverage

Every locked constraint and "Opus must answer" question mapped to the task that covers it.

| Requirement | Covered in |
|---|---|
| Raw `@sanity/client` (no `@sanity/astro`) | A1, Task 1 |
| Standalone hosted Studio (`lustique.sanity.studio`) | A2, Task 2 |
| Public dataset, no read token | A3, Task 1 |
| Images via Sanity CDN + `@sanity/image-url` | A4, Tasks 4–5 (Photo.astro + imageUrl.ts) |
| CSP `img-src` includes `https://cdn.sanity.io` | Global Constraint 9, Task 1 (`_headers`) |
| Rebuild on publish: Sanity webhook → CF Pages deploy hook | A5, Pieter P5/P6 |
| Blog migration: 3 hard-coded pages → Sanity dynamic route | A6, Tasks 6–7 |
| Portable Text rendering: real link component, not string shorthand | A7, Task 6 (PortableTextLink.astro) |
| `link` mark reads `value.href` + `value.blank` (not dropped) | A7, Task 6 (PortableTextLink.astro Step 3) |
| No dead `internalLink` serialiser (schema defines only `link`) | A7 architecture decision, Task 6 Step 4 |
| Zandeline day-1 publishing flow | A8 architecture decision, Task 7 |
| Accent-safe artist slug generation | A9, Task 2 (teamMember schema slugify) |
| `team.ts` not deleted immediately | A10, Tasks 4–7 |
| `SanityHomeSettingsQuery` has nested `.settings` shape | A11, Task 3 (home.ts) + Task 5 (index.astro) |
| `homeData?.settings?.heroHeadline` typechecks (astro check passes) | A11, Task 5 Step 4 |
| `home.test.ts` asserts nested `.settings` shape | A11, Task 3 Step 1 (home.test.ts) |
| `urlFor` imported statically in portfolio.astro frontmatter | Task 4 Step 6 (not `await import()` in `.map()`) |
| Portfolio page backed by Sanity | Task 4 |
| Team page backed by Sanity | Task 4 |
| Blog index + dynamic route from Sanity | Task 6 |
| Services page backed by Sanity (copy only, no pricing) | Task 5 |
| Homepage testimonials + hero from Sanity | Task 5 |
| `shared/pricing` untouched | Global Constraint 3; Task 5 (priceDisplay is display string only) |
| Old blog URL 301 redirects | Task 6 (`_redirects`) |
| Sitemap emits canonical `/blog/<slug>` URLs | Task 8 |
| Old `blog-*.html` sitemap entries removed | Task 8 |
| Schema: portfolioImage | Task 2 |
| Schema: teamMember | Task 2 |
| Schema: blogPost (only `link` annotation, no `internalLink`) | Task 2 |
| Schema: service (`priceDisplay` is string, not number) | Task 2 |
| Schema: testimonial | Task 2 |
| Schema: siteSettings (singleton) | Task 2 |
| `studio/.env.example` documents `SANITY_STUDIO_PROJECT_ID` | Task 2 Step 4 |
| No Supabase migrations | Global Constraint 4 (stated explicitly) |
| Vitest co-located tests for all logic | Tasks 1, 3, 4, 5 |
| `"test": "vitest run"` script in `site/package.json` | Task 1 Step 3 |
| `build.format: "file"` + `.html` URLs | Global Constraint 7; Tasks 6–8 |
| CF Pages build env vars documented | A3, Pieter P4 |
| `npm install` only in Pieter's terminal | Global Constraint 8, Pieter P7/P8 |
| iCloud polling config preserved | No changes to `astro.config.mjs` Vite config |
| Blog build verification matches reality (seeding before `ls dist/blog/`) | Task 7 Step 3 (verify runs after Pieter seeds) |

---

*Co-authored: Opus 4.8 planning (architecture decisions, schema design, migration path, Zandeline flow) · Sonnet 4.6 builds (all task code, tests, file edits).*
*Updated: 2026-06-22 — revision 2 (adversarial review fixes applied)*
