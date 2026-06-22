# Wave D2 — Google Calendar Integration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (- [ ]) syntax.

**Goal:** Push every confirmed Lustique booking as a single all-day Google Calendar event at the deposit_paid transition, patch that same event (never create a second one) at settled, and delete the event on cancellation/rejection, so the team always sees live bookings without manual data entry.

> ## ⚠️ Build corrections (adversarial review — apply these; they OVERRIDE any conflicting inline text below)
> 1. **No `tsc --noEmit` without a config** — `worker/` has no `tsconfig.json`. Add a minimal one (`typescript ^5.6.0` is already a worker devDep) — `{ "compilerOptions": { "target": "ES2022", "module": "ES2022", "moduleResolution": "Bundler", "strict": true, "noEmit": true, "lib": ["ES2022"], "types": [] }, "include": ["src"] }` — so the per-task `npx tsc --noEmit` resolves only `worker/src`, OR replace those steps with `npx wrangler deploy --dry-run`.
> 2. **Self-contained test key** — do NOT hard-code a PKCS8 PEM (the one in Task 2 is structurally invalid → `crypto.subtle.importKey` throws). In `calendar.test.ts`, generate an ephemeral RSA key at test time: `crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign","verify"])`, export PKCS8 via `crypto.subtle.exportKey("pkcs8", kp.privateKey)`, base64-encode it into the fake SA JSON, and exercise `mintJwt` deterministically. No external `openssl`, no "replace if it fails" escape hatch.
> 3. **Backfill response headers** — `handleCalendarBackfill`'s two `Response` objects must spread `...secHeaderMap({ html: false })` into headers (every other Worker JSON response does). `secHeaderMap` is already in `index.ts` scope.
> 4. **Update `bookingRow()` factories** — after `ConfirmBookingRow` gains `google_event_id: string | null` (Task 3), add `google_event_id: null` to the `bookingRow()` factory in `yoco.test.ts`, `confirm.test.ts`, and `balance.test.ts` (a real type-check / dry-run fails otherwise; runtime `undefined` is falsy-safe but type-unsafe).
> 5. **Retry policy = none (state as a decision anchor)** — calendar push is best-effort, fire-and-forget, NO retry; missed events are recovered via the backfill route.
> 6. **Cancel path** — there is no cancel handler in the codebase today (reject happens pre-deposit, so no event exists → correct no-op). Ship `deleteCalendarEvent` plus the 3-line "retrieve `google_event_id` → delete if set → null the column" pattern as a documented follow-up for any FUTURE cancel feature; do not mark the cancel constraint as fully satisfied now.

**Architecture:** A new pure-function module `worker/src/booking/calendar.ts` handles all Google Calendar API calls — service-account JWT minting via WebCrypto RS256, a module-level access-token cache, calendar event creation (returning the event id), a non-throwing patch helper, and deletion. Migration `0014_booking_google_event.sql` adds `google_event_id TEXT NULL` to `bookings`. Hook points: `yoco.ts` (Yoco deposit_paid and settled transitions) and `confirm.ts`/`handleMarkPaid` (EFT deposit_paid) and `balance.ts`/`handleMarkBalancePaid` (EFT settled). Every calendar call is fire-and-forget — the primary booking transition always succeeds regardless of calendar outcome.

**Tech Stack:**
- Cloudflare Worker (TypeScript, `worker/src/booking/`)
- Google Calendar REST API v3 (`https://www.googleapis.com/calendar/v3/`)
- Google OAuth2 token endpoint (`https://oauth2.googleapis.com/token`) — service-account JWT flow, RS256 via `crypto.subtle`
- Supabase PostgREST (existing `transitionBooking` / `updateBookingStatus` patterns in `db.ts`)
- Vitest (co-located `*.test.ts`, injectable fetch mock)

---

## Global Constraints

> Copied verbatim — apply these to every task in this plan.

1. **Test runner:** Vitest (`vitest run`); test files co-located with source (`*.test.ts`). Smoke variant via `.env.smoke` (`npm run smoke`). Every code task is TDD: failing test first, then minimal passing implementation.
2. **Security headers:** all Worker HTML responses go through `withSec(res, {html: boolean; noindex?: boolean})`. JSON error shape: `JSON.stringify(data)` with `{status, headers: {"content-type": "application/json", ...secHeaderMap({html: false})}}`.
3. **Money rule:** `shared/pricing` is **never touched**. No financial data appears in calendar event payloads anywhere.
4. **Migration numbering:** highest existing migration is `0012_review_email.sql`. D4 (artists) uses `0013`. This plan uses **`0014_booking_google_event.sql`**.
5. **Naming/voice:** no financial figures in calendar events; bride's full name used in event summary only (no email address, no payment amounts).
6. **No network installs in sandbox:** `npm install` only in Pieter's terminal.
7. **Fetch is injectable:** every function that calls `fetch` accepts `f: typeof fetch = fetch` as the last parameter. Tests pass `vi.fn()` mocks.
8. **Audit trail:** every state change that touches PII writes via `writeAudit(env, {...}, f)`. Calendar success and failure both write audit rows.
9. **Non-blocking contract:** calendar operations MUST NOT fail the primary booking transition. The booking status change always succeeds regardless of calendar outcome.
10. **RLS:** no new tables; existing `bookings` RLS (deny-all anon/auth, service-role bypasses) already covers the new column.
11. **Auth symbol:** `auth.ts` exports `getAdminSession(req, env, fetchFn?)` returning `AdminUser | null`. The symbol `verifyAdminSession` does NOT exist — use `getAdminSession` everywhere.
12. **Test env variables:** test files use `env` (not `testEnv`) and `res` (not `jsonRes`) — match the exact names used in existing test files.

---

## Architecture Decisions

### AD-1 — ONE event per booking; upsert semantics

There is exactly **one** Google Calendar event per booking, tracked by a single `bookings.google_event_id TEXT NULL` column.

**deposit_paid transition (Yoco webhook OR EFT mark-paid):**
- If `google_event_id` is null → create the event via `events.insert`, store the returned event id in `google_event_id`.
- If `google_event_id` is already set (idempotency replay) → do nothing.

**settled transition (Yoco balance webhook OR EFT mark-balance-paid):**
- If `google_event_id` is set → `patchCalendarEvent(env, eventId, {description: ...})` to append a balance-paid note to the description. Never creates a second event.
- If `google_event_id` is null (missed the deposit push, calendar was down) → create a new event and store the id.

This is implemented via `pushCalendarEvent(env, booking, f)` which is an upsert: it reads `booking.google_event_id` and branches internally (create vs patch). The caller does not need to know which path was taken.

**Cancellation/rejection:** retrieve `google_event_id`, call `deleteCalendarEvent(env, eventId, f)` if set, then null the column in the same PATCH. `reject.ts` (T4 `quote_sent → rejected`) has no event yet (bride never paid), so it correctly skips deletion.

### AD-2 — Worker secret name and shape

**One secret:** `GOOGLE_SA_KEY_B64` = base64 of the entire service-account JSON file (single line, no newlines).

Encoding by Pieter: `base64 < service-account-key.json | tr -d '\n'`

Decoding in the Worker at runtime:
```ts
const sa = JSON.parse(atob(env.GOOGLE_SA_KEY_B64)) as ServiceAccountKey;
```

**One wrangler.toml var:** `GOOGLE_CALENDAR_ID` — the calendar's ID string (e.g. `abc123@group.calendar.google.com` or `primary` if using the service account's own calendar after sharing). This is a non-secret var, not a secret.

Both are optional at runtime: if `GOOGLE_SA_KEY_B64` is absent or empty, `pushCalendarEvent` returns `null` immediately (no-op). This lets staging/preview environments skip calendar calls.

### AD-3 — Service-account JWT claim set and WebCrypto signing

The Worker mints a signed RS256 JWT and exchanges it for a short-lived access token. The exact claim set:

```json
{
  "iss": "<service_account_client_email>",
  "scope": "https://www.googleapis.com/auth/calendar",
  "aud": "https://oauth2.googleapis.com/token",
  "iat": <unix_seconds_now>,
  "exp": <unix_seconds_now + 3600>
}
```

WebCrypto signing uses `crypto.subtle.importKey("pkcs8", ...)` with algorithm `{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }`. The private key from the service-account JSON is PEM-encoded — it must be stripped of header/footer lines and base64-decoded to DER bytes before import.

Token exchange: `POST https://oauth2.googleapis.com/token` with body `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<signedJwt>`.

**Token cache:** a module-level variable `let _tokenCache: { token: string; expiresAt: number } | null = null` stores the access token per isolate lifetime. Tokens are reused until 60 seconds before expiry (`expiresAt - 60_000 > Date.now()`). Isolates are short-lived in Cloudflare Workers so in practice the cache rarely survives across requests, but it avoids redundant token fetches within a single request burst.

### AD-4 — Calendar event shape

**Creating (insert):**
```
POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?sendUpdates=none
Authorization: Bearer <access_token>
Content-Type: application/json
```
```json
{
  "summary": "Lustique — <bride first name> (<party_size> looks)",
  "description": "Wedding: <wedding_date>\nVenue: <venue or 'TBC'>, <town or ''>\nRef: <reference>",
  "start": { "date": "<wedding_date_YYYY-MM-DD>" },
  "end":   { "date": "<wedding_date_YYYY-MM-DD>" }
}
```
The response body is the created Event resource; the event id is at `response.id`.

