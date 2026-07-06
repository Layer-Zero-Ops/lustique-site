/**
 * Anonymous telemetry for the quote-page venue matcher — how each lookup
 * resolved, so we can measure real-world first-time accuracy instead of
 * guessing from directory size. No PII, best-effort: a failed insert must
 * never surface an error to the bride filling in the quote form.
 */
import { rest, headers, type DbEnv } from "./db";

export interface VenueMatchStatsEnv extends DbEnv {
  ADMIN_SECRET: string;
}

const enc = new TextEncoder();
// Same timing-safe token check as accounting.ts / blocked-dates — kept local
// since it's a two-line primitive, not worth a shared-util seam yet.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export const VALID_OUTCOMES = new Set([
  "directory-exact", // typed text matched a directory entry exactly (label or name)
  "directory-fuzzy-confirmed", // fuzzy match shown, bride confirmed it
  "directory-fuzzy-rejected", // fuzzy match shown, bride said "not my venue"
  "live-search-directory", // picked a suggestion from the live dropdown that was one of ours
  "live-search-external", // picked a suggestion from the live dropdown from HERE's index
  "geocode-fallback", // no match/pick — free-text geocode of venue+town+province succeeded
  "geocode-fail", // geocode fallback also failed
  "manual-pin", // bride dragged the pin with no successful automated match
]);

const MAX_TEXT_LEN = 200;
const truncate = (s: unknown): string | null =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, MAX_TEXT_LEN) : null;

export async function handleVenueMatchLog(
  req: Request,
  env: DbEnv,
  origin: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400, headers: corsHeaders(origin) });
  }
  const outcome = (body as { outcome?: unknown })?.outcome;
  if (typeof outcome !== "string" || !VALID_OUTCOMES.has(outcome)) {
    return new Response(null, { status: 400, headers: corsHeaders(origin) });
  }

  const row = {
    outcome,
    typed_text: truncate((body as { typedText?: unknown }).typedText),
    matched_name: truncate((body as { matchedName?: unknown }).matchedName),
  };

  try {
    await f(rest(env, "venue_match_log"), { method: "POST", headers: headers(env), body: JSON.stringify(row) });
  } catch {
    // Best-effort — swallow. Losing a telemetry row is fine; breaking the quote page isn't.
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/** Admin-only summary: counts per outcome, most recent 5000 rows. ?token=ADMIN_SECRET required. */
export async function handleVenueMatchStats(
  req: Request,
  env: VenueMatchStatsEnv,
  origin: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token || !(await timingSafeEqual(token, env.ADMIN_SECRET))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }
  const r = await f(rest(env, "venue_match_log?select=outcome&order=created_at.desc&limit=5000"), {
    headers: headers(env),
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ error: "query failed" }), {
      status: 502,
      headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }
  const rows = (await r.json()) as Array<{ outcome: string }>;
  const byOutcome: Record<string, number> = {};
  for (const row of rows) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  return new Response(JSON.stringify({ total: rows.length, byOutcome }), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}
