// worker/src/booking/clioInbound.ts
/**
 * POST /api/clio/webhook — inbound events FROM external systems, relayed to Clio.
 *
 * External sources that don't naturally emit Worker events can POST here so the AI
 * still learns about them in real time:
 *   - Supabase DB webhook → fires when Zandeline acts in the dashboard (marks confirmed,
 *     edits a quote) without touching app code.
 *   - Google Calendar push → watch the bookings calendar; surface double-bookings.
 *   - Brevo webhook → bounce / complaint / unsubscribe → keep CRM clean.
 *
 * Auth: when CLIO_WEBHOOK_SECRET is set, the caller MUST send a Standard-Webhooks
 * signed body (webhook-id / webhook-timestamp / webhook-signature). We verify it and
 * reject replayed (>3 min) or bad signatures with 401. When the secret is unset, the
 * route is open (dev only) — production MUST set CLIO_WEBHOOK_SECRET.
 *
 * On success we forward the event to the AI brain via notifyClio (audience "pieter"
 * by default, since these are operational/technical signals), and persist it to
 * clio_activity for the dashboard feed.
 */

import { notifyClio, signClioEvent, type ClioEnv } from "./clio";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleClioInbound(env: ClioEnv, req: Request): Promise<Response> {
  const rawBody = await req.text();

  const secret = env.CLIO_WEBHOOK_SECRET;
  if (secret) {
    const webhookId = req.headers.get("webhook-id") ?? "";
    const webhookTimestamp = req.headers.get("webhook-timestamp") ?? "";
    const sigHeader = req.headers.get("webhook-signature") ?? "";
    // 3-minute replay window
    const ts = parseInt(webhookTimestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts * 1000) > 3 * 60 * 1000) {
      return new Response("Unauthorized", { status: 401 });
    }
    let expected: string;
    try {
      expected = await signClioEvent(rawBody, webhookId, webhookTimestamp, secret);
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    const ok = sigHeader.split(" ").some((part) => {
      if (!part.startsWith("v1,")) return false;
      return timingSafeEqual(expected, part.slice(3));
    });
    if (!ok) return new Response("Unauthorized", { status: 401 });
  }

  let event: {
    type?: string;
    title?: string;
    body?: string;
    link?: string;
    audience?: "zandeline" | "pieter" | "both";
    payload?: Record<string, unknown>;
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!event.type || !event.title) {
    return new Response("Bad request", { status: 400 });
  }

  notifyClio(env, {
    type: event.type,
    title: event.title,
    body: event.body,
    link: event.link,
    audience: event.audience ?? "pieter",
    payload: event.payload,
  });

  return new Response("OK", { status: 200 });
}
