// worker/src/booking/request.ts
/**
 * POST /api/booking/request — the request-to-book endpoint (spec §7, §8, §10, §12).
 * Dependency injection makes every external call testable (fetch, computeFn, newId).
 */
import {
  computeEstimate, randToCents,
  type EstimateInput, type EstimateResult,
} from "@lustique/pricing";
import { insertBooking, countBookingsOnDate, getDateAvailability } from "./db";
import { writeAudit, type AuditEnv } from "./audit";
import { signToken, hashToken } from "./token";
import { makeReference } from "./util";
import { esc, fmtDate, fmtZAR, ep, em, emailShell, emailTable, emailNote, firstN, sendEmail } from "../lib/email";

// ── env interface ─────────────────────────────────────────────────────────────
export interface BookingRequestEnv extends AuditEnv {
  BREVO_API_KEY: string;
  NOTIFY_EMAIL: string;
  ALLOWED_ORIGIN: string;
  SIGNING_SECRET: string;
  TURNSTILE_SECRET: string;
}

// ── request body ─────────────────────────────────────────────────────────────
interface RequestBody {
  brideName?: string;
  brideEmail?: string;
  bridePhone?: string;
  weddingDate?: string;
  town?: string;
  province?: string;
  venue?: string;
  idempotencyKey?: string;
  consentAt?: string;
  hp_company?: string;
  cfTurnstileToken?: string;
  occasion?: string;
  brideHairLen?: string;
  partyHair?: unknown;
  bmMakeup?: unknown; bmHair?: unknown;
  momMakeup?: unknown; momHair?: unknown;
  fgAge?: string; fgMakeup?: unknown; fgHair?: unknown; fgHairLen?: string;
  guestMakeup?: unknown; guestHair?: unknown;
  evMakeup?: unknown; evHair?: unknown; evHairLen?: string;
  lessonsAttending?: unknown;
  requestedArtists?: unknown;
  promo?: unknown;
  travel?: unknown;
}

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SANITY_CAP_RAND = 200_000;

const n = (v: unknown): number => Math.max(0, parseInt(String(v ?? 0), 10) || 0);

async function verifyTurnstile(token: string, secret: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!r.ok) return false;
    return ((await r.json()) as { success: boolean }).success === true;
  } catch {
    return false;
  }
}

function validate(b: RequestBody): string | "spam" | null {
  if (b.hp_company?.trim()) return "spam";
  if (!b.brideName || b.brideName.trim().length < 2) return "Please add your name.";
  if (!b.brideEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.brideEmail)) return "Please add a valid email address.";
  if (!b.bridePhone || b.bridePhone.trim().length < 6) return "Please add a contact number.";
  if (!b.weddingDate) return "Please add your wedding date.";
  if (b.weddingDate <= new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)) return "Your wedding date must be in the future.";
  if (!b.consentAt) return "Please tick the consent box to proceed.";
  if (!b.idempotencyKey) return "Missing submission key — please reload and try again.";
  return null;
}

function toEstimateInput(b: RequestBody): EstimateInput {
  return {
    occasion: (b.occasion ?? "wedding") as EstimateInput["occasion"],
    brideHairLen: (b.brideHairLen ?? "medium") as EstimateInput["brideHairLen"],
    partyHair: (b.partyHair as EstimateInput["partyHair"]) ?? { short: 0, medium: 0, long: 0, xlong: 0 },
    bmMakeup: n(b.bmMakeup), bmHair: n(b.bmHair),
    momMakeup: n(b.momMakeup), momHair: n(b.momHair),
    fgAge: b.fgAge === "over" ? "over" : "under",
    fgMakeup: n(b.fgMakeup), fgHair: n(b.fgHair),
    fgHairLen: (b.fgHairLen ?? "medium") as EstimateInput["fgHairLen"],
    guestMakeup: n(b.guestMakeup), guestHair: n(b.guestHair),
    evMakeup: n(b.evMakeup), evHair: n(b.evHair),
    evHairLen: (b.evHairLen ?? "medium") as EstimateInput["evHairLen"],
    lessonsAttending: n(b.lessonsAttending),
    requestedArtists: n(b.requestedArtists),
    promo: (b.promo as EstimateInput["promo"]) ?? { kind: "none" },
    travel: (b.travel as EstimateInput["travel"]) ?? { band: "studio" },
  };
}

