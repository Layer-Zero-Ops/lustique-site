# Wave D4 — Artist Allocation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (- [ ]) syntax.

**Goal:** Create a dedicated `artists` table, seed the 9 Lustique artists, re-point `booking_artists.artist_id` to it, and add a JWT-gated assignment widget to the booking-detail admin page so Zandeline can assign and remove artists from any `quote_sent` or `accepted` booking.

> ## ⚠️ Build corrections (adversarial review — apply these; they OVERRIDE any conflicting inline text below)
> 1. **Test import position** — put `import { handleAdminBookingDetail } from "./dashboard";` in the TOP import block of `dashboard-d4.test.ts` (in the Task 2 Step 1 code block), NOT appended after `describe()` blocks in Task 3 — ESM forbids import-after-statement (TS1128) and the file will not compile.
> 2. **`ARTIST_ASSIGNABLE_STATUSES`** — include this constant inside the shown replacement code block for `handleAdminBookingDetail`, not only in prose; a single-edit replace that omits it yields an undefined-variable compile error.
> 3. **File-structure table** — `ArtistRow` / `BookingArtistRow` are IMPORTED from `./artists` (as the implementation does), not redefined in `dashboard.ts`. Fix the table so the builder doesn't create duplicate interfaces.
> 4. **Constraint 2 wording** — `corsHeaders` / `secHeaderMap` are NOT exported from `index.ts`; `artists.ts` uses redirect-only (PRG) responses, so it never needs them. Drop the "import them from ../index" note.
> 5. **Valid CLI** — `supabase db execute --sql` is not a command. Apply the migration via `supabase db push` (Pieter's terminal, already in Pieter actions); for ad-hoc checks use `supabase db query` or `psql`.

**Architecture:** Migration `0013_artists.sql` creates the `artists` table (no `auth.users` dependency), seeds the 9 artists, and re-points the `booking_artists.artist_id` FK from `profiles(id)` to `artists(id)`. Two new POST endpoints (`/api/admin/booking/:id/artists` and `/api/admin/booking/:id/artists/remove`) live in `worker/src/booking/artists.ts`. The booking-detail GET handler in `dashboard.ts` is extended to fetch current assignments and render the assignment widget inline. A local `ArtistsHandlerEnv` interface in `artists.ts` avoids any circular import with `dashboard.ts`.

**Tech Stack:**
- Cloudflare Worker (TypeScript) — new handler file `worker/src/booking/artists.ts`
- Supabase PostgREST — fetch-only, no SDK; service-key for writes, mirroring `db.ts`
- Vitest — co-located test file `worker/src/booking/dashboard-d4.test.ts`
- SQL migration — `supabase/migrations/0013_artists.sql`

---

## Global Constraints

1. **Test runner:** Vitest (`vitest run`). Test files are co-located with source (`worker/src/booking/dashboard-d4.test.ts`). Smoke-test variant uses `.env.smoke` + `npm run smoke`.
2. **Security headers — JSON errors:** every JSON error response in `artists.ts` must use the shape: `new Response(JSON.stringify({ error: string }), { status, headers: { "content-type": "application/json", ...corsHeaders(origin), ...secHeaderMap({ html: false }) } })`. The `corsHeaders` and `secHeaderMap` helpers are already in the Worker; import them from `../index` or replicate — see Task 2.
3. **Security headers — HTML responses:** every HTML response goes through the existing `htmlResponse()` helper in `dashboard.ts` (lines 43–54). The `artists.ts` handlers do **not** render HTML; they POST-Redirect-Get back to the booking detail page.
4. **Money/pricing rule:** `shared/pricing` is **not touched** by this wave.
5. **Migration numbering:** highest existing migration is `0012_review_email.sql`. New migration: **`0013_artists.sql`**.
6. **Naming/voice:** brand-neutral language. No "assistant" rank in copy. All non-founder artists are equal "Bridal Artist". Widget copy: "Assign artist" / "Remove".
7. **XSS safety:** all database-sourced strings rendered into HTML must pass through `esc()`. The `esc` function is defined in `dashboard.ts` line 38–41 — use it directly there; `artists.ts` renders no HTML so it does not need its own copy.
8. **Injectable fetch:** every db-layer function accepts `f: typeof fetch = fetch` as the last argument so tests can mock it without module-level patching.
9. **Audit trail:** every mutating action (assign, remove) calls `writeAudit()` from `worker/src/booking/audit.ts`.
10. **No circular import:** `artists.ts` must NOT import from `dashboard.ts`. Define a local `ArtistsHandlerEnv` interface (see Task 2 Architecture Decisions §1).
11. **PostgREST ordering:** order by `lead.desc` in the query; sort by `name` in TypeScript after the fetch — do NOT order by an embedded column.
12. **`booking_artists` columns:** use the existing `lead boolean` (true = lead artist) and `confirmed_at`. Do NOT invent a `role TEXT` column.

---

## Architecture Decisions

### 1. Dedicated `artists` table (LOCKED — overrides prior plan)

A new `artists` table is created in migration `0013_artists.sql`. This removes the `auth.users` email-uniqueness migration risk entirely — no writes to `auth.users`.

Schema:
```sql
CREATE TABLE artists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  phone       text,
  specialisms text[] DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
```

RLS mirrors `booking_artists`:
- `ENABLE ROW LEVEL SECURITY` on the table
- `CREATE POLICY artists_admin_read ON artists FOR SELECT USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))`
- No anon access; service-role bypasses RLS for writes

### 2. FK re-point (LOCKED)

`booking_artists.artist_id` currently references `profiles(id)`. Since `booking_artists` has zero rows, the re-point is safe:
```sql
ALTER TABLE booking_artists DROP CONSTRAINT IF EXISTS booking_artists_artist_id_fkey;
ALTER TABLE booking_artists ADD CONSTRAINT booking_artists_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE;
```

### 3. Seed data — 9 Lustique artists

Fixed UUIDs for reproducibility across environments. Emails use `firstname@lustiqueco.co.za` placeholder format (Pieter action: collect real emails from Zandeline).

| UUID | Name | Specialisms |
|---|---|---|
| `a1000000-0000-0000-0000-000000000001` | Zandeline | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000002` | Monique | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000003` | Marize | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000004` | Jana | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000005` | Janeke | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000006` | Elria | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000007` | Maroné | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000008` | René | `{bridal-hair,bridal-makeup}` |
| `a1000000-0000-0000-0000-000000000009` | Samantha | `{bridal-hair,bridal-makeup}` |

### 4. `booking_artists` — existing columns used by D4

Table already exists from `0009_profiles.sql`. D4 uses:
- `booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE` (re-pointed by migration)
- `lead boolean NOT NULL DEFAULT false` — `true` = lead artist, `false` = supporting artist
- `confirmed_at timestamptz` — nullable, set by future confirmation flow (out of scope for D4)
- `UNIQUE (booking_id, artist_id)` — prevents duplicate assignments

The widget role select maps: value `"true"` → `lead = true`; value `"false"` → `lead = false`.

### 5. UI design — assignment widget

A new section is appended to the booking-detail `inner` HTML block in `handleAdminBookingDetail` (after the Rejections section, before the Notes section). The widget renders:

**Current assignments table:** artist name, role badge ("Lead" or "Artist"), "Remove" button (a `<form method="POST">` to `/api/admin/booking/:id/artists/remove` with hidden `artist_id`).

**Assign form:** a `<select name="artist_id">` of active artists not yet assigned (filtered client-side by subtracting current assignment IDs from the full list), a `<select name="lead">` for role (`true` = Lead, `false` = Artist), and a submit button.

When booking status is not `quote_sent` or `accepted`, both forms render locked with a read-only message.

### 6. API surface

Two new POST endpoints, both JWT-gated via `getAdminSession`:

| Method | Path | Body | Action |
|---|---|---|---|
| POST | `/api/admin/booking/:id/artists` | form: `artist_id`, `lead` | INSERT `booking_artists` |
| POST | `/api/admin/booking/:id/artists/remove` | form: `artist_id` | DELETE `booking_artists` |

Both redirect to `GET /api/admin/booking/:id?saved=1` on success (Post-Redirect-Get, matching the existing quote-save pattern).

On error: redirect back with `?error=...` param (no bare error page — keep Zandeline in-flow).

### 7. No circular import — `ArtistsHandlerEnv`

`artists.ts` defines its own env interface locally:
```ts
interface ArtistsHandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}
```
This is structurally compatible with `DashboardEnv` (which already satisfies it). The handlers in `artists.ts` accept `ArtistsHandlerEnv`, not `DashboardEnv`.

### 8. Calendar integration (D2 dependency)

`booking_artists` rows link `booking_id → artist_id → artists.email`. Wave D2 (calendar) reads this join to populate Google Calendar event attendees. D4 produces the data; D2 reads it. The D2 calendar handler will query:
```
booking_artists?booking_id=eq.{id}&select=artist_id,artists(name,email)
```
using PostgREST resource embedding. No D2 code changes are in scope for D4.

### 9. Artist login access

**Out of scope for D4.** No Supabase Auth login flow for artists. Artists are admin-managed roster only. The `artists` table has no FK to `auth.users`.

### 10. Route registration in `index.ts`

Two new route blocks added in the JWT-gated section (after the existing `/api/admin/booking/:id` GET block):

```ts
// POST /api/admin/booking/:id/artists — assign artist
if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists")) {
  const id = url.pathname.slice("/api/admin/booking/".length, -"/artists".length);
  if (id) return await handleAssignArtist(req, dashEnv, id);
}
// POST /api/admin/booking/:id/artists/remove — remove artist
if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists/remove")) {
  const id = url.pathname.slice("/api/admin/booking/".length, -"/artists/remove".length);
  if (id) return await handleRemoveArtist(req, dashEnv, id);
}
```

---

## File Structure

| Path | Create / Modify | Responsibility |
|---|---|---|
| `supabase/migrations/0013_artists.sql` | **Create** | Create `artists` table; RLS policies; seed 9 artists; re-point `booking_artists.artist_id` FK |
| `worker/src/booking/artists.ts` | **Create** | `listArtists`, `listBookingArtists`, `assignArtist`, `removeArtist` db helpers; `handleAssignArtist` and `handleRemoveArtist` HTTP handlers |
| `worker/src/booking/dashboard.ts` | **Modify** | Extend `handleAdminBookingDetail` GET to fetch + render artist assignment widget; add `ArtistRow` and `BookingArtistRow` interfaces |
| `worker/src/index.ts` | **Modify** | Import `handleAssignArtist`, `handleRemoveArtist` from `artists.ts`; add two POST route blocks in the JWT-gated section |
| `worker/src/booking/dashboard-d4.test.ts` | **Create** | TDD tests for the assignment widget render, assign handler, remove handler, guard (wrong status), and sort order |

---

## Task 1 — Migration: `artists` table, seed, FK re-point

**Files:**
- Create: `supabase/migrations/0013_artists.sql`

**Interfaces:**
- Produces: `artists` table with 9 rows; `booking_artists.artist_id` FK now references `artists(id)`

### Steps

- [ ] **Step 1 — Write the migration file**

```sql
-- supabase/migrations/0013_artists.sql
-- Wave D4: dedicated artists table; seed 9 Lustique artists; re-point booking_artists FK.
-- Does NOT touch auth.users.

