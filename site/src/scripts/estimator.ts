/* ============================================================
   LUSTIQUE CO. — live estimator + map-pin travel calculator (client)
   Pricing imported from @lustique/pricing — one source of truth,
   shared with the future Worker. Map uses free Photon/OSRM.
   ============================================================ */
import {
  computeEstimate, travelForKm, estimateDestinationExtras, DEST_KM, FREE_KM,
  type EstimateInput, type EstimateLine, type HairBuckets, type HairLength, type Occasion, type TravelBand, type Promo,
} from "@lustique/pricing";
import venueDirectory from "../data/sa-wedding-venues.json";
import { findKnownVenue, normalizeVenueName, venueLabel, buildGeocodeQuery, isPreciseGeocodeResult, type KnownVenue } from "./venueMatch";

declare const L: any; // Leaflet global (loaded via the CDN <script> on the quote page)

const VENUES = venueDirectory as KnownVenue[];

const STUDIO = { lat: -25.7986, lng: 28.3127 }; // 242 Frangipani St, La Montagne (approx)

let travelOverride: { km: number; cost: number; destination: boolean } | null = null;
let foundLabel = "";
let map: any, marker: any;
// True once an automated match attempt has failed and the bride is left to drag the
// pin herself — lets us log "manual-pin" only for the drag that actually resolved a
// lookup, not every fine-tune drag after an already-successful match.
let awaitingManualPin = false;

// The live promo — fetched from the dashboard-configured active preset, never
// hardcoded. Starts as "none" so the estimator is never wrong while it loads.
let activePromo: Promo = { kind: "none" };
let activePromoMeta: { id: string; name: string; tagline: string } | null = null;

async function loadActivePromo() {
  try {
    const res = await fetch("/api/promo/active").then((r) => r.json());
    activePromo = res.promo ?? { kind: "none" };
    activePromoMeta = res.meta ?? null;
  } catch {
    activePromo = { kind: "none" };
    activePromoMeta = null;
  }
  updatePromoToggleLabel();
  renderEstimate();
}

// Reflects whichever promo is actually live — the toggle only opts in/out of it.
function updatePromoToggleLabel() {
  const row = el("promoRow");
  const label = document.getElementById("promoToggleLabel");
  if (!row) return;
  if (!activePromoMeta) { row.style.display = "none"; return; }
  row.style.display = "";
  if (label) label.textContent = `Apply the "${activePromoMeta.name}" offer to my estimate — ${activePromoMeta.tagline}`;
}

type VenueMatchOutcome =
  | "directory-exact" | "directory-fuzzy-confirmed" | "directory-fuzzy-rejected"
  | "live-search-directory" | "live-search-external"
  | "geocode-fallback" | "geocode-fail" | "manual-pin";