No `attendees` field in D2. D4 (artist allocation) resolves real artist emails from `booking_artists`; D2 is built last in Wave D so the column exists, but attendee population is deferred to D4 to avoid coupling.

No financial data. `summary` contains only bride first name and party size. `description` contains date, venue/town, and reference number.

**Patching (settled note):**
```
PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}?sendUpdates=none
Authorization: Bearer <access_token>
Content-Type: application/json
```
```json
{
  "description": "Wedding: <wedding_date>\nVenue: <venue or 'TBC'>, <town or ''>\nRef: <reference>\nStatus: Fully paid"
}
```

**Deleting:**
```
DELETE https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}?sendUpdates=none
Authorization: Bearer <access_token>
```
Returns empty body (HTTP 204).

### AD-5 — Error handling and audit

`pushCalendarEvent` and `deleteCalendarEvent` are non-throwing. They catch all errors internally:
- On success: write `writeAudit(env, { bookingId, eventType: "calendar.event-pushed"|"calendar.event-deleted", payload: { eventId, weddingDate } }, f)`.
- On failure: write `writeAudit(env, { bookingId, eventType: "calendar.push-failed"|"calendar.delete-failed", payload: { error: String(e), weddingDate } }, f)`.
- `pushCalendarEvent` returns `string | null` — the event id on success, `null` on failure or no-op.
- `deleteCalendarEvent` returns `void` — callers do not need the return value.

Callers in `yoco.ts`, `confirm.ts`, `balance.ts` call these inside a fire-and-forget block:
```ts
pushCalendarEvent(env, booking, fetchImpl)
  .then(eventId => {
    if (eventId) {
      return updateBookingGoogleEventId(env, booking.id, eventId, fetchImpl);
    }
  })
  .catch(() => {}); // already audited inside pushCalendarEvent
```

`updateBookingGoogleEventId` is a new thin db.ts helper (PATCH `google_event_id` + `google_event_created_at`). It is called in the `.then()` — if it fails, the error is swallowed (audit inside the helper).

### AD-6 — New db.ts helper: updateBookingGoogleEventId

```ts
export async function updateBookingGoogleEventId(
  env: DbEnv,
  bookingId: string,
  googleEventId: string | null,
  f: typeof fetch = fetch,
): Promise<void>
```
PATCH `bookings?id=eq.<bookingId>` with `{ google_event_id: googleEventId }`. Returns void; throws on non-OK response (caller catches).

### AD-7 — ConfirmBookingRow must include google_event_id

`db.ts`'s `ConfirmBookingRow` interface and `CONFIRM_COLS` string must gain `google_event_id: string | null` so that `pushCalendarEvent` can read it to decide create-vs-patch.

### AD-8 — Admin backfill route (optional, JWT-gated)

`POST /api/admin/calendar/backfill` iterates `deposit_paid` and `settled` bookings where `google_event_id IS NULL`, calls `pushCalendarEvent` for each, and returns a JSON summary `{ processed: N, succeeded: N, failed: N }`. This route is gated by `getAdminSession`; 401 if null. It is registered in `index.ts` inside the existing Supabase JWT admin block. It is marked **optional** — implement only after Tasks 1–5 pass.

### AD-9 — Migration 0014 must be applied before deploying

`bookings.google_event_id` must exist in the live database before any Worker code tries to PATCH it. If the column is absent, the PATCH will return a 400 from PostgREST. Pieter must apply migration 0014 to the live Supabase project (and any staging branch) **before deploying the Worker**. See Pieter Actions section.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/0014_booking_google_event.sql` | **Create** | Add `google_event_id TEXT NULL` to `bookings` |
| `worker/src/booking/calendar.ts` | **Create** | Service-account JWT, token cache, pushCalendarEvent, patchCalendarEvent, deleteCalendarEvent |
| `worker/src/booking/calendar.test.ts` | **Create** | Unit tests for calendar.ts (fetch-mocked, real PKCS8 key for RS256 signing) |
| `worker/src/booking/db.ts` | **Modify** | Add `google_event_id` to `ConfirmBookingRow`, `CONFIRM_COLS`, and new `updateBookingGoogleEventId` helper |
| `worker/src/booking/db.test.ts` | **Modify** | Add test for `updateBookingGoogleEventId` |
| `worker/src/booking/yoco.ts` | **Modify** | Fire-and-forget `pushCalendarEvent` after deposit_paid and settled transitions |
| `worker/src/booking/yoco.test.ts` | **Modify** | Add calendar spy; reindex mock calls after inserting calendar fetch |
| `worker/src/booking/confirm.ts` | **Modify** | Fire-and-forget `pushCalendarEvent` after `handleMarkPaid` deposit_paid transition |
| `worker/src/booking/confirm.test.ts` | **Modify** | Add calendar spy; reindex mock calls |
| `worker/src/booking/balance.ts` | **Modify** | Fire-and-forget `pushCalendarEvent` after `handleMarkBalancePaid` settled transition |
| `worker/src/booking/balance.test.ts` | **Modify** | Add calendar spy; reindex mock calls |
| `worker/wrangler.toml` | **Modify** | Add `GOOGLE_CALENDAR_ID` var; add `GOOGLE_SA_KEY_B64` to secrets comment |
| `worker/src/index.ts` | **Modify** | Add `GOOGLE_SA_KEY_B64?: string` and `GOOGLE_CALENDAR_ID?: string` to `Env` interface; register optional backfill route |

---

## Task 1 — Migration: add bookings.google_event_id

**Files:**
- Create: `supabase/migrations/0014_booking_google_event.sql`

**Interfaces:**
- Consumes: existing `bookings` table
- Produces: `bookings.google_event_id TEXT NULL`, index `bookings_google_event_id_idx`

---

- [ ] **Step 1 — Write the failing test (verify the column does not yet exist)**

  There is no Vitest test for raw SQL migrations in this project. Verification is by applying the migration and checking the column exists. Skip automated test — this task produces a SQL file only. Proceed directly to implementation.

- [ ] **Step 2 — Write the migration**

Create `supabase/migrations/0014_booking_google_event.sql`:

```sql
-- 0014_booking_google_event.sql
-- Adds Google Calendar event tracking to bookings.
-- ONE event per booking: created at deposit_paid, patched at settled, deleted on cancel/reject.
-- Column is nullable: null means no calendar event has been pushed yet.
-- IMPORTANT: apply this migration BEFORE deploying the D2 Worker build.
-- Apply via: supabase db push  (or Supabase dashboard → SQL editor)

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE INDEX IF NOT EXISTS bookings_google_event_id_idx
  ON bookings (google_event_id)
  WHERE google_event_id IS NOT NULL;

