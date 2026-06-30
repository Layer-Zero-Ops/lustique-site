/* ============================================================
   LUSTIQUE CO. — live estimator + map-pin travel calculator (client)
   Pricing imported from @lustique/pricing — one source of truth,
   shared with the future Worker. Map uses free Photon/OSRM.
   ============================================================ */
import {
  computeEstimate, travelForKm, DEST_KM, FREE_KM, ACTIVE_PROMO,
  type EstimateInput, type EstimateLine, type HairBuckets, type HairLength, type Occasion, type TravelBand,
} from "@lustique/pricing";

declare const L: any; // Leaflet global (loaded via the CDN <script> on the quote page)

const STUDIO = { lat: -25.7986, lng: 28.3127 }; // 242 Frangipani St, La Montagne (approx)

let travelOverride: { km: number; cost: number; destination: boolean } | null = null;
let foundLabel = "";
let map: any, marker: any;

const el = (id: string) => document.getElementById(id);
const fld = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
const num = (id: string) => { const e = fld(id); return e ? Math.max(0, parseInt(e.value, 10) || 0) : 0; };
const val = (id: string, d = "") => { const e = fld(id); return e ? e.value : d; };
const rand = (x: number) => x.toLocaleString("en-ZA").replace(/,/g, " ");
const setBand = (show: boolean) => { const w = el("bandWrap"); if (w) w.style.display = show ? "" : "none"; };

// Adult heads needing hair = the bridesmaid + mother + guest hair counts.
const adultHairHeads = (): number => num("bmHair") + num("momHair") + num("guestHair");

/** Party hair as a length distribution — the four always-visible buckets. */
function readPartyHair(): HairBuckets {
  return { short: num("lenShort"), medium: num("lenMedium"), long: num("lenLong"), xlong: num("lenXlong") };
}

/** Keep the "N looks need hair" count + the "placed of N" reconciliation note honest as the form changes. */
function updateLengthHint(): void {
  const n = adultHairHeads();
  const headCount = el("hairHeadCount");
  if (headCount) headCount.textContent = String(n);
  const counter = el("lengthsCounter");
  if (!counter) return;
  const placed = num("lenShort") + num("lenMedium") + num("lenLong") + num("lenXlong");
  if (placed === n) counter.textContent = n ? `✓ all ${n} placed` : "";
  else if (placed < n) counter.textContent = `${placed} of ${n} placed — ${n - placed} to go`;
  else counter.textContent = `${placed} placed — ${placed - n} more than need hair`;
}

export function readInput(): EstimateInput {
  const occasion = val("occasion", "wedding") as Occasion;
  // Only weddings collect a venue. Events & lessons settle travel in the personal quote,
  // so it's always 0 in their live estimate (no stale wedding travel leaks in either).
  const travel: EstimateInput["travel"] =
    occasion !== "wedding"
      ? { band: "studio" as TravelBand }
      : travelOverride
        ? { cost: travelOverride.cost, destination: travelOverride.destination }
        : { band: val("travelBand", "studio") as TravelBand };
  return {
    occasion,
    brideHairLen: val("brideHairLen", "medium") as HairLength,
    partyHair: readPartyHair(),
    bmMakeup: num("bmMakeup"), bmHair: num("bmHair"),
    momMakeup: num("momMakeup"), momHair: num("momHair"),
    fgAge: val("fgAge", "under") === "under" ? "under" : "over",
    fgMakeup: num("fgMakeup"), fgHair: num("fgHair"), fgHairLen: val("fgHairLen", "medium") as HairLength,
    guestMakeup: num("guestMakeup"), guestHair: num("guestHair"),
    evMakeup: num("evMakeup"), evHair: num("evHair"), evHairLen: val("evHairLen", "medium") as HairLength,
    lessonsAttending: num("lessonsAttending"),
    requestedArtists: num("requestedArtists"),
    // The active promo is config (ACTIVE_PROMO), not hardcoded — the toggle only opts in/out.
    promo: (el("promoToggle") as HTMLInputElement | null)?.checked === false ? { kind: "none" } : ACTIVE_PROMO,
    travel,
  };
}