/** Fire-and-forget telemetry — measuring real first-time match accuracy must never block the UI. */
function logVenueMatch(outcome: VenueMatchOutcome, typedText?: string, matchedName?: string) {
  try {
    fetch("/api/venue-match-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome, typedText, matchedName }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* best-effort only */ }
}

const el = (id: string) => document.getElementById(id);
const fld = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
const num = (id: string) => { const e = fld(id); return e ? Math.max(0, parseInt(e.value, 10) || 0) : 0; };
const val = (id: string, d = "") => { const e = fld(id); return e ? e.value : d; };
const checked = (id: string, d = true): boolean => { const e = el(id) as HTMLInputElement | null; return e ? e.checked : d; };
const rand = (x: number) => x.toLocaleString("en-ZA").replace(/,/g, " ");
const setBand = (show: boolean) => { const w = el("bandWrap"); if (w) w.style.display = show ? "" : "none"; };

/** The hair-length picker only makes sense once the bride has actually chosen hair. */
function applyBrideServiceToggle(): void {
  const wrap = el("brideHairLenWrap");
  if (wrap) wrap.style.display = checked("brideWantsHair") ? "" : "none";
}

// Adult heads needing hair = the bridesmaid + mother + guest hair counts.
const adultHairHeads = (): number => num("bmHair") + num("momHair") + num("guestHair");

/** Party hair as a length distribution — the combined sum across bridesmaids + mothers + guests. */
function readPartyHair(): HairBuckets {
  const sum = (p: string): HairBuckets => ({
    short: num(p + "Short"), medium: num(p + "Medium"), long: num(p + "Long"), xlong: num(p + "Xlong"),
  });
  const groups = [sum("bmHairLen"), sum("momHairLen"), sum("guestHairLen")];
  return {
    short: groups.reduce((s, g) => s + g.short, 0),
    medium: groups.reduce((s, g) => s + g.medium, 0),
    long: groups.reduce((s, g) => s + g.long, 0),
    xlong: groups.reduce((s, g) => s + g.xlong, 0),
  };
}

/** Event hair length distribution — the four event buckets. */
function readEventHair(): HairBuckets {
  return { short: num("evLenShort"), medium: num("evLenMedium"), long: num("evLenLong"), xlong: num("evLenXlong") };
}

/** Keep each sub-party's "N looks need hair" count + "placed of N" note honest. */
function updateLengthHint(): void {
  reconcileGroup("bmHair", "bmHairHeadCount", "bmLengthsCounter");
  reconcileGroup("momHair", "momHairHeadCount", "momLengthsCounter");
  reconcileGroup("guestHair", "guestHairHeadCount", "guestLengthsCounter");
}

function reconcileGroup(hairCountId: string, headCountId: string, counterId: string): void {
  const n = num(hairCountId);
  const headCount = el(headCountId);
  if (headCount) headCount.textContent = String(n);
  const counter = el(counterId);
  if (!counter) return;
  const prefix = hairCountId.replace("Hair", "HairLen"); // bmHair -> bmHairLen
  const placed = num(prefix + "Short") + num(prefix + "Medium") + num(prefix + "Long") + num(prefix + "Xlong");
  if (placed === n) counter.textContent = n ? `✓ all ${n} placed` : "";
  else if (placed < n) counter.textContent = `${placed} of ${n} placed — ${n - placed} to go`;
  else counter.textContent = `${placed} placed — ${placed - n} more than need hair`;
}

/** Same reconciliation for the event hair length buckets. */
function updateEvLengthHint(): void {
  const n = num("evHair");
  const headCount = el("evHairHeadCount");
  if (headCount) headCount.textContent = String(n);
  const wrap = el("evHairWrap");
  if (wrap) wrap.style.display = n > 0 ? "" : "none";
  const counter = el("evLengthsCounter");
  if (!counter) return;
  const placed = num("evLenShort") + num("evLenMedium") + num("evLenLong") + num("evLenXlong");
  if (placed === n) counter.textContent = n ? `✓ all ${n} placed` : "";
  else if (placed < n) counter.textContent = `${placed} of ${n} placed — ${n - placed} to go`;
  else counter.textContent = `${placed} placed — ${placed - n} more than need hair`;
}

/** Derive the date-aware promo facts from the chosen wedding date, if any is set yet. */
function weddingDateFacts(): Pick<EstimateInput, "weddingDayOfWeek" | "weddingMonth" | "monthsUntilWedding"> {
  const raw = val("weddingDate");
  if (!raw) return {};
  const chosen = new Date(raw + "T00:00:00");
  if (Number.isNaN(chosen.getTime())) return {};
  const today = new Date();
  const monthsUntilWedding = Math.floor(
    (chosen.getFullYear() - today.getFullYear()) * 12 + (chosen.getMonth() - today.getMonth()) +
    (chosen.getDate() >= today.getDate() ? 0 : -1),
  );
  return { weddingDayOfWeek: chosen.getDay(), weddingMonth: chosen.getMonth() + 1, monthsUntilWedding };
}

export function readInput(): EstimateInput {
  const occasion = val("occasion", "wedding") as Occasion;
  // Weddings & events collect a venue. Events can also choose "studio" (no travel fee).
  const travel: EstimateInput["travel"] =
    occasion !== "wedding" && occasion !== "event"
      ? { band: "studio" as TravelBand }
      : occasion === "event" && val("eventAt", "venue") === "studio"
        ? { band: "studio" as TravelBand }
        : travelOverride
          ? { cost: travelOverride.cost, destination: travelOverride.destination }
          : { band: val("travelBand", "studio") as TravelBand };
  return {
    occasion,
    // Events: no bride or bridal party — map event faces to wedding guest fields
    brideWantsMakeup: occasion === "event" ? false : checked("brideWantsMakeup"),
    brideWantsHair: occasion === "event" ? false : checked("brideWantsHair"),
    brideWantsTrial: occasion === "event" ? false : checked("brideWantsTrial"),
    brideHairLen: val("brideHairLen", "medium") as HairLength,
    partyHair: occasion === "event" ? readEventHair() : readPartyHair(),
    bmMakeup: occasion === "event" ? 0 : num("bmMakeup"),
    bmHair: occasion === "event" ? 0 : num("bmHair"),
    momMakeup: occasion === "event" ? 0 : num("momMakeup"),
    momHair: occasion === "event" ? 0 : num("momHair"),
    fgAge: val("fgAge", "under") === "under" ? "under" : "over",
    fgMakeup: occasion === "event" ? 0 : num("fgMakeup"),
    fgHair: occasion === "event" ? 0 : num("fgHair"),
    fgHairLen: val("fgHairLen", "medium") as HairLength,
    guestMakeup: occasion === "event" ? num("evMakeup") : num("guestMakeup"),
    guestHair: occasion === "event" ? num("evHair") : num("guestHair"),
    evMakeup: num("evMakeup"), evHair: num("evHair"), evHairLen: "medium" as HairLength, // per-look-length buckets now handled via partyHair
    lessonsAttending: num("lessonsAttending"),
    requestedArtists: num("requestedArtists"),
    promo: occasion === "event" ? { kind: "none" } as Promo : (el("promoToggle") as HTMLInputElement | null)?.checked === false ? { kind: "none" } : activePromo,
    travel,
    ...weddingDateFacts(),
  };
}

// Show the bride what builds her price (Pieter: "inform what contributes to their overall price").
// Built with safe DOM + textContent — no innerHTML, no injection surface.
function renderBreakdown(lines: EstimateLine[], total: number, destination: boolean, perks: string[] = []): void {
  const box = el("estimateBreakdown");
  if (!box) return;
  box.replaceChildren();
  if (destination || lines.length === 0) return;

  // Zero-price-effect promo perks (e.g. a bundled touch-up kit) — badges, not line items.
  for (const perk of perks) {
    const badge = document.createElement("div");
    badge.textContent = `✓ ${perk}`;
    badge.style.cssText =
      "display:inline-block;background:rgba(138,90,74,.1);color:var(--mocha);border-radius:20px;" +
      "font-size:.78rem;font-weight:600;padding:.25em .8em;margin:0 .4rem .6rem 0;";
    box.append(badge);
  }

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
    updateEvLengthHint();
    const r = computeEstimate(readInput());
    if (!r.destination && !Number.isFinite(r.total)) throw new Error(`non-finite total: ${r.total}`);
    out.textContent = r.destination ? "Destination — we’ll tailor it" : "from R " + rand(r.total);
    if (sub) {
      if (r.destination) {
        // Indicative-only figures (travelOverride.km when we have a real route; the known
        // R7/km + R1000/artist/night rates) so "we'll tailor it" isn't a total black box —
        // the official total still stays personally confirmed (PRICING.md §4 open items).
        if (travelOverride) {
          const extras = estimateDestinationExtras(travelOverride.km, r.heads);
          sub.textContent =
            `Indicative only: ≈ R ${rand(extras.travelEstimate)} travel + from R ${rand(extras.accommodationEstimate)} ` +
            `min. artist accommodation (${extras.artists} artist${extras.artists > 1 ? "s" : ""} × 2 nights) — we confirm the exact total personally.`;
        } else {
          sub.textContent = "Over 200 km — we’ll send a personalised destination quote";
        }
      }
      else if (r.occasion === "lessons") sub.textContent = `${r.heads} attending · group lesson`;
      else if (r.occasion !== "wedding") sub.textContent = `${r.heads} ${r.heads === 1 ? "face" : "faces"} · approximate event estimate`;
      else sub.textContent = `${r.heads} ${r.heads === 1 ? "look" : "looks"} · incl. trial & touch-ups`;
    }
    renderBreakdown(r.lines, r.total, r.destination, r.perks);
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
      awaitingManualPin = false;
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
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      if (awaitingManualPin) { logVenueMatch("manual-pin", val("venueInput").trim()); awaitingManualPin = false; }
      routeFrom(p.lat, p.lng);
    });
  } else {
    map.setView([center.lat, center.lng], 11);
    marker.setLatLng([center.lat, center.lng]);
  }
  setTimeout(() => map.invalidateSize(), 250);
  return true;
}

