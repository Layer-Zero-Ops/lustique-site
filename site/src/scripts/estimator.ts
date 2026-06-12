/* ============================================================
   LUSTIQUE CO. — live estimator + map-pin travel calculator (client)
   Pricing imported from @lustique/pricing — one source of truth,
   shared with the future Worker. Map uses free Photon/OSRM.
   ============================================================ */
import {
  computeEstimate, travelForKm, DEST_KM, ACTIVE_PROMO,
  type EstimateInput, type EstimateLine, type HairBuckets, type HairLength, type Occasion, type TravelBand,
} from "@lustique/pricing";

declare const L: any; // Leaflet global (loaded via the CDN <script> on the quote page)

const STUDIO = { lat: -25.7986, lng: 28.3127 }; // 242 Frangipani St, La Montagne (approx)
const FREE_KM = 30;

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
  const heading = document.createElement("div");
  heading.textContent = "What’s in your estimate";
  heading.style.cssText = "font-weight:600;color:var(--mocha);margin-bottom:.2rem;";
  box.append(heading);
  const money = (n: number) => (n < 0 ? "– R " : "R ") + rand(Math.abs(n));
  const addRow = (label: string, amount: string, opts: { discount?: boolean; total?: boolean } = {}) => {
    const r = document.createElement("div");
    r.style.cssText = `display:flex;justify-content:space-between;gap:1rem;padding:.4rem 0;border-top:${opts.total ? "2px" : "1px"} solid rgba(60,42,42,${opts.total ? ".25" : ".08"});${opts.total ? "margin-top:.2rem;" : ""}`;
    const l = document.createElement("span"); l.textContent = label;
    const a = document.createElement("span"); a.textContent = amount; a.style.whiteSpace = "nowrap";
    if (opts.total) { l.style.fontWeight = a.style.fontWeight = "700"; }
    if (opts.discount) { l.style.color = a.style.color = "var(--burgundy)"; }
    r.append(l, a);
    box.append(r);
  };
  for (const line of lines) addRow(line.label, money(line.amount), { discount: line.amount < 0 });
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
      const destination = km > DEST_KM;
      travelOverride = { km, cost: destination ? 0 : travelForKm(km), destination };
      if (res) {
        if (destination) res.textContent = `📍 ≈ ${km} km away — a destination wedding. We’ll tailor travel + accommodation in your quote.`;
        else if (km <= FREE_KM) res.textContent = `📍 ${foundLabel ? foundLabel + " · " : ""}≈ ${km} km from our studio — travel is free (within 30 km). ✓ Drag the pin if this isn’t your exact venue.`;
        else res.textContent = `📍 ${foundLabel ? foundLabel + " · " : ""}≈ ${km} km from our studio — travel ≈ R ${rand(travelOverride.cost)} round trip. ✓ Drag the pin if this isn’t your exact venue.`;
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
  // Lean on the venue name first (most specific) — a lodge can be far from its nearest town.
  const q = [venue, town, provPart, "South Africa"].filter(Boolean).join(", ");
  try {
    const g = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lat=${STUDIO.lat}&lon=${STUDIO.lng}&lang=en`).then((r) => r.json());
    const f = g.features && g.features[0];
    if (!f) throw new Error("no geocode");
    const c = f.geometry.coordinates;
    const center = { lat: c[1], lng: c[0] };
    const p = f.properties || {};
    foundLabel = [p.name, p.city || p.county, p.state].filter(Boolean).join(", ");
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
