/**
 * /book — reads booking state from sessionStorage (set by /quote → "Proceed to book"),
 * pre-fills personal + wedding fields, and POSTs to /api/booking/request.
 * If no sessionStorage entry exists, shows a fallback pointing back to /quote.
 */
import { BOOKING_STORAGE_KEY } from "./booking-request";
import { grossUp, splitDeposit, randToCents, YOCO_FEE_RATE } from "@lustique/pricing";

const el = (id: string) => document.getElementById(id);
const val = (id: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return e ? e.value.trim() : "";
};
const setVal = (id: string, v: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (e) e.value = v;
};
const rand = (cents: number) =>
  (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function postBookingRequest(
  data: unknown,
): Promise<{ ok: boolean; reference?: string; error?: string; retriable: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("/api/booking/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    const out = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      reference?: string;
      error?: string;
    };
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

document.addEventListener("DOMContentLoaded", () => {
  const raw = sessionStorage.getItem(BOOKING_STORAGE_KEY);

  if (!raw) {
    const noSess = el("noSessionMsg");
    if (noSess) noSess.style.display = "";
    return;
  }

  const bookForm = el("bookForm");
  if (bookForm) bookForm.style.display = "";

  let stored: {
    estimateInput: Record<string, unknown>;
    brideName?: string;
    brideEmail?: string;
    bridePhone?: string;
    weddingDate?: string;
    venue?: string;
    town?: string;
    province?: string;
    estimateTotal?: number;
  };

  try {
    stored = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(BOOKING_STORAGE_KEY);
    window.location.href = "quote.html";
    return;
  }

  // Estimate summary — amount + deposit breakdown
  const amtEl = el("estimateSummaryAmt");
  const depositEl = el("estimateDepositNote");
  if (amtEl && stored.estimateTotal && stored.estimateTotal > 0) {
    amtEl.textContent = `R ${stored.estimateTotal.toLocaleString("en-ZA")}`;
    if (depositEl) {
      const totalCents = randToCents(stored.estimateTotal);
      const { depositNetCents } = splitDeposit(totalCents, 50);
      const depositPayable = grossUp(depositNetCents, YOCO_FEE_RATE);
      depositEl.textContent = `50% deposit — R ${rand(depositPayable)} incl. card fee`;
    }
  }

  // Pre-fill personal details
  const nameParts = (stored.brideName ?? "").split(" ");
  setVal("bkFName", nameParts[0] ?? "");
  setVal("bkLName", nameParts.slice(1).join(" "));
  setVal("bkEmail", stored.brideEmail ?? "");
  setVal("bkPhone", stored.bridePhone ?? "");
  setVal("bkDate", stored.weddingDate ?? "");
  setVal("bkVenue", stored.venue ?? "");
  setVal("bkTown", stored.town ?? "");
  if (stored.province) setVal("bkProvince", stored.province);

  // Submit
  const btn = el("bkSubmit") as HTMLButtonElement | null;
  const statusEl = el("bkStatus");
  const say = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  btn?.addEventListener("click", async () => {
    const consent = (el("bkConsent") as HTMLInputElement | null)?.checked;
    if (!consent) {
      say("Please tick the consent box to proceed.");
      return;
    }

    const cfToken = getTurnstileToken();
    if (!cfToken) {
      say("Security check not ready — please wait a moment and try again.");
      return;
    }

    const fName = val("bkFName");
    const lName = val("bkLName");
    const brideName = [fName, lName].filter(Boolean).join(" ");
    const brideEmail = val("bkEmail");
    const weddingDate = val("bkDate");

    if (!brideName || !brideEmail) {
      say("Please add your name and email so we can reach you.");
      return;
    }
    if (!weddingDate) {
      say("Please add your wedding date.");
      return;
    }

    const body = {
      ...stored.estimateInput,
      brideName,
      brideEmail,
      bridePhone: val("bkPhone"),
      weddingDate,
      venue: val("bkVenue"),
      town: val("bkTown"),
      province: val("bkProvince"),
      depositPct: 50,
      consentAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      hp_company: "",
      cfTurnstileToken: cfToken,
    };

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
      sessionStorage.removeItem(BOOKING_STORAGE_KEY);
      window.location.href = `booking-received.html?ref=${encodeURIComponent(result.reference)}`;
      return;
    }

    say(
      result.error ??
        "Something went wrong — please email info@lustiqueco.co.za and we'll help you directly.",
    );
    (window as unknown as { turnstile?: { reset(): void } }).turnstile?.reset();
    btn.disabled = false;
    btn.textContent = label;
  });
});