// A directory hit is shown for confirmation rather than applied silently —
// a wrong silent match means a bride gets a travel fee for the wrong location.
function renderVenueConfirmation(venue: KnownVenue) {
  const res = el("travelResult");
  if (!res) return;
  res.replaceChildren();

  const approx = venue.verified === false || venue.precision !== "poi";
  const p = document.createElement("p");
  p.style.cssText = "margin:0 0 .6rem;";
  p.textContent =
    `📍 We found "${venueLabel(venue)}" in our venue directory` +
    (approx ? " (approximate location — please confirm on the map)." : ".") +
    " Is this your venue?";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:.6rem;flex-wrap:wrap;";

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "btn btn-primary";
  yes.style.cssText = "padding:.5em 1.2em;font-size:.85rem;";
  yes.textContent = "Yes, that’s my venue";
  yes.addEventListener("click", () => {
    foundLabel = venueLabel(venue);
    logVenueMatch("directory-fuzzy-confirmed", val("venueInput").trim(), venue.name);
    routeFrom(venue.lat, venue.lng);
  });

  const no = document.createElement("button");
  no.type = "button";
  no.className = "btn btn-ghost";
  no.style.cssText = "padding:.5em 1.2em;font-size:.85rem;";
  no.textContent = "No, let me pinpoint it";
  no.addEventListener("click", () => {
    logVenueMatch("directory-fuzzy-rejected", val("venueInput").trim(), venue.name);
    geocodeFallback();
  });

  row.append(yes, no);
  res.append(p, row);

  initMap({ lat: venue.lat, lng: venue.lng });
}