export async function handleBookingRequest(
  env: BookingRequestEnv,
  req: Request,
  fetchImpl: typeof fetch = fetch,
  computeFn: (input: EstimateInput) => EstimateResult = computeEstimate,
  newId: () => string = () => crypto.randomUUID(),
): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN || "*";
  const json = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", "access-control-allow-origin": origin },
    });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400);
  }

  // 1. Honeypot (before any I/O)
  const problem = validate(body);
  if (problem === "spam") return json({ ok: true }, 200);

  // 2. Turnstile bot check
  const tsOk = await verifyTurnstile(body.cfTurnstileToken ?? "", env.TURNSTILE_SECRET, fetchImpl);
  if (!tsOk) return json({ ok: false, error: "Bot check failed — please refresh and try again." }, 422);

  // 3. Field validation
  if (problem) return json({ ok: false, error: problem }, 422);

  // 4. Availability gate — hard-block if admin explicitly closed the date (Wave A soft-block)
  const avail = await getDateAvailability(env, body.weddingDate!, fetchImpl);
  if (avail.hardBlocked) {
    return json({
      ok: false,
      error: "We're sorry — that date is no longer available. Please choose another date or contact us at info@lustiqueco.co.za.",
    }, 409);
  }

  // 5. Server-authoritative price recompute (spec §8 — never trust client total)
  const estimateInput = toEstimateInput(body);
  const result = computeFn(estimateInput);
  const totalCents = randToCents(result.total);
  const notes = result.total > SANITY_CAP_RAND
    ? `⚠️ Total R${result.total.toLocaleString()} exceeds R${SANITY_CAP_RAND.toLocaleString()} — manual review.`
    : null;

  // 6. Pre-generate bookingId + sign token before insert (spec §12)
  const bookingId = newId();
  const tokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);
  const token = await signToken(bookingId, tokenExpiry, env.SIGNING_SECRET);
  const tokenHash = await hashToken(token);
  const reference = makeReference(bookingId, new Date().getUTCFullYear());

  // 7. Same-date count for the warning in Lustique's confirm email (spec §10)
  const sameDateCount = await countBookingsOnDate(env, body.weddingDate!, fetchImpl);

  // 8. Insert (idempotent — on conflict returns the existing row)
  const returned = await insertBooking(
    env,
    {
      id: bookingId,
      reference,
      idempotency_key: body.idempotencyKey,
      status: "requested",
      occasion: estimateInput.occasion,
      wedding_date: body.weddingDate,
      bride_name: body.brideName!.trim(),
      bride_email: body.brideEmail!.trim().toLowerCase(),
      bride_phone: body.bridePhone!.trim(),
      town: body.town?.trim() || null,
      province: body.province?.trim() || null,
      venue: body.venue?.trim() || null,
      party_size: result.heads,
      estimate_input: estimateInput,
      total_cents: totalCents,
      quote_lines: result.lines,
      deposit_pct: null,
      deposit_net_cents: 0,
      balance_net_cents: 0,
      availability_conflict: avail.conflict,
      consent_at: body.consentAt,
      confirm_token_hash: tokenHash,
      confirm_token_expires_at: tokenExpiry.toISOString(),
      notes,
    },
    fetchImpl,
  );

  // Dedupe: booking already existed — confirm link already sent; just return the ref
  if (returned.id !== bookingId) {
    return json({ ok: true, reference: returned.reference }, 200);
  }

  // 9. Audit
  await writeAudit(
    env,
    { bookingId, eventType: "request.created", payload: { reference, totalCents, availabilityConflict: avail.conflict } },
    fetchImpl,
  );

  // 10 + 11. Emails — Lustique (confirm link) + bride (received)
  // If either call fails: write audit, return 502 so the client knows.
  // IMPORTANT: retrying with the same idempotencyKey will short-circuit at the dedupe
  // branch above and never re-send emails. The "request.email-failed" audit event is
  // the recovery trace until S5 adds a cron retry sweep.
  try {
    const confirmUrl = `${env.ALLOWED_ORIGIN}/api/booking/review?token=${encodeURIComponent(token)}`;
    const where = [body.venue, body.town, body.province].filter(Boolean).join(", ");
    const sameDateHtml = sameDateCount > 0
      ? `<p style="color:#b91c1c;font-weight:600;margin:0 0 .8rem;">⚠️ ${sameDateCount} other active booking${sameDateCount === 1 ? "" : "s"} already hold${sameDateCount === 1 ? "s" : ""} this date.</p>`
      : "";

    // Team notification — compact operational email
    await sendEmail(
      env,
      { email: env.NOTIFY_EMAIL, name: "Lustique" },
      `Booking request — ${body.brideName!.trim()} · ${body.weddingDate}`,
      `<p style="font:14px/1.6 system-ui,sans-serif;margin:0 0 .5rem;"><strong>${esc(body.brideName!.trim())}</strong> — ${esc(body.brideEmail!.trim())} · ${esc(body.bridePhone!.trim())}</p>
${sameDateHtml}
<table style="border-collapse:collapse;font:14px/1.6 system-ui,sans-serif;margin:.4rem 0 .8rem;">
<tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Date</td><td><strong>${esc(body.weddingDate!)}</strong></td></tr>
<tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Venue</td><td>${esc(where || "—")}</td></tr>
<tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Party</td><td>${result.heads} looks</td></tr>
<tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Total</td><td><strong>${fmtZAR(totalCents)}</strong></td></tr>
<tr><td style="color:#8a7d72;padding:2px 12px 2px 0;white-space:nowrap;">Reference</td><td>${esc(reference)}</td></tr>
</table>
${avail.conflict ? `<p style="color:#b91c1c;font-weight:600;">⚠️ Date near capacity (${avail.bookingCount}/${avail.slots} slots filled) — review carefully before approving.</p>` : ""}
${notes ? `<p style="color:#b91c1c;">${esc(notes)}</p>` : ""}
<p style="margin:1.2rem 0;"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#8a3a52;color:#fff;padding:.7em 1.6em;border-radius:8px;text-decoration:none;font-weight:600;">Review &amp; approve booking</a></p>
<p style="font-size:.88rem;color:#8a7d72;">Token expires in 14 days.</p>`,
      fetchImpl,
    );

    // Bride — Email 1: Booking received
    const tableRows = [
      { key: "Date", val: fmtDate(body.weddingDate!) },
      ...(where ? [{ key: "Venue", val: where }] : []),
      { key: "Bridal party", val: `${result.heads} looks` },
      { key: "Your reference", val: reference, ref: true },
    ];
    await sendEmail(
      env,
      { email: body.brideEmail!.trim(), name: body.brideName!.trim() },
      "Your booking request is with us — Lustique Co.",
      emailShell({
        heading: `We have your request, ${firstN(body.brideName!.trim())}.`,
        body: ep(`Your booking request for ${em(fmtDate(body.weddingDate!))} is with us. Our team will review artist availability and come back to you within 24 hours.`) +
          emailTable(tableRows),
        btnZone: emailNote("No action needed from you right now — we&#8217;ll be in touch."),
      }),
      fetchImpl,
    );
  } catch {
    await writeAudit(
      env,
      { bookingId, eventType: "request.email-failed", payload: { reference } },
      fetchImpl,
    ).catch(() => {}); // never throw out of the catch
    return json({ ok: false, error: "We couldn't send your confirmation emails — please email info@lustiqueco.co.za and we'll confirm your booking directly." }, 502);
  }

  return json({ ok: true, reference }, 200);
}