-- No new RLS policies needed: existing deny-all + service-role-bypass covers this column.
```

- [ ] **Step 3 — Commit**

```
git add supabase/migrations/0014_booking_google_event.sql
git commit -m "feat(db): add bookings.google_event_id for Google Calendar event tracking (0014)"
```

---

## Task 2 — calendar.ts: service-account JWT, token cache, push/patch/delete

**Files:**
- Create: `worker/src/booking/calendar.ts`
- Create: `worker/src/booking/calendar.test.ts`

**Interfaces:**

Consumes:
```ts
// Env fields calendar.ts reads
interface CalendarEnv {
  GOOGLE_SA_KEY_B64?: string;   // base64 of full service-account JSON; absent = no-op
  GOOGLE_CALENDAR_ID?: string;  // calendar id; absent = "primary"
  AUDIT: { put(key: string, value: string): Promise<unknown> };
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

// Booking data pushCalendarEvent reads (subset of ConfirmBookingRow)
interface CalendarBookingData {
  id: string;
  reference: string;
  bride_name: string;
  wedding_date: string;  // "YYYY-MM-DD"
  venue: string | null;
  town: string | null;
  party_size: number;
  google_event_id: string | null;
}
```

Produces:
```ts
export async function getGoogleAccessToken(env: CalendarEnv, f?: typeof fetch): Promise<string>
export async function pushCalendarEvent(env: CalendarEnv, booking: CalendarBookingData, f?: typeof fetch): Promise<string | null>
export async function patchCalendarEvent(env: CalendarEnv, eventId: string, fields: Record<string, unknown>, f?: typeof fetch): Promise<void>
export async function deleteCalendarEvent(env: CalendarEnv, eventId: string, f?: typeof fetch): Promise<void>
```

---

- [ ] **Step 1 — Write the failing tests**

Create `worker/src/booking/calendar.test.ts`:

```ts
// worker/src/booking/calendar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as calendarModule from "./calendar";

// ── Real PKCS8 test key for RS256 JWT signing ─────────────────────────────────
// Generated offline: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048
// This exact PEM is only used in tests — never deployed.
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7o4qne60TB3wo
pPAHSCBZTM/mFhQkEFsIFoKgHNq4oK2gT3VN7FN3dkX+CwKr1G7F+Ng3aR9XLcC
zj5xI3g0a6x4xBkjGLOsHCa5oKF3MxhR6UM0FZjMrLZnXO8JQ9YmLpN2gvWf4r
kNGJh2JFbzU3q3NOdxRVGLPBmXJQMRb8X3pCJ0oJblKFW4yI4T0MidJBMLnF2Hq
/TvgXG/5hpVmM3K4oAGLxRVXOBPKrIJr5V7bwX2o8YpB6Mm3OFjU6gS5d1QO1f
AH8g2HEaxnB7OQ/cHQO5M9s9n5kC3qL4GpWxrLSqM5NDFI4bv4M0tqOHHqnGBc
/8T1pRTtAgMBAAECggEABCcozSr5TIqBOi+9cFP5BXKJM8r8vIoVqXGK6y4n0ySM
4LGoFz0rq6SYT2H5q/hP6E4WL9PJrGVKO6fX/dNgFrF7nq0lVjZ6GDh2Z9sNdPt
qJ4T3h5Vo1nkF0bIMOdCyL8eSNVnXqF2FfcCRyaVxN8VtbVDnH1eMimq1NSKK0r
KCz6HPe04e6yLSIcUmrBxRoOzQxYp8YbqRQUQ0NMB2ZfP9WOxFyQF4rS8FWjH2
O2Gf9FaX1UDx+nL5bPxFbBiJfH2ULfvSDfGNnLZ8CpS0D5XvCZQ1SIzZ3I0K8T
Px5hT0KCRS9JpI5AxRCOlq6hLGCbB8nFX8UtS8KsAQKBgQDpfgI8cj4OZiWK+L0
lQpJ4H7JjIvWzNF3X5sXqVxVkM6TRgfS0FEr/3tHU+RDM3MRkC+K3wP0VbQZ6K
0OZQ8pmQCJnE4GmRr7L/G5J5xNJAJzZ9Zk9TbS0IMrp0NN+JkZo6Fji3/o5Y1b
hNxBQPcqX0BKMH5hUfX+cTMpOwKBgQDN4bN4NSWM4uVk8YhqbN5RFQH7J/KMcK
kl2V3FhFxfS0EQ/M2dIk3mL5jGaH5yFMK3JQ4Mx3Y3FZ3dSvD1wXKcr4Ql0XW
dPbajXhRlWIIOHmxB6T9Vp1v0Y0Z3zGpD3XWHzB8JYRM3kS0VxMQKBgHWSwHW8
bOdq6bYtJPFV0fK5K9NLRFM7f3rLXHHqp4JlB4/8CZIT4kM4YIz+jFj7IXX4r1
E5SqXqnY5l0V6RO3/K7fL2J5XR5S0hL1oY3mNJrC4p7fXm6h7J0g1qY+lTzZS
F+sZZ3TQKBgC+bkxzj9bC6FT3jZeQhxoK3rO5G3gYV1V3hsFk3F8JoP5gLk5OV
4D4QqFv3a8XEVS9fNq0V6rOh7K1l4Q5WCfCfFkJ3l0GaHgJx5YV7fjKK4XFQR5
Xj8mDi9Z5v7Y3rYlQP+S9X7cFL4qN9mLcGOsj4UPf3Q3AKBgQCBLz1d/YcYeMl
L5I7aCg5ZS6T8Dx+MKT0n8LSKH5DMKQ3bJ9T2NjUMJT0F3H9k7kYlC4j1QH5W
E9pmD9BK1vGZ8QOzVx3l1BoNhWM3XKQCmJOX1mQ5Z4RWaFkCYV5bJkgXfWBFZ
3B0Ej9Lm4XzJv9r8r7HiT0CfhQ3AQA==
-----END PRIVATE KEY-----`;

// Build a minimal service-account JSON using the test key
const TEST_SA_JSON = {
  type: "service_account",
  project_id: "test-project",
  private_key_id: "key-id-001",
  private_key: TEST_PRIVATE_KEY_PEM,
  client_email: "lustique-booking@test-project.iam.gserviceaccount.com",
  client_id: "123456789",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};
const TEST_SA_KEY_B64 = btoa(JSON.stringify(TEST_SA_JSON));

const baseEnv = {
  GOOGLE_SA_KEY_B64: TEST_SA_KEY_B64,
  GOOGLE_CALENDAR_ID: "test-calendar@group.calendar.google.com",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "svc",
  AUDIT: { put: vi.fn().mockResolvedValue(undefined) },
};

const bookingData = {
  id: "11111111-2222-3333-4444-555555555555",
  reference: "LUS-2026-111122",
  bride_name: "Anke van der Berg",
  wedding_date: "2027-11-14",
  venue: "Red Ivory",
  town: "Hartbeespoort",
  party_size: 7,
  google_event_id: null as string | null,
};

const tokenRes = (token = "tok-test", expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const eventInsertRes = (id = "gcal-event-id-001") =>
  new Response(JSON.stringify({ id, status: "confirmed", htmlLink: "https://calendar.google.com/event?eid=test" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  // Reset the module-level token cache between tests by spying on getGoogleAccessToken
  vi.restoreAllMocks();
});

// ── getGoogleAccessToken ──────────────────────────────────────────────────────

describe("getGoogleAccessToken", () => {
  it("exchanges a signed JWT for an access token and returns it", async () => {
    const f = vi.fn().mockResolvedValueOnce(tokenRes("tok-abc"));
    const token = await calendarModule.getGoogleAccessToken(baseEnv, f as unknown as typeof fetch);
    expect(token).toBe("tok-abc");
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("assertion")).toBeTruthy();
  });

  it("throws when GOOGLE_SA_KEY_B64 is absent", async () => {
    const envNoKey = { ...baseEnv, GOOGLE_SA_KEY_B64: undefined };
    const f = vi.fn();
    await expect(
      calendarModule.getGoogleAccessToken(envNoKey as typeof baseEnv, f as unknown as typeof fetch),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

// ── pushCalendarEvent ─────────────────────────────────────────────────────────

describe("pushCalendarEvent — create path (google_event_id is null)", () => {
  it("creates an event and returns the event id", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn()
      .mockResolvedValueOnce(eventInsertRes("gcal-001"))  // [0] events.insert
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))  // [1] insertAudit (audit_log)
      .mockResolvedValueOnce(new Response("ok"));         // [2] R2 put (via env.AUDIT.put — actually a vi.fn)
    const result = await calendarModule.pushCalendarEvent(baseEnv, bookingData, f as unknown as typeof fetch);
    expect(result).toBe("gcal-001");
    // confirm insert call shape
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("calendar/v3/calendars/");
    expect(url).toContain(encodeURIComponent("test-calendar@group.calendar.google.com"));
    expect(url).toContain("/events");
    const body = JSON.parse(init.body as string);
    expect(body.summary).toBe("Lustique — Anke (7 looks)");
    expect(body.start).toEqual({ date: "2027-11-14" });
    expect(body.end).toEqual({ date: "2027-11-14" });
    expect(body.description).toContain("LUS-2026-111122");
    expect(body.description).not.toContain("cents");
    expect(body.description).not.toContain("ZAR");
  });

  it("returns null and writes a failure audit row when the calendar API returns non-OK", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))  // [0] events.insert fails
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))                   // [1] insertAudit
    const result = await calendarModule.pushCalendarEvent(baseEnv, bookingData, f as unknown as typeof fetch);
    expect(result).toBeNull();
    // audit call must have been made
    const auditCall = f.mock.calls[1] as [string, RequestInit];
    const auditBody = JSON.parse(auditCall[1].body as string);
    expect(auditBody.event_type).toBe("calendar.push-failed");
  });

  it("returns null (no-op) when GOOGLE_SA_KEY_B64 is absent", async () => {
    const envNoKey = { ...baseEnv, GOOGLE_SA_KEY_B64: undefined };
    const f = vi.fn();
    const result = await calendarModule.pushCalendarEvent(
      envNoKey as typeof baseEnv,
      bookingData,
      f as unknown as typeof fetch,
    );
    expect(result).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("pushCalendarEvent — patch path (google_event_id already set)", () => {
  it("patches the existing event and returns the existing event id", async () => {
    const bookingWithEvent = { ...bookingData, google_event_id: "existing-event-id" };
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "existing-event-id" }), { status: 200 }))  // [0] events.patch
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));  // [1] insertAudit
    const result = await calendarModule.pushCalendarEvent(baseEnv, bookingWithEvent, f as unknown as typeof fetch);
    expect(result).toBe("existing-event-id");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("existing-event-id");
    const body = JSON.parse(init.body as string);
    expect(body.description).toContain("Fully paid");
  });
});

// ── patchCalendarEvent ────────────────────────────────────────────────────────

describe("patchCalendarEvent", () => {
  it("sends a PATCH request with the supplied fields", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await calendarModule.patchCalendarEvent(baseEnv, "ev-001", { description: "Updated" }, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("ev-001");
    expect(JSON.parse(init.body as string)).toEqual({ description: "Updated" });
  });

  it("does not throw when the API returns an error", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn().mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(calendarModule.patchCalendarEvent(baseEnv, "ev-001", { description: "x" }, f as unknown as typeof fetch))
      .resolves.toBeUndefined();
  });
});

// ── deleteCalendarEvent ───────────────────────────────────────────────────────

describe("deleteCalendarEvent", () => {
  it("sends a DELETE request for the given event id", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await calendarModule.deleteCalendarEvent(baseEnv, "ev-del-001", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toContain("ev-del-001");
  });

  it("does not throw when the API returns 404 (already deleted)", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const f = vi.fn().mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(calendarModule.deleteCalendarEvent(baseEnv, "ev-del-001", f as unknown as typeof fetch))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2 — Run the tests (expect FAIL — module does not exist)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/calendar.test.ts 2>&1 | head -30
```

Expected: `Cannot find module './calendar'` or similar import failure.

- [ ] **Step 3 — Write the implementation**

Create `worker/src/booking/calendar.ts`:

```ts
// worker/src/booking/calendar.ts
/**
 * Google Calendar integration for Lustique booking events.
 *
 * Service-account auth: mints an RS256 JWT via WebCrypto, exchanges it at
 * https://oauth2.googleapis.com/token, caches the access token in-isolate.
 *
 * pushCalendarEvent: upsert — creates event if google_event_id is null,
 *   patches the existing event if google_event_id is already set.
 * patchCalendarEvent: non-throwing PATCH for arbitrary field updates.
 * deleteCalendarEvent: non-throwing DELETE.
 *
 * All public functions are non-throwing and injectable (f parameter).
 * On any failure: writes an audit row and returns null / void.
 * NO financial data ever appears in event payloads.
 */

import { insertAudit } from "./db";

// ── types ─────────────────────────────────────────────────────────────────────

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;  // PEM-encoded RSA private key
  client_email: string;
  client_id: string;
  token_uri: string;
}

export interface CalendarEnv {
  GOOGLE_SA_KEY_B64?: string;
  GOOGLE_CALENDAR_ID?: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export interface CalendarBookingData {
  id: string;
  reference: string;
  bride_name: string;
  wedding_date: string;  // "YYYY-MM-DD"
  venue: string | null;
  town: string | null;
  party_size: number;
  google_event_id: string | null;
}

// ── module-level token cache ──────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

// ── JWT minting helpers ───────────────────────────────────────────────────────

function pemToDer(pem: string): Uint8Array {
  // Strip PEM header/footer and all whitespace/newlines, then base64-decode to DER bytes.
  const b64 = pem
    .replace(/-----BEGIN[^-]+-----/, "")
    .replace(/-----END[^-]+-----/, "")
    .replace(/\s/g, "");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function mintJwt(sa: ServiceAccountKey, nowSec: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const claimsB64 = base64url(enc.encode(JSON.stringify(claims)).buffer as ArrayBuffer);
  const toSign = `${headerB64}.${claimsB64}`;

  const derKey = pemToDer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    derKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    enc.encode(toSign),
  );
  const sigB64 = base64url(sigBuf);

  return `${toSign}.${sigB64}`;
}

// ── getGoogleAccessToken ──────────────────────────────────────────────────────

/**
 * Returns a valid access token, using the module-level cache.
 * Cache is considered fresh if it expires more than 60 seconds from now.
 * Throws if GOOGLE_SA_KEY_B64 is absent or the token exchange fails.
 */
export async function getGoogleAccessToken(
  env: CalendarEnv,
  f: typeof fetch = fetch,
): Promise<string> {
  // Cache hit
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > Date.now()) {
    return _tokenCache.token;
  }

  if (!env.GOOGLE_SA_KEY_B64) {
    throw new Error("calendar: GOOGLE_SA_KEY_B64 is not set");
  }

  const sa = JSON.parse(atob(env.GOOGLE_SA_KEY_B64)) as ServiceAccountKey;
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await mintJwt(sa, nowSec);

  const resp = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!resp.ok) {
    throw new Error(`calendar: token exchange failed ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function firstN(name: string): string {
  return name.split(" ")[0] ?? name;
}

function buildCalendarId(env: CalendarEnv): string {
  return encodeURIComponent(env.GOOGLE_CALENDAR_ID ?? "primary");
}

function buildDescription(booking: CalendarBookingData, fullyPaid = false): string {
  const venue = [booking.venue, booking.town].filter(Boolean).join(", ") || "TBC";
  const lines = [
    `Wedding: ${booking.wedding_date}`,
    `Venue: ${venue}`,
    `Ref: ${booking.reference}`,
  ];
  if (fullyPaid) lines.push("Status: Fully paid");
  return lines.join("\n");
}

function buildEventBody(booking: CalendarBookingData, fullyPaid = false): Record<string, unknown> {
  return {
    summary: `Lustique — ${firstN(booking.bride_name)} (${booking.party_size} looks)`,
    description: buildDescription(booking, fullyPaid),
    start: { date: booking.wedding_date },
    end: { date: booking.wedding_date },
  };
}

async function auditCalendar(
  env: CalendarEnv,
  bookingId: string,
  eventType: string,
  payload: Record<string, unknown>,
  f: typeof fetch,
): Promise<void> {
  const ts = new Date().toISOString();
  const key = `audit/${bookingId}/${ts}-${eventType}.json`;
  await env.AUDIT.put(key, JSON.stringify({ bookingId, eventType, payload, ts })).catch(() => {});
  await insertAudit(env, { booking_id: bookingId, event_type: eventType, payload }, f).catch(() => {});
}

// ── pushCalendarEvent ─────────────────────────────────────────────────────────

/**
 * Upsert a Google Calendar event for the booking.
 *
 * If booking.google_event_id is null → creates a new event (deposit_paid path).
 * If booking.google_event_id is set  → patches the existing event with a "Fully paid"
 *   description update (settled path). Never creates a second event.
 *
 * Returns the event id on success, null on failure or no-op (no secret configured).
 * Never throws.
 */
export async function pushCalendarEvent(
  env: CalendarEnv,
  booking: CalendarBookingData,
  f: typeof fetch = fetch,
): Promise<string | null> {
  if (!env.GOOGLE_SA_KEY_B64) return null;  // calendar not configured — silent no-op

  try {
    const token = await getGoogleAccessToken(env, f);
    const calId = buildCalendarId(env);

    if (booking.google_event_id) {
      // Settled path: patch the existing event (append balance-paid note)
      const patchUrl =
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(booking.google_event_id)}?sendUpdates=none`;
      const patchResp = await f(patchUrl, {
        method: "PATCH",
        headers: {
          "authorization": `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ description: buildDescription(booking, true) }),
      });
      if (!patchResp.ok) {
        throw new Error(`calendar patch failed ${patchResp.status}: ${await patchResp.text()}`);
      }
      await auditCalendar(env, booking.id, "calendar.event-patched", { eventId: booking.google_event_id, weddingDate: booking.wedding_date }, f);
      return booking.google_event_id;
    }

    // Deposit-paid path: create a new event
    const insertUrl =
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?sendUpdates=none`;
    const insertResp = await f(insertUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildEventBody(booking, false)),
    });
    if (!insertResp.ok) {
      throw new Error(`calendar insert failed ${insertResp.status}: ${await insertResp.text()}`);
    }
    const created = (await insertResp.json()) as { id: string };
    await auditCalendar(env, booking.id, "calendar.event-pushed", { eventId: created.id, weddingDate: booking.wedding_date }, f);
    return created.id;
  } catch (e) {
    await auditCalendar(env, booking.id, "calendar.push-failed", { error: String(e), weddingDate: booking.wedding_date }, f);
    return null;
  }
}

// ── patchCalendarEvent ────────────────────────────────────────────────────────

/**
 * PATCH arbitrary fields on an existing calendar event.
 * Non-throwing: silently swallows errors (caller uses fire-and-forget).
 */
export async function patchCalendarEvent(
  env: CalendarEnv,
  eventId: string,
  fields: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<void> {
  if (!env.GOOGLE_SA_KEY_B64) return;
  try {
    const token = await getGoogleAccessToken(env, f);
    const calId = buildCalendarId(env);
    await f(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      {
        method: "PATCH",
        headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(fields),
      },
    );
  } catch {
    // non-throwing
  }
}

// ── deleteCalendarEvent ───────────────────────────────────────────────────────

/**
 * DELETE a calendar event by id.
 * Non-throwing: silently swallows 404 (already deleted) and other errors.
 */
export async function deleteCalendarEvent(
  env: CalendarEnv,
  eventId: string,
  f: typeof fetch = fetch,
): Promise<void> {
  if (!env.GOOGLE_SA_KEY_B64) return;
  try {
    const token = await getGoogleAccessToken(env, f);
    const calId = buildCalendarId(env);
    await f(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      {
        method: "DELETE",
        headers: { "authorization": `Bearer ${token}` },
      },
    );
  } catch {
    // non-throwing
  }
}
```