async function geocodeFallback() {
  const venue = val("venueInput").trim();
  const res = el("travelResult");
  if (res) res.textContent = "Finding your venue…";
  const q = buildGeocodeQuery(venue); // see venueMatch.ts for why town/province are deliberately excluded
  try {
    const apiKey = (import.meta.env.PUBLIC_HERE_API_KEY as string) || "";
    const g = await fetch(
      `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(q)}&at=${STUDIO.lat},${STUDIO.lng}&in=countryCode:ZAF&limit=1&apiKey=${encodeURIComponent(apiKey)}`,
    ).then((r) => r.json());
    const item = g.items && g.items[0];
    if (!item) throw new Error("no geocode");
    // A coarse (town/area-level) match means we didn't actually find the venue — only
    // its general vicinity. Accepting that silently is exactly how a lodge outside town
    // gets quoted as if it were parked at the town's centre. Fall through to manual pin.
    if (!isPreciseGeocodeResult(item.resultType)) throw new Error("imprecise geocode: " + item.resultType);
    const center = { lat: item.position.lat, lng: item.position.lng };
    const label: string = (item.address && item.address.label) || item.title || "";
    foundLabel = label.split(",").slice(0, 3).map((s: string) => s.trim()).filter(Boolean).join(", ");
    logVenueMatch("geocode-fallback", venue, foundLabel);
    initMap(center);
    routeFrom(center.lat, center.lng);
  } catch {
    logVenueMatch("geocode-fail", venue);
    awaitingManualPin = true;
    travelOverride = null;
    initMap(STUDIO);
    if (res) res.textContent = "Couldn’t find that venue automatically — drag the pin on the map to your venue and we’ll calculate the drive.";
    setBand(false);
    renderEstimate();
  }
}

async function lookupTravel() {
  const venue = val("venueInput").trim();
  const res = el("travelResult");
  if (!venue) { if (res) res.textContent = "Add your venue above, then we’ll find it on the map."; return; }

  const known = findKnownVenue(venue, VENUES);
  if (known) {
    renderVenueConfirmation(known);
    return;
  }

  await geocodeFallback();
}

// Show/hide venue search elements — for events, the studio/venue toggle controls this.
function toggleVenueSearch() {
  const occ = val("occasion", "wedding");
  const isEvent = occ === "event";
  const studio = isEvent && val("eventAt", "venue") === "studio";
  const show = (id: string, on: boolean) => { const e = el(id); if (e) e.style.display = on ? "" : "none"; };
  // Always visible: weddingDate. Venue-search elements:
  const venueField = document.querySelector("#weddingDayFields .field:has(#venueInput)") as HTMLElement | null;
  if (venueField) venueField.style.display = studio ? "none" : "";
  show("checkTravel", !studio);
  show("venueMap", !studio);
  show("mapHint", !studio);
  show("travelResult", !studio);
  show("bandWrap", !studio);
}

