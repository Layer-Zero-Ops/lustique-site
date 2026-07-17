// worker/src/booking/clio.ts
/**
 * Clio event fan-out — the nervous system that turns Lustique's Worker from a
 * twice-daily poll (Hermes digest) into an event-driven AI assistant.
 *
 * Every meaningful business transition calls `notifyClio(event)`. The Worker
 * POSTs a compact, signed event to CLIO_WEBHOOK_URL — the inbound Hermes/Clio
 * receiver. The receiver (a follow-up pass) routes by `event.audience`:
 *   - "zandeline" → her Telegram (new enquiry, deposit paid, payment failed, breaks)
 *   - "pieter"    → his desktop (technical anomalies, schema drift, cron failures)
 *
 * Design rules (match the codebase's defensive style):
 *  - NEVER throws. A Clio outage must never break a real booking/enquiry flow.
 *  - Never blocks the caller — fire-and-forget via the injected fetch.
 *  - No-op when CLIO_WEBHOOK_URL / CLIO_WEBHOOK_SECRET unset (receiver not wired yet).
 *  - Events are signed (HMAC-SHA256 over `${id}.${ts}.${body}`) so the receiver can
 *    verify provenance and reject replayed payloads (3-min window).
 *
 * The same event is also persisted to the `clio_activity` table (migration 0026)
 * so the admin "Clio" tab can show a "recent activity" feed — see SESSION_HANDOFF.
 */

import { rest, headers, type DbEnv } from "./db";

export interface ClioEnv extends Partial<DbEnv> {
  CLIO_WEBHOOK_URL?: string;
  CLIO_WEBHOOK_SECRET?: string;
}

/** Where the event should be surfaced. */
export type ClioAudience = "zandeline" | "pieter" | "both";

export interface ClioEvent {
  /** Stable event kind, e.g. "enquiry.received", "payment.deposit_paid". */
  type: string;
  /** Human title for the feed / Telegram card. */
  title: string;
  /** Short body — already escaped/truncated by the caller (server never trusts client). */
  body?: string;
  /** Admin dashboard deep-link (optional). */
  link?: string;
  /** Which surface(s) should receive this. Defaults to "zandeline" for booking ops. */
  audience?: ClioAudience;
  /** Free-form structured context (booking id, reference, amount). */
  payload?: Record<string, unknown>;
}

interface ClioActivityRow {
  event_type: string;
  title: string;
  body?: string;
  link?: string;
  audience: ClioAudience;
  payload?: Record<string, unknown>;
}

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Sign the event body — mirrors worker/src/booking/yoco.ts Standard Webhooks style. */
export async function signClioEvent(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(toSign));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** Persist to clio_activity (best-effort; never throws). */
async function persistActivity(
  env: ClioEnv,
  row: ClioActivityRow,
  f: typeof fetch,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  try {
    const r = await f(rest(env, "clio_activity"), {
      method: "POST",
      headers: { ...headers(env), prefer: "return=minimal" },
      body: JSON.stringify({ ...row, created_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      // Swallow — activity feed is non-critical.
      await r.body?.cancel?.();
    }
  } catch {
    /* never throw out of the clio path */
  }
}

/**
 * Emit a Clio event. Fire-and-forget; never throws; never blocks the caller.
 * `f` is injectable for tests.
 */
export function notifyClio(
  env: ClioEnv,
  event: ClioEvent,
  f: typeof fetch = fetch,
): void {
  const audience = event.audience ?? "zandeline";
  const payload = event.payload ?? {};
  const row: ClioActivityRow = {
    event_type: event.type,
    title: event.title,
    body: event.body,
    link: event.link,
    audience,
    payload,
  };

  // Always persist to the activity feed (non-critical, best-effort).
  void persistActivity(env, row, f);

  // If the receiver isn't wired yet, that's the whole job done for now.
  if (!env.CLIO_WEBHOOK_URL) return;

  const id = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const rawBody = JSON.stringify({ id, ts, ...row });

  void (async () => {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (env.CLIO_WEBHOOK_SECRET) {
        const sig = await signClioEvent(rawBody, id, ts, env.CLIO_WEBHOOK_SECRET);
        headers["webhook-id"] = id;
        headers["webhook-timestamp"] = ts;
        headers["webhook-signature"] = `v1,${sig}`;
      }
      const res = await f(env.CLIO_WEBHOOK_URL!, {
        method: "POST",
        headers,
        body: rawBody,
      });
      if (!res.ok) {
        // Best-effort: swallow non-2xx (receiver logs its own side).
        await res.body?.cancel?.();
      }
    } catch {
      /* a Clio outage must never surface to the booking/enquiry flow */
    }
  })();
}