// Show the bride what builds her price (Pieter: "inform what contributes to their overall price").
// Built with safe DOM + textContent — no innerHTML, no injection surface.
function renderBreakdown(lines: EstimateLine[], total: number, destination: boolean): void {
  const box = el("estimateBreakdown");
  if (!box) return;
  box.replaceChildren();
  if (destination || lines.length === 0) return;

  // Section heading
  const heading = document.createElement("div");
  heading.textContent = "What’s in your estimate";
  heading.style.cssText =
    "font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;" +
    "color:var(--mocha);opacity:.7;margin-bottom:.6rem;";
  box.append(heading);

  const money = (n: number) => (n < 0 ? "− R " : "R ") + rand(Math.abs(n));

  const addRow = (
    label: string,
    amount: string,
    opts: { discount?: boolean; total?: boolean; separator?: boolean } = {},
  ) => {
    if (opts.separator) {
      const hr = document.createElement("div");
      hr.style.cssText = "border-top:1px solid rgba(60,42,42,.12);margin:.4rem 0;";
      box.append(hr);
      return;
    }
    const r = document.createElement("div");
    r.style.cssText =
      "display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.5rem 0;" +
      (opts.total
        ? "border-top:2px solid rgba(60,42,42,.2);margin-top:.5rem;padding-top:.75rem;"
        : "border-bottom:1px solid rgba(60,42,42,.07);");
    const l = document.createElement("span"); l.textContent = label;
    const a = document.createElement("span"); a.textContent = amount;
    a.style.cssText = "white-space:nowrap;font-variant-numeric:tabular-nums;";
    if (opts.total) {
      l.style.cssText = "font-weight:700;font-size:1rem;";
      a.style.cssText += "font-weight:700;font-size:1rem;";
    }
    if (opts.discount) {
      l.style.color = a.style.color = "var(--burgundy)";
      l.style.fontStyle = a.style.fontStyle = "italic";
    }
    r.append(l, a);
    box.append(r);
  };

  const serviceLines = lines.filter((ln) => ln.amount >= 0);
  const discountLines = lines.filter((ln) => ln.amount < 0);
  for (const ln of serviceLines) addRow(ln.label, money(ln.amount));
  if (discountLines.length) {
    addRow("", "", { separator: true });
    for (const ln of discountLines) addRow(ln.label, money(ln.amount), { discount: true });
  }
  addRow("Estimated total", "from R " + rand(total), { total: true });
}

function renderEstimate() {
  const out = el("estimateAmount");
  if (!out) return;
  const sub = el("estimateSub");
  // Safety net: never let the live estimate break silently or flash "NaN" at a bride.
  try {
    updateLengthHint();
    const r = computeEstimate(readInput());
    if (!r.destination && !Number.isFinite(r.total)) throw new Error(`non-finite total: ${r.total}`);
    out.textContent = r.destination ? "Destination — we’ll tailor it" : "from R " + rand(r.total);
    if (sub) {
      if (r.destination) sub.textContent = "Over 200 km — we’ll send a personalised destination quote";
      else if (r.occasion === "lessons") sub.textContent = `${r.heads} attending · group lesson`;
      else if (r.occasion !== "wedding") sub.textContent = `${r.heads} ${r.heads === 1 ? "face" : "faces"} · approximate event estimate`;
      else sub.textContent = `${r.heads} ${r.heads === 1 ? "look" : "looks"} · incl. trial & touch-ups`;
    }
    renderBreakdown(r.lines, r.total, r.destination);
  } catch (err) {
    console.error("[estimator] render failed — recovering:", err);
    out.textContent = "Let’s tailor your estimate";
    if (sub) sub.textContent = "Add a few details and we’ll confirm it personally.";
    el("estimateBreakdown")?.replaceChildren();
  }
}