// Show only the field groups that fit the chosen occasion.
function applyOccasion() {
  const occ = val("occasion", "wedding");
  const isWedding = occ === "wedding";
  const isEvent = occ === "event";
  const isLessons = occ === "lessons";
  const show = (id: string, on: boolean) => { const e = el(id); if (e) e.style.display = on ? "" : "none"; };
  show("weddingDayFields", isWedding || isEvent);  // date + venue + travel — weddings & events
  show("weddingFields", isWedding);                 // the bride + bridal party — weddings only
  show("eventFields", !isWedding && !isLessons);    // simple faces + hair — matric & events
  show("lessonsFields", isLessons);                 // group lessons: attendee count
  show("promoRow", isWedding);                    // promos — weddings only, not events
  // Update labels for event
  if (isEvent) {
    const h3 = document.querySelector("#weddingDayFields h3");
    if (h3) h3.textContent = "Your event";
    const sub = document.querySelector("#weddingDayFields .step-sub");
    if (sub) sub.textContent = "Let us know the date and where you'd like us to be.";
    const dl = document.querySelector("#weddingDayFields label[for='weddingDate']");
    if (dl) dl.textContent = "Event date";
    const vl = document.querySelector("#weddingDayFields label[for='venueInput']");
    if (vl) vl.innerHTML = 'Venue or choose studio <span style="text-transform:none;letter-spacing:0;font-weight:400;color:#6b5c52;">(start typing to search, or select "studio" below)</span>';
    // Remove bride language from About you section
    const aboutSub = document.querySelector(".form-step:nth-of-type(2) .step-sub");
    if (aboutSub) aboutSub.textContent = "Tell us about yourself.";
  }
  if (isWedding || isEvent) { if (!isEvent || val("eventAt", "venue") !== "studio") initMap(STUDIO); }
  toggleVenueSearch();
  updateEvLengthHint();
}

// Live-search-as-you-type: neither "know the venue name exactly" nor "know where to
// drag a pin on a blank map" are reliable asks for a bride. This blends our verified
// directory (shown first, flagged) with HERE's live Autosuggest index (any address or
// business, nationwide) — picking any suggestion gives an exact coordinate straight away.
type LiveSuggestion = { title: string; address: string; lat: number; lng: number };

let suggestSeq = 0;
let suggestDebounce: ReturnType<typeof setTimeout> | undefined;

function localDirectoryMatches(query: string): KnownVenue[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return VENUES.filter((v) => v.name.toLowerCase().includes(q) || (v.town ?? "").toLowerCase().includes(q)).slice(0, 5);
}

