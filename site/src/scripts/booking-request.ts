/**
 * /quote — "Request to book" submit handler.
 * Reads the estimator form state (via the shared readInput export), collects the
 * bride's personal details + deposit choice + consent + Turnstile token, and POSTs
 * to /api/booking/request. On success navigates to /booking-received?ref=...
 */
import { readInput } from "./estimator";
import { grossUp, splitDeposit, randToCents, YOCO_FEE_RATE } from "@lustique/pricing";

// ── DOM helpers (private) ─────────────────────────────────────────────────────
const el = (id: string) => document.getElementById(id);
const val = (id: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return e ? e.value.trim() : "";
};
const rand = (cents: number) => (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── deposit-% live labels ─────────────────────────────────────────────────────
function updateDepositLabels(totalRand: number | null): void {
  document.querySelectorAll<HTMLElement>(".deposit-amt").forEach((span) => {
    const pct = parseInt(span.dataset.pct ?? "50", 10) as 25 | 50 | 100;
    if (!totalRand || totalRand <= 0) { span.textContent = "—"; return; }
    const totalCents = randToCents(totalRand);
    const { depositNetCents } = splitDeposit(totalCents, pct);
    const payable = grossUp(depositNetCents, YOCO_FEE_RATE);
    span.textContent = `R ${rand(payable)} incl. card fee`;
  });
}

// ── show/hide booking section ─────────────────────────────────────────────────
function applyOccasionToBookingSection(): void {
  const occ = (document.getElementById("occasion") as HTMLSelectElement | null)?.value ?? "wedding";
  const section = el("bookingSection");
  if (section) section.style.display = occ === "wedding" ? "" : "none";
}

// ── submit ────────────────────────────────────────────────────────────────────
async function postBookingRequest(data: unknown): Promise<{ ok: boolean; reference?: string; error?: string; retriable: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("/api/booking/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    const out = (await r.json().catch(() => ({}))) as { ok?: boolean; reference?: string; error?: string };
    if (r.ok && out.ok) return { ok: true, reference: out.reference, retriable: false };
    return { ok: false, error: out.error, retriable: r.status >= 500 };
  } catch {
    return { ok: false, retriable: true };
  } finally {
    clearTimeout(timer);
  }
}

function getTurnstileToken(): string {
  const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return input?.value ?? "";
}

// ── wiring ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Keep deposit labels in sync with the live estimate
  const estimateEl = el("estimateAmount");
  if (estimateEl) {
    const observer = new MutationObserver(() => {
      const text = estimateEl.textContent ?? "";
      const match = text.replace(/\s/g, "").match(/[\d]+/);
      const rand = match ? parseInt(match[0], 10) : null;
      updateDepositLabels(rand);
    });
    observer.observe(estimateEl, { childList: true, subtree: true, characterData: true });
  }

  // Show/hide booking section based on occasion
  applyOccasionToBookingSection();
  document.getElementById("occasion")?.addEventListener("change", applyOccasionToBookingSection);

  // Submit handler
  const btn = el("requestBooking") as HTMLButtonElement | null;
  const statusEl = el("bookingStatus");
  const say = (msg: string) => { if (statusEl) statusEl.textContent = msg; };

  btn?.addEventListener("click", async () => {
    const consent = (el("consentBooking") as HTMLInputElement | null)?.checked;
    if (!consent) {
      say("Please tick the consent box to proceed.");
      return;
    }
    const depositRadio = document.querySelector<HTMLInputElement>('input[name="depositPct"]:checked');
    if (!depositRadio) {
      say("Please choose a deposit percentage.");
      return;
    }
    const cfToken = getTurnstileToken();
    if (!cfToken) {
      say("Security check not ready — please wait a moment and try again.");
      return;
    }

    const estimateInput = readInput();
    const body = {
      ...estimateInput,
      brideName: [val("fName"), val("lName")].filter(Boolean).join(" "),
      brideEmail: val("email"),
      bridePhone: val("phone"),
      weddingDate: val("weddingDate"),
      town: val("townInput"),
      province: val("provinceInput"),
      venue: val("venueInput"),
      depositPct: parseInt(depositRadio.value, 10),
      consentAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      hp_company: val("hp_company"),
      cfTurnstileToken: cfToken,
    };

    if (!body.brideName || !body.brideEmail) {
      say("Please add your name and email so we can reach you.");
      return;
    }
    if (!body.weddingDate) {
      say("Please add your wedding date.");
      return;
    }

    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";
    say("");

    let result = await postBookingRequest(body);
    if (!result.ok && result.retriable) {
      say("Connection hiccup — trying once more…");
      await new Promise((r) => setTimeout(r, 1200));
      result = await postBookingRequest(body);
    }

    if (result.ok && result.reference) {
      window.location.href = `booking-received.html?ref=${encodeURIComponent(result.reference)}`;
      return;
    }

    say(result.error ?? "Something went wrong — please email info@lustiqueco.co.za and we'll help you directly.");
    btn.disabled = false;
    btn.textContent = label;
  });
});
