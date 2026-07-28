// worker/src/booking/aria-bridge.ts
// Phase 4 (Pillar 4) — embed Aria as the invisible engine.
// A dashboard action writes a DIRECTIVE to the agent_bridge table; Aria (Telegram
// COO) reads pending directives and acts — invisibly, no manual email drafting.

import { getAdminSession, loginRedirect, type AuthEnv } from "./auth";
import { getBookingById, type ConfirmBookingRow } from "./db";
import { writeAudit } from "./audit";
import { esc } from "../lib/email";

export interface AdminActionsEnv extends AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
  ALLOWED_ORIGIN?: string;
  NOTIFY_EMAIL: string;
  BREVO_API_KEY: string;
  AUDIT: { put(key: string, value: string): Promise<unknown> };
}

export interface AriaTaskInput {
  bookingId: string;
  reference: string;
  brideName: string;
  task: "draft-follow-up" | "draft-review-nudge" | "summarise" | "custom";
  note?: string;
}

/** Pure: shape the directive row for agent_bridge. Testable without I/O. */
export function buildAriaDirective(i: AriaTaskInput): { direction: string; type: string; payload: Record<string, unknown> } {
  return {
    direction: "desktop->aria",
    type: "directive",
    payload: {
      action: i.task,
      booking_id: i.bookingId,
      reference: i.reference,
      bride_name: i.brideName,
      note: i.note ?? null,
      requested_by: "dashboard",
    },
  };
}

function errorRedirect(id: string, msg: string): Response {
  return new Response(null, { status: 302, headers: { Location: `/api/admin/booking/${id}?error=${encodeURIComponent(msg)}` } });
}
function successRedirect(id: string): Response {
  return new Response(null, { status: 302, headers: { Location: `/api/admin/booking/${id}?saved=1` } });
}

/** POST /api/admin/booking/:id/aria-task — hand a task to Aria via agent_bridge. */
export async function handleAdminAriaTask(
  req: Request,
  env: AdminActionsEnv,
  bookingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const session = await getAdminSession(req, env, fetchFn);
  if (!session) return loginRedirect();

  let booking: ConfirmBookingRow | null;
  try {
    booking = await getBookingById(env, bookingId, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Could not fetch booking");
  }
  if (!booking) return errorRedirect(bookingId, "Booking not found");

  let task = "draft-follow-up";
  let note: string | undefined;
  try {
    const fd = await req.formData();
    task = (fd.get("task") as string) || task;
    note = (fd.get("note") as string) || undefined;
  } catch { /* default task */ }

  const directive = buildAriaDirective({
    bookingId: booking.id,
    reference: booking.reference,
    brideName: booking.bride_name,
    task: task as AriaTaskInput["task"],
    note,
  });

  try {
    const r = await fetchFn(`${env.SUPABASE_URL}/rest/v1/agent_bridge`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(directive),
    });
    if (!r.ok) return errorRedirect(bookingId, "Could not queue Aria task");
    await writeAudit(env, { bookingId: booking.id, eventType: "aria.task-queued", payload: { reference: booking.reference, task, by: (session as any).email } }, fetchFn);
  } catch {
    return errorRedirect(bookingId, "Failed to reach Aria bridge");
  }

  return successRedirect(bookingId);
}