-- ── 1. Create artists table ───────────────────────────────────────────────────
CREATE TABLE artists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  phone       text,
  specialisms text[] DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE artists ENABLE ROW LEVEL SECURITY;

-- Admin can read; service-role writes (bypasses RLS).
CREATE POLICY artists_admin_read ON artists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── 2. Seed 9 Lustique artists ────────────────────────────────────────────────
-- Fixed UUIDs for reproducibility; emails are placeholders (update via Pieter action).
INSERT INTO artists (id, name, email, specialisms) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Zandeline', 'zandeline@lustiqueco.co.za', ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000002', 'Monique',   'monique@lustiqueco.co.za',   ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000003', 'Marize',    'marize@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000004', 'Jana',      'jana@lustiqueco.co.za',      ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000005', 'Janeke',    'janeke@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000006', 'Elria',     'elria@lustiqueco.co.za',     ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000007', 'Maroné',    'marone@lustiqueco.co.za',    ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000008', 'René',      'rene@lustiqueco.co.za',      ARRAY['bridal-hair','bridal-makeup']),
  ('a1000000-0000-0000-0000-000000000009', 'Samantha',  'samantha@lustiqueco.co.za',  ARRAY['bridal-hair','bridal-makeup']);

-- ── 3. Re-point booking_artists.artist_id FK → artists(id) ───────────────────
-- Safe: booking_artists has no rows (confirmed from schema recon).
ALTER TABLE booking_artists DROP CONSTRAINT IF EXISTS booking_artists_artist_id_fkey;
ALTER TABLE booking_artists
  ADD CONSTRAINT booking_artists_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE;
```

- [ ] **Step 2 — Verify the file exists**

```bash
ls -la "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/supabase/migrations/0013_artists.sql"
```

Expected: file present, non-zero size.

- [ ] **Step 3 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add supabase/migrations/0013_artists.sql
git commit -m "feat(db): add artists table, seed 9 artists, re-point booking_artists FK (0013)"
```

---

## Task 2 — `worker/src/booking/artists.ts` — DB helpers + HTTP handlers

**Files:**
- Create: `worker/src/booking/artists.ts`
- Test: `worker/src/booking/dashboard-d4.test.ts` (partial — assign + remove handlers tested here; widget render tested in Task 3)

**Interfaces:**

Consumes:
- `getAdminSession(req, authEnv, fetchFn)` from `./auth` → `AdminUser | null`
- `writeAudit(env, { bookingId, eventType, payload }, fetchFn)` from `./audit`
- Supabase PostgREST via `fetch`

Produces:
- `listArtists(env, f?) → Promise<ArtistRow[]>` — all active artists, sorted by name in TS
- `listBookingArtists(env, bookingId, f?) → Promise<BookingArtistRow[]>` — current assignments for one booking, ordered lead.desc from PostgREST, then by name in TS
- `handleAssignArtist(req, env, bookingId, fetchFn?) → Promise<Response>` — POST handler
- `handleRemoveArtist(req, env, bookingId, fetchFn?) → Promise<Response>` — POST handler