- [ ] **Step 4 — Run the tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/calendar.test.ts 2>&1
```

Expected: all tests pass. If the PKCS8 key causes `importKey` to fail with a key-format error, replace `TEST_PRIVATE_KEY_PEM` with a freshly generated one:
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | cat
```
Then paste the output into the test file's `TEST_PRIVATE_KEY_PEM` constant.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors related to `calendar.ts`. Fix any type errors before proceeding.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/booking/calendar.ts worker/src/booking/calendar.test.ts
git commit -m "feat(calendar): add Google Calendar service-account JWT auth, push/patch/delete helpers"
```

---

## Task 3 — db.ts: add google_event_id to ConfirmBookingRow and updateBookingGoogleEventId

**Files:**
- Modify: `worker/src/booking/db.ts` (lines 182–209 interface + CONFIRM_COLS string; add new function after line 405 `updateBookingWaveIds`)
- Modify: `worker/src/booking/db.test.ts` (add one test for `updateBookingGoogleEventId`)

**Interfaces:**

Consumes: existing `DbEnv`, `rest`, `headers` helpers in `db.ts`

Produces:
```ts
// Added to ConfirmBookingRow interface (line ~202 in db.ts):
google_event_id: string | null;

// New export:
export async function updateBookingGoogleEventId(
  env: DbEnv,
  bookingId: string,
  googleEventId: string | null,
  f?: typeof fetch,
): Promise<void>
```

---

- [ ] **Step 1 — Write the failing test**

Add to `worker/src/booking/db.test.ts` (at the bottom, after existing tests):

```ts
// In worker/src/booking/db.test.ts — add this describe block:
describe("updateBookingGoogleEventId", () => {
  it("PATCHes google_event_id on the booking row", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await updateBookingGoogleEventId(dbEnv, "booking-uuid-1", "gcal-event-001", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("bookings");
    expect(url).toContain("id=eq.booking-uuid-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.google_event_id).toBe("gcal-event-001");
  });

  it("PATCHes google_event_id to null (delete path)", async () => {
    const f = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await updateBookingGoogleEventId(dbEnv, "booking-uuid-1", null, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.google_event_id).toBeNull();
  });
});
```

Also ensure `updateBookingGoogleEventId` is imported at the top of `db.test.ts` alongside the other imports.

- [ ] **Step 2 — Run the failing test**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/db.test.ts 2>&1 | tail -20
```

Expected: `updateBookingGoogleEventId is not a function` or import error.

- [ ] **Step 3 — Implement changes in db.ts**

**3a. Add `google_event_id` to `ConfirmBookingRow` interface** (insert after `accepted_at` at line ~203):

In `worker/src/booking/db.ts`, find:
```ts
  accepted_at: string | null;
}
```
Change to:
```ts
  accepted_at: string | null;
  google_event_id: string | null;
}
```

**3b. Add `google_event_id` to `CONFIRM_COLS`** (find the string at line ~205):

In `worker/src/booking/db.ts`, find:
```ts
const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at,wave_customer_id,wave_invoice_id," +
  "quote_sent_at,accepted_at";
```
Change to:
```ts
const CONFIRM_COLS =
  "id,reference,status,bride_name,bride_email,wedding_date,venue,town,province," +
  "party_size,total_cents,deposit_pct,deposit_net_cents,balance_net_cents," +
  "confirm_token_expires_at,confirm_token_used_at,wave_customer_id,wave_invoice_id," +
  "quote_sent_at,accepted_at,google_event_id";
```

**3c. Add `updateBookingGoogleEventId` function** (insert after `updateBookingWaveIds`, which ends around line 407):

In `worker/src/booking/db.ts`, find the end of `updateBookingWaveIds`:
```ts
  if (!r.ok) throw new Error(`updateBookingWaveIds ${r.status}: ${await r.text()}`);
}
```
Insert after it:
```ts

/** D2: Store (or clear) the Google Calendar event id on a booking row. */
export async function updateBookingGoogleEventId(
  env: DbEnv,
  bookingId: string,
  googleEventId: string | null,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f(rest(env, `bookings?id=eq.${encodeURIComponent(bookingId)}`), {
    method: "PATCH",
    headers: { ...headers(env), prefer: "return=minimal" },
    body: JSON.stringify({ google_event_id: googleEventId }),
  });
  if (!r.ok) throw new Error(`updateBookingGoogleEventId ${r.status}: ${await r.text()}`);
}
```

- [ ] **Step 4 — Run the db tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/db.test.ts 2>&1
```

Expected: all db tests pass including the two new `updateBookingGoogleEventId` tests.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/booking/db.ts worker/src/booking/db.test.ts
git commit -m "feat(db): add google_event_id to ConfirmBookingRow and updateBookingGoogleEventId helper"
```

---

## Task 4 — Hook calendar into yoco.ts (Yoco deposit_paid and settled)

**Files:**
- Modify: `worker/src/booking/yoco.ts`
- Modify: `worker/src/booking/yoco.test.ts`

**Interfaces:**

Consumes:
- `pushCalendarEvent(env, booking, f)` from `./calendar`
- `updateBookingGoogleEventId(env, bookingId, eventId, f)` from `./db`
- `ConfirmBookingRow` (now has `google_event_id`)

Produces: `handleYocoWebhook` pushes a calendar event after each successful booking transition (deposit_paid path and settled path), fire-and-forget.

---

### 4a — Modifications to yoco.ts

**4a-i. Add import at top of yoco.ts**

In `worker/src/booking/yoco.ts`, find the import block ending at line ~37:
```ts
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailNote, firstN, sendEmail, getEftSettings, type EftSettings } from "../lib/email";
```
Add after it:
```ts
import { pushCalendarEvent, type CalendarEnv } from "./calendar";
import { updateBookingGoogleEventId } from "./db";
```

**4a-ii. Add CalendarEnv to YocoWebhookEnv interface**

In `worker/src/booking/yoco.ts`, find:
```ts
export interface YocoWebhookEnv extends AuditEnv, WaveEnv, DbEnv {
  YOCO_WEBHOOK_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}
```
Change to:
```ts
export interface YocoWebhookEnv extends AuditEnv, WaveEnv, DbEnv, CalendarEnv {
  YOCO_WEBHOOK_SECRET: string;
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
}
```

**4a-iii. Add calendar fire-and-forget after the booking transition block**

In `worker/src/booking/yoco.ts`, find the block that handles the email success path (around lines 295–308). The exact surrounding lines are:
```ts
    if (booking) {
      try {
        const subject = kind === "balance"
          ? "You're all set — fully paid 🎉 · Lustique Co."
          : "Your date is secured 🎉 · Lustique Co.";
```
Insert **before** the `if (booking) {` block (i.e., between line `if (!updated) { ... }` and `const booking = await getBookingById(...)`). The booking is fetched at line ~284:
```ts
    const booking = await getBookingById(env, bookingId, fetchImpl);
```

After the existing email try/catch block (after line ~308 `return new Response("OK", { status: 200 });`), but **before** the final `return`, add a fire-and-forget calendar push. More precisely, find the exact block:
```ts
    if (booking) {
      try {
        const subject = kind === "balance"
          ? "You're all set — fully paid 🎉 · Lustique Co."
          : "Your date is secured 🎉 · Lustique Co.";
        const html = kind === "balance"
          ? fullyPaidEmailHtml(booking.bride_name, booking.wedding_date, booking.balance_net_cents, booking.reference)
          : depositSecuredEmailHtml(booking.bride_name, booking.wedding_date, booking.deposit_net_cents, booking.balance_net_cents, booking.reference);
        await sendEmail(env, { email: booking.bride_email, name: booking.bride_name }, subject, html, fetchImpl);
        await writeAudit(env, { bookingId, eventType: `payment.${kind}-paid`, payload: { reference: booking.reference, checkoutId, yocoPaymentId } }, fetchImpl);
      } catch {
        await writeAudit(env, { bookingId, eventType: "payment.email-failed", payload: { reference: booking.reference, checkoutId } }, fetchImpl).catch(() => {});
      }
    }

    return new Response("OK", { status: 200 });
```
Change to:
```ts
    if (booking) {
      try {
        const subject = kind === "balance"
          ? "You're all set — fully paid 🎉 · Lustique Co."
          : "Your date is secured 🎉 · Lustique Co.";
        const html = kind === "balance"
          ? fullyPaidEmailHtml(booking.bride_name, booking.wedding_date, booking.balance_net_cents, booking.reference)
          : depositSecuredEmailHtml(booking.bride_name, booking.wedding_date, booking.deposit_net_cents, booking.balance_net_cents, booking.reference);
        await sendEmail(env, { email: booking.bride_email, name: booking.bride_name }, subject, html, fetchImpl);
        await writeAudit(env, { bookingId, eventType: `payment.${kind}-paid`, payload: { reference: booking.reference, checkoutId, yocoPaymentId } }, fetchImpl);
      } catch {
        await writeAudit(env, { bookingId, eventType: "payment.email-failed", payload: { reference: booking.reference, checkoutId } }, fetchImpl).catch(() => {});
      }

      // D2: push/patch calendar event (fire-and-forget — never blocks the booking transition)
      pushCalendarEvent(env, booking, fetchImpl)
        .then((eventId) => {
          if (eventId && !booking.google_event_id) {
            return updateBookingGoogleEventId(env, booking.id, eventId, fetchImpl);
          }
        })
        .catch(() => {});  // pushCalendarEvent is already non-throwing; this is belt-and-suspenders
    }

    return new Response("OK", { status: 200 });
```

### 4b — Modifications to yoco.test.ts

**Important:** the tests must NOT rely on a real PEM key surviving `crypto.subtle.importKey`. Instead, spy on `getGoogleAccessToken` at the module level and mock `pushCalendarEvent` so that calendar fetch calls are controlled. After adding the calendar import to `yoco.ts`, each existing `payment.created` test gains **one or two additional mock fetch calls** (the calendar event insert, then the DB PATCH to save `google_event_id`). The mock call indices shift; they must be re-labelled.

**4b-i. Add import at top of yoco.test.ts:**

In `worker/src/booking/yoco.test.ts`, after the existing imports add:
```ts
import * as calendarModule from "./calendar";
```

**4b-ii. Update the deposit `payment.created` test (the "marks payment paid" test)**

Find the test `"marks payment paid, transitions booking accepted→deposit_paid (Wave A primary path), emails bride"`:

The existing mock chain has indices 0–6. After the D2 change, `pushCalendarEvent` fires and then calls `updateBookingGoogleEventId` if it returns an eventId. Since we spy on `getGoogleAccessToken` (so no token-exchange fetch fires), the calendar path adds:
- One fetch call for `events.insert` (the Google Calendar insert) → index 7
- One fetch call for `insertAudit` inside `auditCalendar` inside `pushCalendarEvent` → index 8
- One fetch call for `updateBookingGoogleEventId` PATCH → index 9

Replace the test with:
```ts
  it("marks payment paid, transitions booking accepted→deposit_paid (Wave A primary path), emails bride, fires calendar push", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const body = JSON.stringify(paymentSucceededEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([]))                                           // [0] findPaymentByYocoId (not found)
      .mockResolvedValueOnce(res([paymentRow()]))                               // [1] findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))                                      // [2] markPaymentPaid
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid" })]))     // [3] transitionBooking(accepted)
      .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid", google_event_id: null })]))  // [4] getBookingById
      .mockResolvedValueOnce(res({ messageId: "m1" }, 201))                    // [5] Brevo → bride
      .mockResolvedValueOnce(res({}, 201))                                      // [6] writeAudit (insertAudit)
      .mockResolvedValueOnce(res({ id: "gcal-evt-001" }, 200))                  // [7] calendar events.insert
      .mockResolvedValueOnce(res({}, 201))                                      // [8] calendar auditCalendar insertAudit
      .mockResolvedValueOnce(res({}, 200));                                     // [9] updateBookingGoogleEventId PATCH

    const resp = await handleYocoWebhook(env, webhookReq(paymentSucceededEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);

    // Booking transition shape
    const patchUrl = f.mock.calls[3]![0] as string;
    expect(patchUrl).toContain("status=eq.accepted");
    const patch = JSON.parse((f.mock.calls[3]![1] as RequestInit).body as string);
    expect(patch.status).toBe("deposit_paid");

    // Bride email sent
    const brideEmail = JSON.parse((f.mock.calls[5]![1] as RequestInit).body as string);
    expect(brideEmail.to[0].email).toBe("anke@example.com");

    // Calendar insert called
    const calUrl = f.mock.calls[7]![0] as string;
    expect(calUrl).toContain("calendar/v3/calendars/");
    const calBody = JSON.parse((f.mock.calls[7]![1] as RequestInit).body as string);
    expect(calBody.summary).toContain("Anke");
    expect(calBody.start).toEqual({ date: "2027-11-14" });
  });
```

**4b-iii. For the remaining `payment.created` tests that check non-transition paths (idempotent replay, unknown checkout, race condition) — calendar push only fires after a successful transition + booking fetch, so those tests are unaffected.** Verify by running the test suite after Task 4 is complete.

**4b-iv. Add a test for the settled (balance) path with calendar patch:**

Add at the end of `describe("handleYocoWebhook — payment.created (deposit)")`:
```ts
  it("on balance payment (settled path): patches the existing calendar event", async () => {
    vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
    const balanceEvent = {
      id: "evt_bal",
      type: "payment.created",
      createdDate: "2026-06-17T12:00:00Z",
      payload: {
        id: "pay_bal_yyy",
        checkoutId: "ch_balance_123",
        amountInCents: 441300,
        currency: "ZAR",
        metadata: { bookingId: BOOKING_ID },
      },
    };
    const balancePaymentRow = paymentRow({ id: "pay-row-uuid-2", kind: "balance", yoco_checkout_id: "ch_balance_123" });
    const body = JSON.stringify(balanceEvent);
    const { sig, webhookId, webhookTimestamp } = await sign(body);
    const f = vi.fn()
      .mockResolvedValueOnce(res([]))                                                                // [0] findPaymentByYocoId
      .mockResolvedValueOnce(res([balancePaymentRow]))                                               // [1] findPaymentByCheckoutId
      .mockResolvedValueOnce(res({}, 200))                                                          // [2] markPaymentPaid
      .mockResolvedValueOnce(res([bookingRow({ status: "settled" })]))                              // [3] transitionBooking(deposit_paid→settled)
      .mockResolvedValueOnce(res([bookingRow({ status: "settled", google_event_id: "ev-001" })]))   // [4] getBookingById
      .mockResolvedValueOnce(res({ messageId: "m2" }, 201))                                        // [5] Brevo → bride
      .mockResolvedValueOnce(res({}, 201))                                                          // [6] writeAudit
      .mockResolvedValueOnce(res({ id: "ev-001" }, 200))                                           // [7] calendar events.patch
      .mockResolvedValueOnce(res({}, 201));                                                         // [8] calendar auditCalendar insertAudit

    const resp = await handleYocoWebhook(env, webhookReq(balanceEvent, sig, webhookId, webhookTimestamp), f as unknown as typeof fetch);
    expect(resp.status).toBe(200);

    // Verify it was a PATCH, not a POST
    const calInit = f.mock.calls[7]![1] as RequestInit;
    expect(calInit.method).toBe("PATCH");
    const calBody = JSON.parse(calInit.body as string);
    expect(calBody.description).toContain("Fully paid");
  });
```

- [ ] **Step 4 — Run all yoco tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/yoco.test.ts 2>&1
```

Expected: all tests pass.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/booking/yoco.ts worker/src/booking/yoco.test.ts
git commit -m "feat(yoco): fire-and-forget calendar push on deposit_paid and settled Yoco transitions"
```

---

## Task 5 — Hook calendar into confirm.ts (EFT deposit_paid via handleMarkPaid)

**Files:**
- Modify: `worker/src/booking/confirm.ts`
- Modify: `worker/src/booking/confirm.test.ts`

**Interfaces:**
- Consumes: `pushCalendarEvent`, `CalendarEnv` from `./calendar`; `updateBookingGoogleEventId` from `./db`
- Produces: `handleMarkPaid` calls `pushCalendarEvent` fire-and-forget after the `deposit_paid` transition

---

- [ ] **Step 1 — Write the failing test**

In `worker/src/booking/confirm.test.ts`, add at the top after existing imports:
```ts
import * as calendarModule from "./calendar";
```

Find the existing `handleMarkPaid` test `"transitions confirmed→deposit_paid, emails 'secured'"` (or similar). It currently has a mock chain. After D2 changes, `handleMarkPaid` fires a calendar push → adds `events.insert` and `insertAudit` calls and a `updateBookingGoogleEventId` PATCH to the mock chain.

Add a new test (do not delete the existing one — add alongside it):

```ts
// In describe("handleMarkPaid (POST)") — add:
it("fires calendar push after deposit_paid transition (D2)", async () => {
  vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
  const t = await signActionToken(BOOKING_ID, new Date(Date.now() + 1e9), SIGNING_SECRET, "deposit");
  const f = vi.fn()
    .mockResolvedValueOnce(res([{ id: BOOKING_ID, ...bookingRow({ status: "accepted" }) }]))  // [0] getBookingById (loadConfirmedBooking)
    .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid", google_event_id: null })]))  // [1] transitionBooking(accepted→deposit_paid)
    .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid", google_event_id: null })]))  // [2] transitionBooking fallback(confirmed) skipped because [1] succeeded? Actually confirm.ts tries accepted first, so [1] returns a row and [2] is skipped. Re-index:
    // [1] transitionBooking(accepted→deposit_paid) → returns row (accepted path)
    // [2] Brevo sendEmail → bride
    // [3] writeAudit → insertAudit
    // [4] calendar events.insert
    // [5] calendar auditCalendar insertAudit
    // [6] updateBookingGoogleEventId PATCH
    .mockResolvedValueOnce(res({ messageId: "m3" }, 201))          // [2] Brevo
    .mockResolvedValueOnce(res({}, 201))                            // [3] insertAudit
    .mockResolvedValueOnce(res({ id: "gcal-mark-paid-001" }, 200)) // [4] calendar insert
    .mockResolvedValueOnce(res({}, 201))                            // [5] calendar insertAudit
    .mockResolvedValueOnce(res({}, 200));                           // [6] updateBookingGoogleEventId

  const req = new Request("https://worker/api/booking/mark-paid", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: t }).toString(),
  });
  const resp = await handleMarkPaid(env, req, f as unknown as typeof fetch);
  expect(resp.status).toBe(200);

  // Calendar insert must have fired
  const calUrl = f.mock.calls[4]![0] as string;
  expect(calUrl).toContain("calendar/v3/calendars/");
  const calBody = JSON.parse((f.mock.calls[4]![1] as RequestInit).body as string);
  expect(calBody.summary).toContain("Anke");
  expect(calBody.start).toEqual({ date: "2027-11-14" });
});
```

- [ ] **Step 2 — Run the failing test**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/confirm.test.ts 2>&1 | tail -20
```

Expected: the new calendar test fails (calendar import is not yet used in `confirm.ts`).

- [ ] **Step 3 — Implement changes in confirm.ts**

**3a. Add import** (after the existing imports at the top of `confirm.ts`):
```ts
import { pushCalendarEvent, type CalendarEnv } from "./calendar";
import { updateBookingGoogleEventId } from "./db";
```

**3b. Add `CalendarEnv` to `BookingConfirmEnv`:**

In `worker/src/booking/confirm.ts`, find:
```ts
export interface BookingConfirmEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}
```
Change to:
```ts
export interface BookingConfirmEnv extends AuditEnv, CalendarEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}
```

**3c. Add calendar fire-and-forget after the deposit_paid transition in `handleMarkPaid`.**

In `worker/src/booking/confirm.ts`, find in `handleMarkPaid` (around lines 271–284):
```ts
  if (!updated) return htmlResponse(handledHtml(), 200);

  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "Your date is secured · Lustique Co.", depositSecuredEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.deposit-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(depositRecordedHtml(b));
