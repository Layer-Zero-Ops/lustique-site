/* /quote — submit handler: gather the FULL enquiry → POST /api/enquiry → thank-you page.
   The endpoint is the Worker (worker/), routed same-origin at /api/* in production.
   Before the backend is deployed there's no /api/enquiry, so it surfaces a soft error
   instead of failing silently. Pricing/occasion logic lives in estimator.ts. */

import { computeEstimate } from "@lustique/pricing";
import { readInput } from "./estimator";

type Detail = { label: string; value: string; kind?: "service" };

const val = (id: string): string => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return el ? el.value.trim() : "";
};
const numv = (id: string): number => parseInt(val(id), 10) || 0;
const chk = (id: string, d = true): boolean => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.checked : d;
};

const OCCASION: Record<string, string> = {
  wedding: "Wedding", matric: "Matric farewell",
};
const LEN: Record<string, string> = { short: "Short", medium: "Medium", long: "Long", xlong: "X-Long" };
const lenLabel = (id: string): string => LEN[val(id) || "medium"] ?? "Medium";

/** Human-readable party composition — only the roles she actually booked. */
function partySummary(): string {
  const out: string[] = [];
  const role = (label: string, mk: string, hr: string) => {
    const m = numv(mk), h = numv(hr);
    if (m || h) out.push(`${label}: ${m} makeup / ${h} hair`);
  };
  role("Bridesmaids", "bmMakeup", "bmHair");
  role("Mothers", "momMakeup", "momHair");
  role(`Flower girls (${val("fgAge") === "over" ? "12+" : "under 12"})`, "fgMakeup", "fgHair");
  role("Guests", "guestMakeup", "guestHair");
  return out.join("; ") || "Bride only";
}

/** Party hair as she entered it — the four length buckets. */
function partyHairSummary(): string {
  const buckets = (["Short", "Medium", "Long", "Xlong"] as const)
    .map((k) => { const n = numv("len" + k); return n ? `${n} ${LEN[k.toLowerCase()] ?? k}` : ""; })
    .filter(Boolean);
  return buckets.length ? buckets.join(", ") : "—";
}

function collect() {
  const occasion = val("occasion") || "wedding";
  const date =
    occasion === "wedding" ? val("weddingDate")
    : occasion === "lessons" ? val("lessonsDate")
    : val("eventDate");

  const details: Detail[] = [];
  const add = (label: string, value: string) => { if (value && value !== "—") details.push({ label, value }); };

  add("Heard via", val("source"));

  if (occasion === "wedding") {
    add("Venue", val("venueInput"));
    const brideMakeup = chk("brideWantsMakeup");
    const brideHair = chk("brideWantsHair");
    const brideTrial = chk("brideWantsTrial");
    const brideParts = [brideMakeup ? "Makeup" : null, brideHair ? "Hair" : null].filter(Boolean).join(" + ");
    add("Bride services", `${brideParts || "None selected"}${brideTrial ? " (incl. trial)" : " (wedding day only)"}`);
    if (brideHair) add("Bride hair length", lenLabel("brideHairLen"));
    add("Party", partySummary());
    add("Party hair", partyHairSummary());
    if (numv("fgHair")) add("Flower-girl hair", `${numv("fgHair")} × ${lenLabel("fgHairLen")}`);
    if (numv("requestedArtists")) add("Additional artists requested", String(numv("requestedArtists")));
    const promo = (document.getElementById("promoToggle") as HTMLInputElement | null)?.checked;
    add("Offer", promo ? "Apply the active promo (cheapest look free, 4+)" : "Not applied");
  } else if (occasion === "lessons") {
    add("Attending", val("lessonsAttending"));
  } else {
    add("People", `${numv("evMakeup")} makeup / ${numv("evHair")} hair`);
    if (numv("evHair")) add("Hair length", lenLabel("evHairLen"));
  }
  add("Style", val("style"));
  add("Inspiration", val("inspo"));

  // Granular service lines from the pricing engine (weddings only).
  // Stored with kind="service" so the admin enquiry detail page can render a proper quote table.
  if (occasion === "wedding") {
    try {
      const fmtR = (n: number) =>
        (n < 0 ? "− R " : "R ") +
        Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      const result = computeEstimate(readInput());
      for (const line of result.lines) {
        if (line.amount !== 0) {
          details.push({ label: line.label, value: fmtR(line.amount), kind: "service" });
        }
      }
    } catch { /* non-critical — enquiry still submits without service lines */ }
  }

  const tsInput = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return {
    name: [val("fName"), val("lName")].filter(Boolean).join(" "),
    email: val("email"),
    phone: val("phone"),
    occasion: OCCASION[occasion] ?? occasion,
    date,
    estimate: (document.getElementById("estimateAmount")?.textContent ?? "").trim(),
    message: val("message"),
    details,
    hp_company: val("hp_company"), // honeypot — the Worker drops it if filled
    cfTurnstileToken: tsInput?.value ?? "",
  };
}

const btn = document.getElementById("sendEnquiry") as HTMLButtonElement | null;
const statusEl = document.getElementById("enquiryStatus");
const say = (msg: string) => { if (statusEl) statusEl.textContent = msg; };

/** One POST attempt with a 15s timeout. `retriable` = transient (network / timeout / 5xx) → worth one auto-retry. */
async function postEnquiry(data: unknown): Promise<{ ok: boolean; error?: string; retriable: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch("/api/enquiry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && out.ok) return { ok: true, retriable: false };
    return { ok: false, error: out.error, retriable: res.status >= 500 }; // 4xx (validation) is the user's to fix
  } catch {
    return { ok: false, retriable: true }; // network error or the 15s timeout aborted it
  } finally {
    clearTimeout(timer);
  }
}

btn?.addEventListener("click", async () => {
  const data = collect();
  if (!data.name || !data.email) {
    say("Please add your name and email so we can reply.");
    return;
  }
  const consent = document.getElementById("consentCheck") as HTMLInputElement | null;
  if (consent && !consent.checked) {
    say("Please tick the consent box so we can contact you about your enquiry.");
    return;
  }
  // For weddings, the length buckets must account for everyone needing hair — so the quote is exact.
  if ((val("occasion") || "wedding") === "wedding") {
    if (!chk("brideWantsMakeup") && !chk("brideWantsHair")) {
      say("Please choose at least makeup or hair for the bride.");
      return;
    }
    const need = numv("bmHair") + numv("momHair") + numv("guestHair");
    const placed = numv("lenShort") + numv("lenMedium") + numv("lenLong") + numv("lenXlong");
    if (placed !== need) {
      say(`Almost there — please place all ${need} party hair looks by length (you've placed ${placed}).`);
      return;
    }
  }

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending…";
  say("");

  // Self-heal: one automatic retry on a transient failure before we ask her to email us instead.
  let result = await postEnquiry(data);
  if (!result.ok && result.retriable) {
    say("Connection hiccup — trying once more…");
    await new Promise((r) => setTimeout(r, 1200));
    result = await postEnquiry(data);
  }
  if (result.ok) {
    window.location.href = "thank-you.html";
    return;
  }
  say(result.error || "We couldn’t send that just now — please email info@lustiqueco.co.za and we’ll jump on it.");

  btn.disabled = false;
  btn.textContent = label;
});