function routeFrom(lat: number, lng: number) {
  const res = el("travelResult");
  if (res) res.textContent = "Measuring the drive from our studio…";
  fetch(`https://router.project-osrm.org/route/v1/driving/${STUDIO.lng},${STUDIO.lat};${lng},${lat}?overview=false`)
    .then((r) => r.json())
    .then((r: any) => {
      const m = r.routes && r.routes[0] && r.routes[0].distance;
      if (m == null) throw new Error("no route");
      const km = Math.round(m / 1000);
      const roundTrip = km * 2;
      const destination = km > DEST_KM;
      travelOverride = { km, cost: destination ? 0 : travelForKm(km), destination };
      if (res) {
        if (destination) res.textContent = `📍 ≈ ${km} km one-way — a destination wedding. We’ll tailor travel + accommodation in your quote.`;
        else if (roundTrip <= FREE_KM) res.textContent = `📍 ${foundLabel ? foundLabel + " · " : ""}≈ ${km} km one-way (${roundTrip} km round trip) — travel is included free. ✓ Drag the pin if this isn’t your exact venue.`;
        else res.textContent = `📍 ${foundLabel ? foundLabel + " · " : ""}≈ ${km} km one-way (${roundTrip} km round trip) — travel ≈ R ${rand(travelOverride.cost)}. ✓ Drag the pin if this isn’t your exact venue.`;
      }
      setBand(false);
      renderEstimate();
    })
    .catch(() => {
      travelOverride = null;
      if (res) res.textContent = "Couldn’t calculate that route — pick a distance band below and we’ll confirm personally.";
      setBand(true);
      renderEstimate();
    });
}

function initMap(center: { lat: number; lng: number }) {
  const node = el("venueMap");
  if (!node || typeof L === "undefined") return false;
  node.style.display = "block";
  const hint = el("mapHint"); if (hint) hint.style.display = "block";
  if (!map) {
    map = L.map(node).setView([center.lat, center.lng], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
    marker = L.marker([center.lat, center.lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); routeFrom(p.lat, p.lng); });
  } else {
    map.setView([center.lat, center.lng], 11);
    marker.setLatLng([center.lat, center.lng]);
  }
  setTimeout(() => map.invalidateSize(), 250);
  return true;
}

async function lookupTravel() {
  const venue = val("venueInput").trim();
  const town = val("townInput").trim();
  const res = el("travelResult");
  if (!venue && !town) { if (res) res.textContent = "Add your venue or town above, then we’ll find it on the map."; return; }
  if (res) res.textContent = "Finding your venue…";
  const prov = val("provinceInput");
  const provPart = prov && prov.indexOf("Other") === -1 ? prov : "";
  const q = [venue, town, provPart, "South Africa"].filter(Boolean).join(", ");
  try {
    const apiKey = (import.meta.env.PUBLIC_HERE_API_KEY as string) || "";
    const g = await fetch(
      `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(q)}&in=countryCode:ZAF&limit=1&apiKey=${encodeURIComponent(apiKey)}`,
    ).then((r) => r.json());
    const item = g.items && g.items[0];
    if (!item) throw new Error("no geocode");
    const center = { lat: item.position.lat, lng: item.position.lng };
    const label: string = (item.address && item.address.label) || item.title || "";
    foundLabel = label.split(",").slice(0, 3).map((s: string) => s.trim()).filter(Boolean).join(", ");
    initMap(center);
    routeFrom(center.lat, center.lng);
  } catch {
    travelOverride = null;
    if (res) res.textContent = "We couldn’t pin that automatically — pick a distance band below and we’ll confirm travel personally.";
    setBand(true);
    renderEstimate();
  }
}

// Show only the field groups that fit the chosen occasion.
function applyOccasion() {
  const occ = val("occasion", "wedding");
  const isWedding = occ === "wedding";
  const isLessons = occ === "lessons";
  const show = (id: string, on: boolean) => { const e = el(id); if (e) e.style.display = on ? "" : "none"; };
  show("weddingDayFields", isWedding);            // date + venue + travel — weddings only
  show("weddingFields", isWedding);               // the bride + bridal party
  show("eventFields", !isWedding && !isLessons);  // events: faces + hair
  show("lessonsFields", isLessons);               // group lessons: attendee count
  show("promoRow", isWedding);                    // the "book 4+ free" offer only computes for weddings
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("quoteForm");
  if (!form) return;
  // Surface (don't swallow) anything that slips past the local handlers.
  window.addEventListener("error", (e) => console.error("[quote] uncaught error:", e.message));
  window.addEventListener("unhandledrejection", (e) => console.error("[quote] unhandled rejection:", e.reason));
  form.addEventListener("input", renderEstimate);
  form.addEventListener("change", renderEstimate);
  const occ = el("occasion");
  if (occ) occ.addEventListener("change", applyOccasion);
  const btn = el("checkTravel");
  if (btn) btn.addEventListener("click", lookupTravel);
  applyOccasion();
  renderEstimate();
});