### Steps

- [ ] **Step 1 — Write the failing tests**

```ts
// worker/src/booking/dashboard-d4.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleAssignArtist, handleRemoveArtist, listArtists, listBookingArtists } from "./artists";
import { AUTH_COOKIE } from "./auth";

// ── JWT helpers (same pattern as dashboard-c2.test.ts) ────────────────────────

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintJwt(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TEST_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

async function validAdminJwt(): Promise<string> {
  return mintJwt({
    sub: "aaaaaaaa-0000-0000-0000-000000000001",
    email: "zandeline@lustiqueco.co.za",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
}

const mockAudit = { put: vi.fn().mockResolvedValue(undefined) };

const env = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "svc-key",
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  AUDIT: mockAudit,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const adminProfile = [{ role: "admin", full_name: "Zandeline" }];

const postReq = (path: string, body: Record<string, string>, cookie?: string) => {
  const headers: HeadersInit = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
};

const getReq = (path: string, cookie?: string) => {
  const headers: HeadersInit = {};
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { headers });
};

// ── listArtists ───────────────────────────────────────────────────────────────

describe("listArtists", () => {
  it("returns active artists sorted by name", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      json([
        { id: "a1", name: "Zandeline", email: "z@l.co.za", active: true, specialisms: ["bridal-hair"] },
        { id: "a2", name: "Elria",     email: "e@l.co.za", active: true, specialisms: ["bridal-hair"] },
        { id: "a3", name: "Jana",      email: "j@l.co.za", active: true, specialisms: ["bridal-hair"] },
      ]),
    );
    const result = await listArtists(env, f as unknown as typeof fetch);
    expect(result.map((a) => a.name)).toEqual(["Elria", "Jana", "Zandeline"]);
  });
});

// ── listBookingArtists ────────────────────────────────────────────────────────

describe("listBookingArtists", () => {
  it("returns assignments ordered lead-first then by name", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      json([
        { id: "ba1", booking_id: "bk1", artist_id: "a1", lead: false, confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Zandeline", email: "z@l.co.za" } },
        { id: "ba2", booking_id: "bk1", artist_id: "a2", lead: true,  confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Elria",     email: "e@l.co.za" } },
        { id: "ba3", booking_id: "bk1", artist_id: "a3", lead: false, confirmed_at: null, created_at: "2026-06-01T10:00:00Z", artists: { name: "Jana",      email: "j@l.co.za" } },
      ]),
    );
    const result = await listBookingArtists(env, "bk1", f as unknown as typeof fetch);
    // lead first, then alphabetical by name
    expect(result[0]!.lead).toBe(true);
    expect(result[0]!.artists.name).toBe("Elria");
    expect(result[1]!.artists.name).toBe("Jana");
    expect(result[2]!.artists.name).toBe("Zandeline");
  });
});

// ── handleAssignArtist ────────────────────────────────────────────────────────

describe("handleAssignArtist", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1", lead: "false" }),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("rejects when booking status is 'requested' (guard)", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "requested" }]));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1", lead: "false" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });

  it("inserts booking_artists row and redirects to booking detail on quote_sent booking", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "quote_sent" }]));
      if (url.includes("/booking_artists")) return Promise.resolve(json([], 201));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { artist_id: "a1000000-0000-0000-0000-000000000001", lead: "true" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
  });

  it("inserts booking_artists row on accepted booking", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk2")) return Promise.resolve(json([{ id: "bk2", status: "accepted" }]));
      if (url.includes("/booking_artists")) return Promise.resolve(json([], 201));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk2/artists", { artist_id: "a1000000-0000-0000-0000-000000000002", lead: "false" }, token),
      env,
      "bk2",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk2?saved=1");
  });

  it("rejects missing artist_id with error redirect", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      return Promise.resolve(json([]));
    });
    const res = await handleAssignArtist(
      postReq("/api/admin/booking/bk1/artists", { lead: "false" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });
});

// ── handleRemoveArtist ────────────────────────────────────────────────────────

describe("handleRemoveArtist", () => {
  it("redirects to login without session", async () => {
    const f = vi.fn();
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", { artist_id: "a1" }),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/api/admin/login");
  });

  it("deletes booking_artists row and redirects to booking detail", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      if (url.includes("/bookings?id=eq.bk1")) return Promise.resolve(json([{ id: "bk1", status: "quote_sent" }]));
      if (url.includes("/booking_artists?")) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/audit_log")) return Promise.resolve(json({}));
      return Promise.resolve(json([]));
    });
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", { artist_id: "a1000000-0000-0000-0000-000000000001" }, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/booking/bk1?saved=1");
  });

  it("rejects missing artist_id with error redirect", async () => {
    const token = await validAdminJwt();
    const f = vi.fn((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(json(adminProfile));
      return Promise.resolve(json([]));
    });
    const res = await handleRemoveArtist(
      postReq("/api/admin/booking/bk1/artists/remove", {}, token),
      env,
      "bk1",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  });
});
```

- [ ] **Step 2 — Run tests (expect FAIL — module not found)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/dashboard-d4.test.ts 2>&1 | head -40
```

Expected output: `Cannot find module './artists'` or equivalent import error.

- [ ] **Step 3 — Write the implementation**

```ts
// worker/src/booking/artists.ts
// Wave D4 — Artist allocation handlers + db helpers.
// Uses a local ArtistsHandlerEnv to avoid circular import with dashboard.ts.

import { getAdminSession, loginRedirect, type AuthEnv } from "./auth";
import { writeAudit } from "./audit";

// ── Local env interface — no import from dashboard.ts ────────────────────────

interface ArtistsHandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ArtistRow {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  specialisms: string[];
}

export interface BookingArtistRow {
  id: string;
  booking_id: string;
  artist_id: string;
  lead: boolean;
  confirmed_at: string | null;
  created_at: string;
  artists: { name: string; email: string | null };
}

// ── PostgREST helpers ─────────────────────────────────────────────────────────