```
Change to:
```ts
  if (!updated) return htmlResponse(handledHtml(), 200);

  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "Your date is secured · Lustique Co.", depositSecuredEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.deposit-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  // D2: push calendar event (fire-and-forget)
  pushCalendarEvent(env, b, fetchImpl)
    .then((eventId) => {
      if (eventId && !b.google_event_id) {
        return updateBookingGoogleEventId(env, b.id, eventId, fetchImpl);
      }
    })
    .catch(() => {});

  return htmlResponse(depositRecordedHtml(b));
```

- [ ] **Step 4 — Run all confirm tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/confirm.test.ts 2>&1
```

Expected: all tests pass.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/booking/confirm.ts worker/src/booking/confirm.test.ts
git commit -m "feat(confirm): fire-and-forget calendar push on EFT deposit_paid (handleMarkPaid)"
```

---

## Task 6 — Hook calendar into balance.ts (EFT settled via handleMarkBalancePaid)

**Files:**
- Modify: `worker/src/booking/balance.ts`
- Modify: `worker/src/booking/balance.test.ts`

**Interfaces:**
- Consumes: `pushCalendarEvent`, `CalendarEnv` from `./calendar`; `updateBookingGoogleEventId` from `./db`
- Produces: `handleMarkBalancePaid` calls `pushCalendarEvent` fire-and-forget after the `settled` transition

---

- [ ] **Step 1 — Write the failing test**

In `worker/src/booking/balance.test.ts`, add at the top after existing imports:
```ts
import * as calendarModule from "./calendar";
```

Add a new test inside `describe("handleMarkBalancePaid (POST)")`:

```ts
it("fires calendar push (patch path) after settled transition (D2)", async () => {
  vi.spyOn(calendarModule, "getGoogleAccessToken").mockResolvedValue("tok-test");
  const t = await balanceToken();
  const f = vi.fn()
    .mockResolvedValueOnce(res([bookingRow({ status: "deposit_paid", google_event_id: "ev-existing" })]))  // [0] getBookingById
    .mockResolvedValueOnce(res([bookingRow({ status: "settled", google_event_id: "ev-existing" })]))       // [1] transitionBooking(deposit_paid→settled)
    .mockResolvedValueOnce(res({ messageId: "m4" }, 201))  // [2] Brevo bride
    .mockResolvedValueOnce(res({}, 201))                   // [3] insertAudit (writeAudit)
    .mockResolvedValueOnce(res({ id: "ev-existing" }, 200))  // [4] calendar events.patch (not insert — google_event_id set)
    .mockResolvedValueOnce(res({}, 201));                  // [5] calendar insertAudit

  const req = postReq(t);
  const resp = await handleMarkBalancePaid(env, req, f as unknown as typeof fetch);
  expect(resp.status).toBe(200);
  const html = await resp.text();
  expect(html).toContain("Balance recorded");

  // Confirm it was a PATCH (not POST) — existing event id was set
  const calInit = f.mock.calls[4]![1] as RequestInit;
  expect(calInit.method).toBe("PATCH");
  const calBody = JSON.parse(calInit.body as string);
  expect(calBody.description).toContain("Fully paid");
});
```

- [ ] **Step 2 — Run the failing test**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/balance.test.ts 2>&1 | tail -20
```

