// worker/src/booking/promos.ts
// Admin Promotions tab — Zandeline picks up to 5 presets from the curated 10-promo
// library into her active roster, then picks which one (if any) is live on the
// estimator. GET /api/promo/active is the public counterpart the site fetches.

import { getAdminSession } from "./auth";
import { getBusinessSetting, setBusinessSetting, type DbEnv } from "./db";
import { PROMO_PRESETS, getPromoPreset } from "@lustique/pricing";
import type { ShellFn } from "./enquiries";

const LIBRARY_KEY = "promo_library";
const ACTIVE_KEY = "active_promo_id";
const MAX_LIBRARY_SIZE = 5;

const esc = (s = "") =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

async function readLibrary(env: DbEnv, f: typeof fetch): Promise<string[]> {
  const raw = await getBusinessSetting(env, LIBRARY_KEY, f);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const RETURN = "/api/admin/promos";

export async function handleAdminPromos(
  req: Request,
  env: DbEnv & { SUPABASE_JWT_SECRET: string },
  shell: ShellFn,
  f: typeof fetch = fetch,
): Promise<Response> {
  const user = await getAdminSession(req, env, f);
  if (!user) return redirect("/api/admin/login?msg=session-expired");

  if (req.method === "POST") {
    const form = await req.formData();
    const library = form.getAll("library").map(String).filter((id) => getPromoPreset(id)?.appliesToLiveEstimate).slice(0, MAX_LIBRARY_SIZE);
    let active = String(form.get("active") ?? "none");
    // The active promo must be either "none" or a member of the saved library —
    // never a promo she's since removed from her roster.
    if (active !== "none" && !library.includes(active)) active = "none";

    await Promise.all([
      setBusinessSetting(env, LIBRARY_KEY, JSON.stringify(library), f),
      setBusinessSetting(env, ACTIVE_KEY, active, f),
    ]);
    return redirect(`${RETURN}?saved=1`);
  }

  const url = new URL(req.url);
  const savedMsg = url.searchParams.get("saved") === "1" ? "Promo settings updated." : "";

  const [library, activeRaw] = await Promise.all([
    readLibrary(env, f),
    getBusinessSetting(env, ACTIVE_KEY, f),
  ]);
  const active = activeRaw ?? "none";

  const liveEligible = PROMO_PRESETS.filter((p) => p.appliesToLiveEstimate);
  const manualOnly = PROMO_PRESETS.filter((p) => !p.appliesToLiveEstimate);

  const presetCard = (p: (typeof PROMO_PRESETS)[number], inLibrary: boolean) => `
    <div style="background:#fff;border:1.5px solid #ede7e0;border-radius:10px;padding:1rem 1.1rem;">
      <label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;">
        <input type="checkbox" name="library" value="${esc(p.id)}" ${inLibrary ? "checked" : ""} style="margin-top:.3rem;width:auto;">
        <span>
          <div style="font-weight:700;color:#3a2e26;">${esc(p.name)}</div>
          <div style="font-size:.82rem;color:#5c4332;margin-top:.15rem;">${esc(p.tagline)}</div>
          <div style="font-size:.76rem;color:#8a7d72;margin-top:.35rem;">${esc(p.mechanic)}</div>
          ${p.requiresSetup ? `<div style="font-size:.76rem;color:#b7791f;margin-top:.35rem;">⚠ ${esc(p.requiresSetup)}</div>` : ""}
        </span>
      </label>
    </div>`;

  const manualCard = (p: (typeof PROMO_PRESETS)[number]) => `
    <div style="background:#faf7f4;border:1.5px dashed #ede7e0;border-radius:10px;padding:1rem 1.1rem;">
      <div style="font-weight:700;color:#3a2e26;">${esc(p.name)}</div>
      <div style="font-size:.82rem;color:#5c4332;margin-top:.15rem;">${esc(p.tagline)}</div>
      <div style="font-size:.76rem;color:#8a7d72;margin-top:.35rem;">${esc(p.mechanic)}</div>
      <div style="font-size:.76rem;color:#8a3a52;margin-top:.35rem;">✋ ${esc(p.manualNote ?? "")}</div>
    </div>`;

  const activeOptions = [
    `<label style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;">
      <input type="radio" name="active" value="none" ${active === "none" ? "checked" : ""} style="width:auto;">
      <span>None running</span>
    </label>`,
    ...liveEligible.map((p) => `
    <label style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;">
      <input type="radio" name="active" value="${esc(p.id)}" ${active === p.id ? "checked" : ""} style="width:auto;">
      <span>${esc(p.name)}</span>
    </label>`),
  ].join("");

  const inner = `
    ${savedMsg ? `<div style="margin-bottom:1rem;padding:.65em .9em;border-radius:8px;background:#f0fff4;border:1px solid #b7dfc8;color:#276749;font-size:.88rem;">✓ ${esc(savedMsg)}</div>` : ""}
    <p style="color:#8a7d72;font-size:.9rem;margin:0 0 1.4rem;">
      Pick up to ${MAX_LIBRARY_SIZE} promos into your library, then choose which one (if any) is currently live on the quote page.
      Only one promo runs at a time — they don't stack.
    </p>
    <form method="POST" action="${RETURN}">
      <h2 style="margin:0 0 .8rem;">Your promo library (max ${MAX_LIBRARY_SIZE})</h2>
      <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-bottom:1.6rem;">
        ${liveEligible.map((p) => presetCard(p, library.includes(p.id))).join("")}
      </div>

      <h2 style="margin:1.6rem 0 .8rem;">Currently running</h2>
      <div style="background:#fff;border:1.5px solid #ede7e0;border-radius:10px;padding:1rem 1.1rem;margin-bottom:1.6rem;">
        ${activeOptions}
      </div>

      <button type="submit" style="font:inherit;font-weight:700;padding:.6em 1.4em;background:#8a3a52;color:#fff;border:none;border-radius:6px;cursor:pointer;">Save</button>
    </form>

    <h2 style="margin:2.2rem 0 .8rem;">Manual / backend-applied promos</h2>
    <p style="color:#8a7d72;font-size:.85rem;margin:0 0 .8rem;">
      These don't touch the live estimator — they depend on verifying something real-world (a referral, a repeat client). Apply them yourself at invoicing time.
    </p>
    <div style="display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">
      ${manualOnly.map(manualCard).join("")}
    </div>`;

  return htmlResponse(shell("Promotions", user, inner, url.pathname));
}

/** GET /api/promo/active — public, no auth. The site's estimator fetches this on load. */
export async function handlePublicActivePromo(
  _req: Request,
  env: DbEnv,
  origin: string,
  f: typeof fetch = fetch,
): Promise<Response> {
  const activeId = await getBusinessSetting(env, ACTIVE_KEY, f);
  const preset = activeId && activeId !== "none" ? getPromoPreset(activeId) : undefined;
  const body =
    preset && preset.appliesToLiveEstimate
      ? { promo: preset.promo, meta: { id: preset.id, name: preset.name, tagline: preset.tagline } }
      : { promo: { kind: "none" as const }, meta: null };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60", // short cache — Zandeline's changes show up within a minute
      "access-control-allow-origin": origin,
    },
  });
}