function rest(env: ArtistsHandlerEnv, path: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${path}`;
}

function svcHeaders(env: ArtistsHandlerEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "content-type": "application/json",
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * List all active artists from the `artists` table.
 * Orders by name ascending (sorted in TypeScript after fetch).
 */
export async function listArtists(
  env: ArtistsHandlerEnv,
  f: typeof fetch = fetch,
): Promise<ArtistRow[]> {
  const r = await f(
    rest(env, "artists?active=eq.true&select=id,name,email,active,specialisms"),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`listArtists ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as ArtistRow[];
  // Sort by name in TypeScript — do not rely on PostgREST embedded column ordering.
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * List booking_artists rows for a booking, joined with artists(name, email).
 * PostgREST orders by lead.desc; TypeScript then stably sorts by artist name within each group.
 */
export async function listBookingArtists(
  env: ArtistsHandlerEnv,
  bookingId: string,
  f: typeof fetch = fetch,
): Promise<BookingArtistRow[]> {
  const r = await f(
    rest(
      env,
      `booking_artists?booking_id=eq.${encodeURIComponent(bookingId)}&select=id,booking_id,artist_id,lead,confirmed_at,created_at,artists(name,email)&order=lead.desc`,
    ),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`listBookingArtists ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as BookingArtistRow[];
  // Stable sort: lead-first (already from PostgREST), then by name within each group.
  return rows.sort((a, b) => {
    if (a.lead !== b.lead) return a.lead ? -1 : 1;
    return a.artists.name.localeCompare(b.artists.name, "en");
  });
}

/**
 * Insert a booking_artists row (assign artist to booking).
 * Throws on duplicate (UNIQUE constraint) — caller handles.
 */
async function insertBookingArtist(
  env: ArtistsHandlerEnv,
  bookingId: string,
  artistId: string,
  lead: boolean,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, "booking_artists"), {
    method: "POST",
    headers: { ...svcHeaders(env), prefer: "return=minimal" },
    body: JSON.stringify({ booking_id: bookingId, artist_id: artistId, lead }),
  });
  if (!r.ok) throw new Error(`insertBookingArtist ${r.status}: ${await r.text()}`);
}

/**
 * Delete a booking_artists row (remove artist from booking).
 */
async function deleteBookingArtist(
  env: ArtistsHandlerEnv,
  bookingId: string,
  artistId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(
    rest(
      env,
      `booking_artists?booking_id=eq.${encodeURIComponent(bookingId)}&artist_id=eq.${encodeURIComponent(artistId)}`,
    ),
    {
      method: "DELETE",
      headers: { ...svcHeaders(env), prefer: "return=minimal" },
    },
  );
  if (!r.ok) throw new Error(`deleteBookingArtist ${r.status}: ${await r.text()}`);
}

/**
 * Fetch the booking status by id. Returns null if not found.
 */
async function getBookingStatus(
  env: ArtistsHandlerEnv,
  bookingId: string,
  f: typeof fetch = fetch,
): Promise<{ id: string; status: string } | null> {
  const r = await f(
    rest(env, `bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,status&limit=1`),
    { headers: svcHeaders(env) },
  );
  if (!r.ok) throw new Error(`getBookingStatus ${r.status}`);
  const rows = (await r.json()) as Array<{ id: string; status: string }>;
  return rows.length ? rows[0]! : null;
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

const ASSIGNABLE_STATUSES = ["quote_sent", "accepted"];

function errorRedirect(bookingId: string, message: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/api/admin/booking/${encodeURIComponent(bookingId)}?error=${encodeURIComponent(message)}`,
    },
  });
}

function successRedirect(bookingId: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/api/admin/booking/${encodeURIComponent(bookingId)}?saved=1` },
  });
}

/**
 * POST /api/admin/booking/:id/artists
 * Form body: artist_id (uuid), lead ("true" | "false")
 * Guard: booking must be in quote_sent or accepted status.
 */
export async function handleAssignArtist(
  req: Request,
  env: ArtistsHandlerEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  const user = await getAdminSession(req, authEnv, fetchFn);
  if (!user) return loginRedirect();

  let artistId: string;
  let lead: boolean;
  try {
    const fd = await req.formData();
    artistId = ((fd.get("artist_id") as string | null) ?? "").trim();
    const leadRaw = ((fd.get("lead") as string | null) ?? "false").trim();
    lead = leadRaw === "true";
  } catch {
    return errorRedirect(bookingId, "Invalid form data");
  }

  if (!artistId) return errorRedirect(bookingId, "Missing artist_id");

  // Validate UUID format (basic guard; PostgREST will 400 on bad UUID anyway)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(artistId)) return errorRedirect(bookingId, "Invalid artist_id");

  // Status guard
  let booking: { id: string; status: string } | null;
  try {
    booking = await getBookingStatus(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    return errorRedirect(bookingId, `Cannot assign artists when status is ${booking.status}`);
  }

  try {
    await insertBookingArtist(env, bookingId, artistId, lead, fetchFn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    // UNIQUE violation surfaces as a 409/400 from PostgREST
    return errorRedirect(bookingId, msg.includes("23505") || msg.includes("duplicate") ? "Artist already assigned" : "Assignment failed");
  }

  await writeAudit(
    env,
    { bookingId, eventType: "artist_assigned", payload: { artistId, lead, assignedBy: user.email } },
    fetchFn,
  );

  return successRedirect(bookingId);
}

/**
 * POST /api/admin/booking/:id/artists/remove
 * Form body: artist_id (uuid)
 * Guard: booking must be in quote_sent or accepted status.
 */
export async function handleRemoveArtist(
  req: Request,
  env: ArtistsHandlerEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const authEnv: AuthEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
  };
  const user = await getAdminSession(req, authEnv, fetchFn);
  if (!user) return loginRedirect();

  let artistId: string;
  try {
    const fd = await req.formData();
    artistId = ((fd.get("artist_id") as string | null) ?? "").trim();
  } catch {
    return errorRedirect(bookingId, "Invalid form data");
  }

  if (!artistId) return errorRedirect(bookingId, "Missing artist_id");

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(artistId)) return errorRedirect(bookingId, "Invalid artist_id");

  // Status guard
  let booking: { id: string; status: string } | null;
  try {
    booking = await getBookingStatus(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    return errorRedirect(bookingId, `Cannot remove artists when status is ${booking.status}`);
  }

  try {
    await deleteBookingArtist(env, bookingId, artistId, fetchFn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return errorRedirect(bookingId, msg);
  }

  await writeAudit(
    env,
    { bookingId, eventType: "artist_removed", payload: { artistId, removedBy: user.email } },
    fetchFn,
  );

  return successRedirect(bookingId);
}
```

- [ ] **Step 4 — Run tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/dashboard-d4.test.ts 2>&1
```

Expected: all tests in `dashboard-d4.test.ts` pass.

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add worker/src/booking/artists.ts worker/src/booking/dashboard-d4.test.ts
git commit -m "feat(worker): add artists.ts handlers + db helpers; TDD passing (D4)"
```

---

## Task 3 — Extend `handleAdminBookingDetail` with the assignment widget

**Files:**
- Modify: `worker/src/booking/dashboard.ts`
  - Add `ArtistRow` and `BookingArtistRow` interfaces (lines ~522 area, after existing interfaces)
  - Add fifth parallel fetch for `booking_artists` join
  - Add artist widget section to `inner` HTML block (after Rejections, before Notes)
- Test: `worker/src/booking/dashboard-d4.test.ts` (add new `describe` block for the widget render)

**Interfaces:**

Consumes:
- `listArtists` and `listBookingArtists` from `./artists` (imported at top of dashboard.ts)
- Existing `fetchFn` injectable in `handleAdminBookingDetail`

Produces:
- HTML widget rendered in booking detail page

### Steps

- [ ] **Step 1 — Add failing tests for the widget render**

Append to `worker/src/booking/dashboard-d4.test.ts`:

```ts
// ── Widget render integration tests ──────────────────────────────────────────
import { handleAdminBookingDetail } from "./dashboard";

const sampleBooking = {
  id: "bk-detail-01",
  reference: "LUS-2026-999",
  status: "quote_sent",
  bride_name: "Thandi Dlamini",
  bride_email: "thandi@example.com",
  bride_phone: "0821234567",
  wedding_date: "2027-05-10",
  town: "Pretoria",
  province: "Gauteng",
  venue: "The Rosewood",
  party_size: 5,
  total_cents: 500000,
  deposit_pct: 50,
  deposit_net_cents: 250000,
  balance_net_cents: 250000,
  occasion: "wedding",
  quote_lines: [],
  created_at: "2026-06-01T10:00:00Z",
  quote_sent_at: "2026-06-02T10:00:00Z",
  accepted_at: null,
  rejected_at: null,
  invoice_expired_at: null,
  availability_conflict: false,
  notes: null,
};

const sampleArtists = [
  { id: "a1000000-0000-0000-0000-000000000001", name: "Zandeline", email: "zandeline@lustiqueco.co.za", active: true, specialisms: ["bridal-hair"] },
  { id: "a1000000-0000-0000-0000-000000000006", name: "Elria",     email: "elria@lustiqueco.co.za",    active: true, specialisms: ["bridal-hair"] },
];

const sampleAssignments = [
  {
    id: "ba-001",
    booking_id: "bk-detail-01",
    artist_id: "a1000000-0000-0000-0000-000000000001",
    lead: true,
    confirmed_at: null,
    created_at: "2026-06-03T10:00:00Z",
    artists: { name: "Zandeline", email: "zandeline@lustiqueco.co.za" },
  },
];

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const getReqDetail = (path: string, cookie?: string) => {
  const headers: HeadersInit = {};
  if (cookie) headers["Cookie"] = `${AUTH_COOKIE}=${cookie}`;
  return new Request(`https://worker${path}`, { headers });
};