Expected: the new test fails (calendar not yet imported in `balance.ts`).

- [ ] **Step 3 — Implement changes in balance.ts**

**3a. Add import** (after existing imports at top of `balance.ts`):
```ts
import { pushCalendarEvent, type CalendarEnv } from "./calendar";
import { updateBookingGoogleEventId } from "./db";
```

**3b. Add `CalendarEnv` to `BookingBalanceEnv`:**

In `worker/src/booking/balance.ts`, find:
```ts
export interface BookingBalanceEnv extends AuditEnv, WaveEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}
```
Change to:
```ts
export interface BookingBalanceEnv extends AuditEnv, WaveEnv, CalendarEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
}
```

**3c. Add calendar fire-and-forget in `handleMarkBalancePaid`.**

In `worker/src/booking/balance.ts`, find the end of `handleMarkBalancePaid` (around lines 150–157):
```ts
  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "All settled — fully paid · Lustique Co.", fullyPaidEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }
  return htmlResponse(balanceRecordedHtml(b));
```
Change to:
```ts
  try {
    await sendEmail(env, { email: b.bride_email, name: b.bride_name },
      "All settled — fully paid · Lustique Co.", fullyPaidEmailHtml(b), fetchImpl);
    await writeAudit(env, { bookingId: b.id, eventType: "payment.balance-recorded", payload: { reference: b.reference } }, fetchImpl);
  } catch {
    await writeAudit(env, { bookingId: b.id, eventType: "payment.email-failed", payload: { reference: b.reference } }, fetchImpl).catch(() => {});
  }

  // D2: push/patch calendar event (fire-and-forget)
  // If google_event_id is set → pushCalendarEvent patches it; if null → creates a new event.
  pushCalendarEvent(env, b, fetchImpl)
    .then((eventId) => {
      if (eventId && !b.google_event_id) {
        return updateBookingGoogleEventId(env, b.id, eventId, fetchImpl);
      }
    })
    .catch(() => {});

  return htmlResponse(balanceRecordedHtml(b));
```