async function fetchLiveSuggestions(query: string): Promise<LiveSuggestion[]> {
  const apiKey = (import.meta.env.PUBLIC_HERE_API_KEY as string) || "";
  const url =
    `https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(query)}` +
    `&at=${STUDIO.lat},${STUDIO.lng}&in=countryCode:ZAF&limit=6&lang=en&apiKey=${encodeURIComponent(apiKey)}`;
  const data = await fetch(url).then((r) => r.json());
  const items = (data.items || []) as any[];
  const mapped = items
    .filter((i) => i.position)
    .map((i) => ({ title: i.title as string, address: (i.address && i.address.label) || (i.title as string), lat: i.position.lat, lng: i.position.lng }));
  // HERE sometimes returns the same place more than once (different branches/records
  // sharing a name) — collapse those so the list isn't clogged with duplicates,
  // which was the actual cause of "can't reach the option I want" complaints.
  const seen = new Set<string>();
  const deduped: LiveSuggestion[] = [];
  for (const m of mapped) {
    const key = normalizeVenueName(m.title);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  return deduped;
}

function hideSuggestions() {
  const box = el("venueSuggestions");
  if (box) { box.style.display = "none"; box.replaceChildren(); }
}

function selectSuggestion(lat: number, lng: number, label: string, outcome: VenueMatchOutcome, matchedName: string) {
  hideSuggestions();
  const input = fld("venueInput") as HTMLInputElement | null;
  if (input) input.value = label;
  foundLabel = label;
  logVenueMatch(outcome, val("venueInput").trim(), matchedName);
  initMap({ lat, lng });
  routeFrom(lat, lng);
}

const ROW_STYLE = "display:block;width:100%;text-align:left;padding:.6rem .8rem;border:none;background:none;" +
  "border-bottom:1px solid rgba(60,42,42,.08);cursor:pointer;font:inherit;color:inherit;";
const ROW_ACTIVE_STYLE = ROW_STYLE + "background:rgba(138,90,74,.1);";

// Which suggestion row is keyboard-highlighted — arrow keys are a reliable way to
// reach an option below the fold even where a touch/scroll gesture is finicky.
let activeSuggestionIndex = -1;

function renderSuggestions(directoryMatches: KnownVenue[], liveMatches: LiveSuggestion[]) {
  const box = el("venueSuggestions");
  if (!box) return;
  box.replaceChildren();
  activeSuggestionIndex = -1;

  const addRow = (label: string, sub: string, onSelect: () => void) => {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = ROW_STYLE;
    const name = document.createElement("div");
    name.textContent = label;
    name.style.cssText = "font-weight:600;color:var(--mocha);";
    const subEl = document.createElement("div");
    subEl.textContent = sub;
    subEl.style.cssText = "font-size:.8rem;color:#8a7a6e;margin-top:.1rem;";
    row.append(name, subEl);
    // mousedown (not click) fires before the input's blur hides the dropdown.
    row.addEventListener("mousedown", (e) => { e.preventDefault(); onSelect(); });
    box.append(row);
  };

  for (const v of directoryMatches) {
    addRow(v.name, (v.town ? v.town + " · " : "") + "✓ verified venue", () =>
      selectSuggestion(v.lat, v.lng, venueLabel(v), "live-search-directory", v.name));
  }
  const dirKeys = new Set(directoryMatches.map((v) => normalizeVenueName(v.name)));
  for (const s of liveMatches) {
    if (dirKeys.has(normalizeVenueName(s.title))) continue; // don't show the same place twice
    addRow(s.title, s.address, () => selectSuggestion(s.lat, s.lng, s.title, "live-search-external", s.title));
  }

  box.style.display = box.children.length ? "block" : "none";
}

function moveSuggestionHighlight(delta: number) {
  const box = el("venueSuggestions");
  if (!box || box.style.display === "none") return;
  const rows = Array.from(box.children) as HTMLButtonElement[];
  if (!rows.length) return;
  if (activeSuggestionIndex >= 0) rows[activeSuggestionIndex]!.style.cssText = ROW_STYLE;
  activeSuggestionIndex = (activeSuggestionIndex + delta + rows.length) % rows.length;
  const active = rows[activeSuggestionIndex]!;
  active.style.cssText = ROW_ACTIVE_STYLE;
  active.scrollIntoView({ block: "nearest" });
}

function selectActiveSuggestion(): boolean {
  const box = el("venueSuggestions");
  if (!box || activeSuggestionIndex < 0) return false;
  const rows = Array.from(box.children) as HTMLButtonElement[];
  rows[activeSuggestionIndex]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  return true;
}

function onVenueInputTyped() {
  const raw = val("venueInput");
  if (suggestDebounce) clearTimeout(suggestDebounce);
  if (raw.trim().length < 3) { hideSuggestions(); return; }
  suggestDebounce = setTimeout(async () => {
    const seq = ++suggestSeq;
    const directoryMatches = localDirectoryMatches(raw);
    let liveMatches: LiveSuggestion[] = [];
    try { liveMatches = await fetchLiveSuggestions(raw); } catch { /* live search is best-effort */ }
    if (seq !== suggestSeq) return; // a newer keystroke has already superseded this response
    renderSuggestions(directoryMatches, liveMatches);
  }, 350);
}

function wireVenueSearch() {
  const input = fld("venueInput") as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener("input", onVenueInputTyped);
  input.addEventListener("blur", () => { setTimeout(hideSuggestions, 150); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideSuggestions(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestionHighlight(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestionHighlight(-1); return; }
    if (e.key === "Enter" && selectActiveSuggestion()) { e.preventDefault(); }
  });
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
  const brideHairToggle = el("brideWantsHair");
  if (brideHairToggle) brideHairToggle.addEventListener("change", applyBrideServiceToggle);
  const eventAtToggle = el("eventAt");
  if (eventAtToggle) eventAtToggle.addEventListener("change", () => { toggleVenueSearch(); renderEstimate(); });
  const evHairToggle = el("evHair");
  if (evHairToggle) evHairToggle.addEventListener("change", updateEvLengthHint);
  wireVenueSearch();
  applyOccasion();
  applyBrideServiceToggle();
  renderEstimate();
  loadActivePromo(); // async — re-renders once the live promo config arrives
});