describe("handleAdminBookingDetail — artist widget", () => {
  it("renders assigned artists section with lead badge", async () => {
    const token = await validAdminJwt();
    // URL-matching mock factory (avoids positional chaining fragility)
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(jsonRes(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(jsonRes([sampleBooking]));
      if (url.includes("/payments?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/rejections?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(jsonRes(sampleAssignments));
      if (url.includes("/artists?")) return Promise.resolve(jsonRes(sampleArtists));
      return Promise.resolve(jsonRes([]));
    });
    const res = await handleAdminBookingDetail(
      getReqDetail("/api/admin/booking/bk-detail-01", token),
      { ...env, BREVO_API_KEY: "x", NOTIFY_EMAIL: "x", ALLOWED_ORIGIN: "x", ADMIN_SECRET: "x", SIGNING_SECRET: "x", YOCO_SECRET_KEY: "x", YOCO_WEBHOOK_SECRET: "x", TURNSTILE_SECRET: "x", EFT_BANK: "", EFT_ACCOUNT_NAME: "", EFT_ACCOUNT_NO: "", EFT_BRANCH_CODE: "" },
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Artists");
    expect(html).toContain("Zandeline");
    expect(html).toContain("Lead");
  });

  it("renders assign form showing only unassigned artists", async () => {
    const token = await validAdminJwt();
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(jsonRes(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(jsonRes([sampleBooking]));
      if (url.includes("/payments?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/rejections?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(jsonRes(sampleAssignments));
      if (url.includes("/artists?")) return Promise.resolve(jsonRes(sampleArtists));
      return Promise.resolve(jsonRes([]));
    });
    const res = await handleAdminBookingDetail(
      getReqDetail("/api/admin/booking/bk-detail-01", token),
      { ...env, BREVO_API_KEY: "x", NOTIFY_EMAIL: "x", ALLOWED_ORIGIN: "x", ADMIN_SECRET: "x", SIGNING_SECRET: "x", YOCO_SECRET_KEY: "x", YOCO_WEBHOOK_SECRET: "x", TURNSTILE_SECRET: "x", EFT_BANK: "", EFT_ACCOUNT_NAME: "", EFT_ACCOUNT_NO: "", EFT_BRANCH_CODE: "" },
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    // Elria is unassigned — should appear in the assign form dropdown
    expect(html).toContain("Elria");
    // Zandeline is already assigned — should NOT appear in the assign dropdown
    // (she appears in the assignments table but not the assign <select>)
    expect(html).toContain('action="/api/admin/booking/bk-detail-01/artists"');
  });

  it("renders locked widget for deposit_paid booking", async () => {
    const token = await validAdminJwt();
    const depositBooking = { ...sampleBooking, status: "deposit_paid" };
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/profiles?")) return Promise.resolve(jsonRes(adminProfile));
      if (url.includes("/bookings?id=eq.bk-detail-01&select=id,reference")) return Promise.resolve(jsonRes([depositBooking]));
      if (url.includes("/payments?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/quote_revisions?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/rejections?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/booking_artists?")) return Promise.resolve(jsonRes([]));
      if (url.includes("/artists?")) return Promise.resolve(jsonRes(sampleArtists));
      return Promise.resolve(jsonRes([]));
    });
    const res = await handleAdminBookingDetail(
      getReqDetail("/api/admin/booking/bk-detail-01", token),
      { ...env, BREVO_API_KEY: "x", NOTIFY_EMAIL: "x", ALLOWED_ORIGIN: "x", ADMIN_SECRET: "x", SIGNING_SECRET: "x", YOCO_SECRET_KEY: "x", YOCO_WEBHOOK_SECRET: "x", TURNSTILE_SECRET: "x", EFT_BANK: "", EFT_ACCOUNT_NAME: "", EFT_ACCOUNT_NO: "", EFT_BRANCH_CODE: "" },
      "bk-detail-01",
      f as unknown as typeof fetch,
    );
    const html = await res.text();
    expect(html).toContain("Artist assignment locked");
  });
});
```

- [ ] **Step 2 — Run tests (expect FAIL — widget not yet rendered)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/dashboard-d4.test.ts 2>&1 | grep -E "(PASS|FAIL|Error)" | head -20
```

Expected: the new widget tests fail (widget section absent from HTML).

- [ ] **Step 3 — Implement the changes to `dashboard.ts`**

**3a. Add import at the top of `dashboard.ts` (after the existing imports, around line 14):**

```ts
import { listArtists, listBookingArtists, type ArtistRow, type BookingArtistRow } from "./artists";
```

**3b. In `handleAdminBookingDetail`, extend the parallel fetches and render the widget.**

The complete modified `handleAdminBookingDetail` function body (replace lines 584–773 of `dashboard.ts`):

```ts
/**
 * GET /api/admin/booking/:id — booking detail + inline quote editor + artist widget
 * POST /api/admin/quote/:id  — update total_cents, bump quote_revision
 */
export async function handleAdminBookingDetail(
  req: Request,
  env: DashboardEnv,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAuthEnvUser(req, env, fetchFn);
  if (!user) return loginRedirect();

  const hdr = supabaseHeaders(env);

  if (req.method === "POST") {
    // Parse the new total from the form
    let newTotalCents = 0;
    try {
      const fd = await req.formData();
      const raw = (fd.get("total_zar") as string | null) ?? "";
      newTotalCents = Math.round(parseFloat(raw.replace(/[^0-9.]/g, "")) * 100);
    } catch {
      return htmlResponse(`<p>Invalid form. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 400);
    }
    if (!newTotalCents || newTotalCents < 100) {
      return htmlResponse(`<p>Amount too low. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 400);
    }

    // Fetch current totals
    const cur = await fetchFn(
      supabaseUrl(env, `bookings?id=eq.${encodeURIComponent(id)}&select=total_cents,deposit_pct,deposit_net_cents,balance_net_cents`),
      { headers: hdr },
    );
    if (!cur.ok) return htmlResponse(`<p>Fetch error. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 502);
    const rows = (await cur.json()) as Array<{ total_cents: number; deposit_pct: number | null; deposit_net_cents: number; balance_net_cents: number }>;
    if (!rows.length) return htmlResponse(`<p>Not found. <a href="/api/admin/dashboard">Back</a></p>`, 404);
    const prev = rows[0]!;

    // Recalculate deposit/balance if deposit_pct is set (bride has chosen)
    let depositNetCents = prev.deposit_net_cents;
    let balanceNetCents = prev.balance_net_cents;
    if (prev.deposit_pct) {
      depositNetCents = Math.floor(newTotalCents * prev.deposit_pct / 100);
      balanceNetCents = newTotalCents - depositNetCents;
    } else {
      balanceNetCents = newTotalCents - depositNetCents;
    }

    // PATCH the booking
    const patch = await fetchFn(
      supabaseUrl(env, `bookings?id=eq.${encodeURIComponent(id)}`),
      {
        method: "PATCH",
        headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ total_cents: newTotalCents, deposit_net_cents: depositNetCents, balance_net_cents: balanceNetCents }),
      },
    );
    if (!patch.ok) return htmlResponse(`<p>Update failed. <a href="/api/admin/booking/${esc(id)}">Back</a></p>`, 502);

    // Record revision
    await fetchFn(supabaseUrl(env, "quote_revisions"), {
      method: "POST",
      headers: { ...hdr, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        booking_id: id,
        old_total_cents: prev.total_cents,
        new_total_cents: newTotalCents,
        revised_by: user.email,
      }),
    });

    return new Response(null, { status: 302, headers: { Location: `/api/admin/booking/${id}?saved=1` } });
  }

  // GET — fetch booking + related data (+ artists for widget)
  const artistsEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
    AUDIT: env.AUDIT,
  };

  const [bRes, pRes, qrRes, rjRes, allArtists, assignedArtists] = await Promise.all([
    fetchFn(
      supabaseUrl(
        env,
        `bookings?id=eq.${encodeURIComponent(id)}&select=id,reference,status,bride_name,bride_email,bride_phone,wedding_date,town,province,venue,party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents,occasion,quote_lines,created_at,quote_sent_at,accepted_at,rejected_at,invoice_expired_at,availability_conflict,notes`,
      ),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `payments?booking_id=eq.${encodeURIComponent(id)}&select=id,kind,status,net_cents,payable_cents,yoco_checkout_id,yoco_payment_id,pay_url,created_at,paid_at&order=created_at.asc`),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `quote_revisions?booking_id=eq.${encodeURIComponent(id)}&select=id,old_total_cents,new_total_cents,revised_by,created_at&order=created_at.desc`),
      { headers: hdr },
    ),
    fetchFn(
      supabaseUrl(env, `rejections?booking_id=eq.${encodeURIComponent(id)}&select=id,rejected_by,reason_code,reason_text,created_at&order=created_at.desc`),
      { headers: hdr },
    ),
    listArtists(artistsEnv, fetchFn).catch((): ArtistRow[] => []),
    listBookingArtists(artistsEnv, id, fetchFn).catch((): BookingArtistRow[] => []),
  ]);

  if (!bRes.ok) return htmlResponse(`<p>Fetch error. <a href="/api/admin/dashboard">Back</a></p>`, 502);
  const bookings = (await bRes.json()) as BookingDetail[];
  if (!bookings.length) return htmlResponse(adminShell("Not found", user, `<p>Booking not found.</p>`), 404);
  const b = bookings[0]!;
  const payments: PaymentRow[] = pRes.ok ? ((await pRes.json()) as PaymentRow[]) : [];
  const revisions: QuoteRevision[] = qrRes.ok ? ((await qrRes.json()) as QuoteRevision[]) : [];
  const rejections: RejectionRow[] = rjRes.ok ? ((await rjRes.json()) as RejectionRow[]) : [];

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";
  const errorMsg = url.searchParams.get("error");

  const quoteLines = (b.quote_lines || [])
    .map((l) => `<tr><td>${esc(l.label)}</td><td style="text-align:right;">${formatZAR(l.amount)}</td></tr>`)
    .join("\n");

  const paymentsHtml = payments.length
    ? `<table><thead><tr><th>Kind</th><th>Status</th><th>Net</th><th>Payable</th><th>Method</th><th>Paid at</th></tr></thead><tbody>
        ${payments.map((p) => `<tr>
          <td>${esc(p.kind)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${formatZAR(p.net_cents)}</td>
          <td>${formatZAR(p.payable_cents)}</td>
          <td>${p.yoco_payment_id ? "Yoco" : p.yoco_checkout_id ? "Yoco (pending)" : "EFT"}</td>
          <td>${fmtDateTime(p.paid_at)}</td>
        </tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No payments recorded.</p>`;

  const revisionsHtml = revisions.length
    ? `<table><thead><tr><th>Old total</th><th>New total</th><th>By</th><th>When</th></tr></thead><tbody>
        ${revisions.map((r) => `<tr><td>${formatZAR(r.old_total_cents)}</td><td>${formatZAR(r.new_total_cents)}</td><td>${esc(r.revised_by)}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No revisions.</p>`;

  const rejectionsHtml = rejections.length
    ? `<table><thead><tr><th>By</th><th>Code</th><th>Note</th><th>When</th></tr></thead><tbody>
        ${rejections.map((r) => `<tr><td>${esc(r.rejected_by)}</td><td>${esc(r.reason_code ?? "—")}</td><td>${esc(r.reason_text ?? "—")}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="empty">No rejections.</p>`;

  const editableStatuses = ["requested", "quote_sent"];
  const canEdit = editableStatuses.includes(b.status);
  const editForm = canEdit
    ? `<form method="POST" action="/api/admin/quote/${esc(id)}" style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;">
        <label style="font-size:.82rem;font-weight:700;color:#8a7d72;">New total (R)</label>
        <input name="total_zar" type="number" min="1" step="0.01" value="${(b.total_cents / 100).toFixed(2)}"
          style="width:140px;font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;" required>
        <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.4em 1em;cursor:pointer;">Save revision</button>
      </form>`
    : `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">Quote editing locked — status is <strong>${esc(b.status)}</strong>.</p>`;

  // ── Artist assignment widget ────────────────────────────────────────────────
  const canAssign = ARTIST_ASSIGNABLE_STATUSES.includes(b.status);

  const assignedIds = new Set(assignedArtists.map((a) => a.artist_id));

  const assignedRowsHtml = assignedArtists.length
    ? assignedArtists.map((a) => `
        <tr>
          <td>${esc(a.artists.name)}</td>
          <td><span class="badge" style="background:${a.lead ? "#e9d8fd" : "#ebf8ff"};color:${a.lead ? "#553c9a" : "#2b6cb0"};">${a.lead ? "Lead" : "Artist"}</span></td>
          <td>
            ${canAssign ? `<form method="POST" action="/api/admin/booking/${esc(id)}/artists/remove" style="display:inline;">
              <input type="hidden" name="artist_id" value="${esc(a.artist_id)}">
              <button type="submit" style="font:inherit;font-size:.8rem;font-weight:700;color:#c53030;background:none;border:1.5px solid #f5c6c6;border-radius:6px;padding:.2em .7em;cursor:pointer;">Remove</button>
            </form>` : ""}
          </td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty">No artists assigned.</td></tr>`;

  const unassignedArtists = allArtists.filter((a) => !assignedIds.has(a.id));

  const artistOptions = unassignedArtists
    .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
    .join("");

  const assignFormHtml = canAssign && unassignedArtists.length
    ? `<form method="POST" action="/api/admin/booking/${esc(id)}/artists" style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;flex-wrap:wrap;">
        <select name="artist_id" required style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;min-width:160px;">
          <option value="">Select artist…</option>
          ${artistOptions}
        </select>
        <select name="lead" style="font:inherit;border:1.5px solid #c9bfb8;border-radius:8px;padding:.4em .6em;">
          <option value="false">Artist</option>
          <option value="true">Lead</option>
        </select>
        <button type="submit" style="font:inherit;font-weight:700;background:#8a3a52;color:#fff;border:none;border-radius:8px;padding:.4em 1em;cursor:pointer;">Assign artist</button>
      </form>`
    : canAssign && !unassignedArtists.length
      ? `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">All artists are already assigned.</p>`
      : `<p style="font-size:.82rem;color:#8a7d72;margin-top:.5rem;">Artist assignment locked — status is <strong>${esc(b.status)}</strong>.</p>`;

  const artistsHtml = `
    <table><thead><tr><th>Artist</th><th>Role</th><th></th></tr></thead>
    <tbody>${assignedRowsHtml}</tbody></table>
    ${assignFormHtml}`;

  const inner = `
    ${saved ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;color:#276749;font-size:.88rem;">✓ Saved.</div>` : ""}
    ${errorMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#fff5f5;color:#c53030;font-size:.88rem;">Error: ${esc(errorMsg)}</div>` : ""}
    <a href="/api/admin/dashboard" style="font-size:.82rem;color:#8a3a52;">← Inbox</a>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:1rem;">
      <div>
        <h2>Bride</h2>
        <table><tbody>
          <tr><td style="color:#8a7d72;padding-right:1rem;">Name</td><td>${esc(b.bride_name)}</td></tr>
          <tr><td style="color:#8a7d72;">Email</td><td><a href="mailto:${esc(b.bride_email)}" style="color:#8a3a52;">${esc(b.bride_email)}</a></td></tr>
          <tr><td style="color:#8a7d72;">Phone</td><td>${esc(b.bride_phone)}</td></tr>
          <tr><td style="color:#8a7d72;">Wedding</td><td>${esc(b.wedding_date)}</td></tr>
          <tr><td style="color:#8a7d72;">Town</td><td>${esc(b.town ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Province</td><td>${esc(b.province ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Venue</td><td>${esc(b.venue ?? "—")}</td></tr>
          <tr><td style="color:#8a7d72;">Party</td><td>${b.party_size}</td></tr>
          <tr><td style="color:#8a7d72;">Occasion</td><td>${esc(b.occasion)}</td></tr>
        </tbody></table>
      </div>
      <div>
        <h2>Booking</h2>
        <table><tbody>
          <tr><td style="color:#8a7d72;padding-right:1rem;">Reference</td><td>${esc(b.reference)}</td></tr>
          <tr><td style="color:#8a7d72;">Status</td><td>${statusBadge(b.status)}${conflictFlag(b.availability_conflict)}</td></tr>
          <tr><td style="color:#8a7d72;">Requested</td><td>${fmtDateTime(b.created_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Quote sent</td><td>${fmtDateTime(b.quote_sent_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Accepted</td><td>${fmtDateTime(b.accepted_at)}</td></tr>
          <tr><td style="color:#8a7d72;">Deposit %</td><td>${b.deposit_pct != null ? `${b.deposit_pct}%` : "—"}</td></tr>
          <tr><td style="color:#8a7d72;">Total</td><td><strong>${formatZAR(b.total_cents)}</strong></td></tr>
          <tr><td style="color:#8a7d72;">Deposit</td><td>${formatZAR(b.deposit_net_cents)}</td></tr>
          <tr><td style="color:#8a7d72;">Balance</td><td>${formatZAR(b.balance_net_cents)}</td></tr>
        </tbody></table>
      </div>
    </div>
    <h2>Quote lines</h2>
    <table><thead><tr><th>Service</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${quoteLines || `<tr><td colspan="2" class="empty">—</td></tr>`}</tbody></table>
    <h2>Edit total</h2>
    ${editForm}
    <h2>Payments</h2>${paymentsHtml}
    <h2>Revisions</h2>${revisionsHtml}
    <h2>Rejections</h2>${rejectionsHtml}
    <h2>Artists</h2>${artistsHtml}
    ${b.notes ? `<h2>Notes</h2><p style="white-space:pre-wrap;">${esc(b.notes)}</p>` : ""}
  `;

  return htmlResponse(adminShell(`${b.reference} — Detail`, user, inner));
}
```

Also add the constant near the top of the function or just before `handleAdminBookingDetail` (after the `RejectionRow` interface, around line 578):

```ts
const ARTIST_ASSIGNABLE_STATUSES = ["quote_sent", "accepted"];
```

- [ ] **Step 4 — Run ALL tests (expect full suite passing)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/dashboard-d4.test.ts src/booking/dashboard-c2.test.ts 2>&1
```

Expected: all tests pass in both files.

- [ ] **Step 5 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add worker/src/booking/dashboard.ts worker/src/booking/dashboard-d4.test.ts
git commit -m "feat(worker): extend booking-detail with artist assignment widget (D4)"
```

---

## Task 4 — Register routes in `worker/src/index.ts`

**Files:**
- Modify: `worker/src/index.ts`
  - Add import for `handleAssignArtist`, `handleRemoveArtist` from `./booking/artists`
  - Add two POST route blocks in the JWT-gated section

**Interfaces:**

Consumes:
- `handleAssignArtist(req, dashEnv, id, fetch?)` from `./booking/artists`
- `handleRemoveArtist(req, dashEnv, id, fetch?)` from `./booking/artists`
- Existing `dashEnv` constructed at line ~265

Produces:
- Two new routed POST endpoints

### Steps

- [ ] **Step 1 — Write a failing smoke-test check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
grep -n "handleAssignArtist" src/index.ts
```

Expected: no output (not yet imported).

- [ ] **Step 2 — Add the import to `index.ts`**

After the existing dashboard import block (around line 29), add:

```ts
import { handleAssignArtist, handleRemoveArtist } from "./booking/artists";
```

- [ ] **Step 3 — Add the route blocks to `index.ts`**

After the existing `/api/admin/booking/:id` GET block (around line 291 in the JWT-gated section), add:

```ts
      // POST /api/admin/booking/:id/artists — assign artist to booking (D4)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/artists".length);
        if (id) return await handleAssignArtist(req, dashEnv, id);
      }
      // POST /api/admin/booking/:id/artists/remove — remove artist from booking (D4)
      if (req.method === "POST" && url.pathname.startsWith("/api/admin/booking/") && url.pathname.endsWith("/artists/remove")) {
        const id = url.pathname.slice("/api/admin/booking/".length, -"/artists/remove".length);
        if (id) return await handleRemoveArtist(req, dashEnv, id);
      }
```

**Important placement note:** these two blocks must appear **before** the generic `/api/admin/booking/:id` GET handler to avoid the `/artists` suffix being consumed as a booking ID. In practice the GET handler already checks `req.method === "GET"`, so order is safe, but placing them immediately after the existing GET booking block is cleaner.

- [ ] **Step 4 — TypeScript build check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 5 — Run full test suite**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass; no regressions in existing suites.

- [ ] **Step 6 — Commit**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add worker/src/index.ts
git commit -m "feat(worker): register assign/remove-artist routes in index.ts (D4)"
```

---

## Task 5 — Apply migration to Supabase + smoke-test

**Files:**
- Read-only verification: `supabase/migrations/0013_artists.sql`

### Steps

- [ ] **Step 1 — Apply migration via Supabase CLI (Pieter's terminal)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
supabase db push
```

Expected: migration `0013_artists.sql` listed as applied; no errors.

- [ ] **Step 2 — Verify artists table exists and has 9 rows**

```bash
supabase db execute --sql "SELECT id, name, email, active FROM artists ORDER BY name;"
```

Expected: 9 rows — Elria, Jana, Janeke, Maroné, Marize, Monique, René, Samantha, Zandeline.

- [ ] **Step 3 — Verify FK re-point**

```bash
supabase db execute --sql "SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name FROM information_schema.referential_constraints JOIN information_schema.key_column_usage USING (constraint_name) WHERE table_name = 'booking_artists' AND column_name = 'artist_id';"
```

Expected: `booking_artists_artist_id_fkey` referencing `artists(id)` (not `profiles(id)`).

- [ ] **Step 4 — Deploy Worker**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx wrangler deploy
```

Expected: deployment succeeds; Worker URL printed.

- [ ] **Step 5 — Manual smoke-test (browser)**

1. Log in to the admin dashboard at `https://<worker-subdomain>/api/admin/login`.
2. Open any `quote_sent` booking.
3. Verify the **Artists** section appears at the bottom of the booking detail.
4. Assign "Elria" as "Lead" — expect redirect back with "✓ Saved." banner.
5. Assign "Jana" as "Artist" — expect Elria (Lead) and Jana (Artist) in the table.
6. Remove Jana — expect table returns to Elria only.
7. Open a `deposit_paid` booking — verify "Artist assignment locked" message appears.

- [ ] **Step 6 — Commit smoke-test confirmation note**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique"
git add -p   # confirm no unintended files
git commit -m "chore: D4 smoke-test passed — artist allocation live"
```

---

## Pieter / One-Time Setup

1. **Collect real artist emails from Zandeline.** The migration seeds placeholder emails (`firstname@lustiqueco.co.za`). Once Zandeline provides real emails, run:
   ```sql
   UPDATE artists SET email = 'actual@email.com' WHERE name = 'Zandeline';
   -- repeat for each artist
   ```
   Or provide a small update migration `0014_artist_emails.sql` once emails are confirmed.

2. **Email addresses must be unique** if you later add a UNIQUE constraint on `artists.email`. Do not add that constraint until real emails are known — some artists may share a domain inbox today.

3. **Supabase free tier — no branching.** Apply `0013_artists.sql` directly to the production project via `supabase db push` (Pieter's terminal, not the sandbox). Confirm the Artist Supabase project ref before running.

4. **Wave D2 calendar integration.** When D2 is built, the calendar handler will query `booking_artists?booking_id=eq.{id}&select=artist_id,artists(name,email)` using PostgREST resource embedding. The `artists` table created in D4 is the prerequisite for that query. No D4 code changes are needed for D2.

5. **`AUDIT` R2 binding** must be configured in `wrangler.toml` for both local dev and production. Confirm the R2 bucket name matches the `AUDIT` binding; D4 uses the same `writeAudit` path as all prior waves.

---

## Self-Review — Spec Coverage

| Requirement | Task covering it |
|---|---|
| Dedicated `artists` table (no `auth.users` writes) | Task 1 (migration) |
| RLS mirrors `booking_artists` admin-read + service-role-write family | Task 1 (migration §1) |
| Seed 9 artists with correct names from `team.ts` | Task 1 (migration §2) |
| FK re-point `booking_artists.artist_id → artists(id)` | Task 1 (migration §3) |
| Migration number `0013` | Task 1 |
| No circular import (`artists.ts` does not import from `dashboard.ts`) | Task 2 (local `ArtistsHandlerEnv`) |
| `listArtists` / `listBookingArtists` query `artists` table (not `profiles`) | Task 2 |
| PostgREST order by `lead.desc`; TypeScript sort by name | Task 2 (test asserting order) |
| Test asserting lead-first then alphabetical sort | Task 2 (Step 1 test `listBookingArtists`) |
| `jsonError` helper uses `corsHeaders + secHeaderMap({ html: false })` | Task 2 (handlers use redirect not JSON error; no bare JSON error responses in these handlers) |
| HTML responses go through `htmlResponse` / `withSec` | Task 3 (widget renders inside existing `htmlResponse(adminShell(...))`) |
| URL-matching fetch mock factory in integration test | Task 3 (Step 1 test) |
| Complete `handleAdminBookingDetail` function body shown | Task 3 (Step 3) |
| Import at top of test file | Task 2 (Step 1 — `import { handleAssignArtist, handleRemoveArtist, listArtists, listBookingArtists }` at top) |
| Assignment guard: `quote_sent` or `accepted` only | Task 2 (Step 3 implementation + guard test) |
| `lead boolean` used (not `role TEXT`) | Task 2 (implementation + migration) |
| Audit on every mutation | Task 2 (both handlers call `writeAudit`) |
| Calendar D2 dependency documented | Architecture Decisions §8 + Pieter actions §4 |
| Artist login out of scope | Architecture Decisions §9 |
| No `auth.users` INSERT logic | Architecture Decisions §1 + Task 1 |
| Pieter action: collect real artist emails | Pieter actions §1 |
| `ARTIST_ASSIGNABLE_STATUSES` constant for guard | Task 3 (Step 3) |
| Widget locked for non-assignable statuses | Task 3 (Step 1 test + Step 3 implementation) |
| All artist names XSS-escaped in widget | Task 3 (all `esc()` calls in widget HTML) |
| Route registration in `index.ts` | Task 4 |
| TypeScript build check | Task 4 (Step 4) |
| Full regression suite run | Task 4 (Step 5) |
| Migration applied + FK verified + Worker deployed | Task 5 |