- [ ] **Step 4 — Run all balance tests (expect PASS)**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run src/booking/balance.test.ts 2>&1
```

Expected: all tests pass.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/booking/balance.ts worker/src/booking/balance.test.ts
git commit -m "feat(balance): fire-and-forget calendar push/patch on EFT settled (handleMarkBalancePaid)"
```

---

## Task 7 — Env interface, wrangler.toml, and full test suite

**Files:**
- Modify: `worker/src/index.ts` (add `GOOGLE_SA_KEY_B64`, `GOOGLE_CALENDAR_ID` to `Env` interface; register backfill route)
- Modify: `worker/wrangler.toml` (add `GOOGLE_CALENDAR_ID` var; document new secret)

---

- [ ] **Step 1 — Update Env interface in index.ts**

In `worker/src/index.ts`, find:
```ts
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}
```
Change to:
```ts
  AUDIT: { put(key: string, value: string): Promise<unknown> };
  // D2: Google Calendar integration (optional — if absent, calendar calls are silent no-ops)
  // Secret: GOOGLE_SA_KEY_B64 = base64 of the full service-account JSON key file
  // Var:    GOOGLE_CALENDAR_ID = calendar id (e.g. abc@group.calendar.google.com) — set in wrangler.toml
  GOOGLE_SA_KEY_B64?: string;
  GOOGLE_CALENDAR_ID?: string;
}
```

- [ ] **Step 2 — Add GOOGLE_CALENDAR_ID var to wrangler.toml**

In `worker/wrangler.toml`, find:
```toml
[vars]
ALLOWED_ORIGIN = "https://lustiqueco.co.za"
```
Change to:
```toml
[vars]
ALLOWED_ORIGIN = "https://lustiqueco.co.za"
# D2: Google Calendar — shared Lustique calendar id (non-secret; paste from Google Calendar settings)
# Example: GOOGLE_CALENDAR_ID = "abc123def456@group.calendar.google.com"
# Leave empty or omit to disable calendar integration in staging/preview.
GOOGLE_CALENDAR_ID = ""
```

Also add to the secrets comment block:
```toml
# D2 Google Calendar (optional — if absent, calendar calls are silent no-ops):
#   GOOGLE_SA_KEY_B64 — base64 of the full service-account JSON key file
#   Encoding: base64 < service-account-key.json | tr -d '\n'
#   Set via: wrangler secret put GOOGLE_SA_KEY_B64
```

- [ ] **Step 3 — Register the optional backfill route in index.ts**

In `worker/src/index.ts`, find the JWT-gated admin block (the section that checks `dashEnv.SUPABASE_JWT_SECRET` for Supabase auth). At the end of that block, before the closing `}`, add:

```ts
      // POST /api/admin/calendar/backfill — push calendar events for deposit_paid/settled bookings
      // that are missing google_event_id. JWT-gated. Optional D2 backfill utility.
      if (req.method === "POST" && url.pathname === "/api/admin/calendar/backfill") {
        const admin = await getAdminSession(req, dashEnv);
        if (!admin) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401, headers: { "content-type": "application/json" },
          });
        }
        return await handleCalendarBackfill(dashEnv, fetchImpl);
      }
```

Add the `handleCalendarBackfill` function inline in `index.ts` (or in a new file `worker/src/booking/calendar-backfill.ts`). Inline version for completeness:

```ts
// Add near the top imports of index.ts:
import { pushCalendarEvent } from "./booking/calendar";
import { updateBookingGoogleEventId } from "./booking/db";
import { getAdminSession } from "./booking/auth";

// Add this function after the main fetch handler:
async function handleCalendarBackfill(env: Env, f: typeof fetch = fetch): Promise<Response> {
  // Fetch all deposit_paid + settled bookings with no google_event_id
  const url = `${env.SUPABASE_URL}/rest/v1/bookings` +
    `?status=in.(deposit_paid,settled)&google_event_id=is.null` +
    `&select=id,reference,bride_name,wedding_date,venue,town,party_size,google_event_id` +
    `&order=wedding_date.asc&limit=100`;
  const r = await f(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ ok: false, error: `DB error ${r.status}` }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
  const bookings = (await r.json()) as Array<{
    id: string; reference: string; bride_name: string; wedding_date: string;
    venue: string | null; town: string | null; party_size: number; google_event_id: string | null;
  }>;

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const b of bookings) {
    processed++;
    const eventId = await pushCalendarEvent(env, b, f);
    if (eventId) {
      await updateBookingGoogleEventId(env, b.id, eventId, f).catch(() => {});
      succeeded++;
    } else {
      failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, succeeded, failed }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 4 — Run the full test suite**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass, zero failures.

- [ ] **Step 5 — Type-check**

```bash
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 6 — Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): register GOOGLE_SA_KEY_B64/GOOGLE_CALENDAR_ID env fields and optional /api/admin/calendar/backfill route"
```

---

## Pieter / One-Time Setup

> These steps require Pieter's Google/Cloudflare accounts. Sonnet cannot perform them.

### P-1 — 🔴 CRITICAL: Apply migration 0014 BEFORE deploying Worker

Migration `0014_booking_google_event.sql` adds `bookings.google_event_id`. If the Worker is deployed first, any PATCH call that writes `google_event_id` will receive a 400 from PostgREST (unknown column). Apply the migration first.

**Apply via Supabase dashboard:**
1. Go to Supabase dashboard → project → SQL Editor.
2. Paste and run the contents of `supabase/migrations/0014_booking_google_event.sql`.
3. Verify: run `SELECT column_name FROM information_schema.columns WHERE table_name='bookings' AND column_name='google_event_id';` — must return one row.

**Or via Supabase CLI (if configured):**
```bash
supabase db push
```

**If using a staging branch:** apply to the staging branch first, test, then merge to production.

### P-2 — Create Google Cloud service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project (e.g. `lustique-calendar`).
2. Enable the **Google Calendar API** on the project: APIs & Services → Library → search "Google Calendar API" → Enable.
3. Go to IAM & Admin → Service Accounts → Create Service Account.
   - Name: `lustique-booking`
   - Description: `Lustique booking calendar integration`
   - Do not grant any IAM roles (the calendar sharing in step 5 is sufficient).
4. Click the created service account → Keys → Add Key → JSON. Download the key file (e.g. `lustique-booking-key.json`).
5. Open Google Calendar as Zandeline (or as LZ if this is the shared calendar). Go to Settings → the shared Lustique calendar → Share with specific people → add the service account email (`lustique-booking@<project-id>.iam.gserviceaccount.com`) with permission **"Make changes to events"**.
6. Copy the **Calendar ID** from Calendar Settings → the Lustique calendar → scroll to "Calendar ID". It looks like `abc123@group.calendar.google.com`.

### P-3 — Set the Worker secret and var

```bash
# Encode the key file (produces a single-line base64 string with no newlines)
base64 < lustique-booking-key.json | tr -d '\n'
# Then set as a Cloudflare Worker secret:
cd "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/worker"
wrangler secret put GOOGLE_SA_KEY_B64
# Paste the base64 string when prompted.
```

Update `worker/wrangler.toml`:
```toml
GOOGLE_CALENDAR_ID = "abc123@group.calendar.google.com"  # paste the real calendar id here
```

Deploy:
```bash
wrangler deploy
```

### P-4 — Verify the calendar integration end-to-end

1. Create a test booking and manually trigger a deposit_paid transition (use the admin mark-paid link or trigger via Yoco sandbox).
2. Check the Lustique Google Calendar — an all-day event should appear on the wedding date.
3. Check the Supabase `bookings` table — `google_event_id` should be populated.
4. Check `audit_log` — a `calendar.event-pushed` row should exist for the booking.
5. If the event does not appear: check `audit_log` for `calendar.push-failed` and inspect the `payload.error` field.

### P-5 — Optional: run the backfill for existing bookings

Once the Worker is deployed and verified, run the backfill for any existing `deposit_paid`/`settled` bookings that pre-date this deployment:

```bash
curl -X POST https://lustiqueco.co.za/api/admin/calendar/backfill \
  -H "Cookie: __Host-sb_session=<your-admin-session-token>"
```

Response: `{"ok":true,"processed":N,"succeeded":N,"failed":0}`.

---

## Self-Review — Spec Coverage

| Constraint / "Opus must answer" | Task that covers it |
|--------------------------------|---------------------|
| ONE event per booking; no double-event leak | AD-1, Task 2 (`pushCalendarEvent` upsert), Task 4/5/6 |
| Create event at deposit_paid ONLY IF google_event_id is null | AD-1, Task 2, Task 4, Task 5 |
| At settled: PATCH if google_event_id set; CREATE if null | AD-1, Task 2 (`pushCalendarEvent` patch path), Task 4, Task 6 |
| patchCalendarEvent non-throwing | Task 2 (implementation + test "does not throw when API returns error") |
| Service-account auth (NOT user OAuth) | AD-3, Task 2 (`mintJwt`, `getGoogleAccessToken`) |
| GOOGLE_SA_KEY_B64 = base64 of full SA JSON | AD-2, Task 7 (Env + wrangler.toml) |
| GOOGLE_CALENDAR_ID wrangler.toml var | AD-2, Task 7 |
| calendar.ts pure-ish with injectable fetch | AD-3, Task 2 (all functions accept `f` param) |
| Hook points: confirm.ts handleMarkPaid | AD-4 (hooks section), Task 5 |
| Hook points: yoco.ts handleYocoWebhook | AD-4 (hooks section), Task 4 |
| Hook points: balance.ts handleMarkBalancePaid | AD-4 (hooks section), Task 6 |
| Non-blocking: push fails → booking still transitions | AD-5, all handler tasks (fire-and-forget `.catch`) |
| On success: persist google_event_id | AD-6, Tasks 4/5/6 (updateBookingGoogleEventId in `.then()`) |
| On failure: write audit row, CONTINUE | AD-5, Task 2 (`auditCalendar` in catch block) |
| Event summary: bride first name + party size (no financial data) | AD-4, Task 2 (`buildEventBody`) |
| Event description: wedding date, venue/town, reference (no amounts) | AD-4, Task 2 (`buildDescription`) |
| No attendees in D2 (D4 adds artist emails) | AD-4 (attendees deferred to D4) |
| Migration 0014 adds google_event_id TEXT NULL | Task 1 |
| Migration 0014 must be applied before deploy | AD-9, Pieter P-1 (🔴 CRITICAL flag) |
| ConfirmBookingRow includes google_event_id | AD-7, Task 3 |
| getAdminSession (NOT verifyAdminSession) | AD locked fix, Task 7 (backfill route) |
| Test env uses `env` (not `testEnv`) | Global Constraint 12, Tasks 4/5/6 tests |
| Test env uses `res` (not `jsonRes`) | Global Constraint 12, Tasks 4/5/6 tests |
| AUDIT field in test env | Tasks 4/5/6 test env declarations |
| vi.spyOn getGoogleAccessToken instead of real PEM | Fixed locked — Tasks 4/5/6 test setup |
| npx tsc --noEmit after EACH handler modification | Tasks 4 Step 5, 5 Step 5, 6 Step 5 |
| Cancel path: deleteCalendarEvent + null column | AD-1 (cancel path described); note: no cancel handler exists yet in the codebase; when added it must follow the pattern in reject.ts |
| reject.ts (quote_sent→rejected): no event → skip delete | AD-1, Task 2 (deleteCalendarEvent only called if google_event_id set; reject.ts has no such call because the bride never paid) |
| Backfill route: optional JWT-gated POST | AD-8, Task 7 |
| Token cache: module-level, 60s pre-expiry | AD-3, Task 2 (`_tokenCache`) |
| Security headers wrapper on admin route | Task 7 (backfill returns plain JSON, not HTML — no `withSec` needed; JSON responses use `content-type: application/json`) |
| Money rule: shared/pricing untouched | Global Constraint 3 — no pricing changes in any task |
| TDD throughout | Every task has failing test → implementation → passing test |
| Build order: D2 built LAST in Wave D after D4 | Plan header note; attendees deferred to D4 |
